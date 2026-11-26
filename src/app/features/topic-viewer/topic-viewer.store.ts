/**
 * TopicViewerStore — NgRx SignalStore for the topic-viewer page
 * (Topic #619 / Blueprint #635 / task #642).
 *
 * Lazy-loading v3 (#1637): `response` holds the slim index fetch (roots
 * with `children: []`); populated subtrees live in the `trees` memo and
 * land on demand via `ensureTopic` — selection, all-topics rendering,
 * and refresh all funnel through it. The left pane (filteredTopics /
 * visibleTopics) reads the index alone and never waits on subtree
 * fetches. v2 view state (#1531): search predicate + in-tree match
 * expansion, all-topics browse, and the label-write patch path
 * (patches the index AND any memoized tree).
 */

import { computed, DestroyRef, inject } from '@angular/core';
import {
  signalStore,
  withState,
  withComputed,
  withMethods,
  patchState,
} from '@ngrx/signals';
import { firstValueFrom, throwError } from 'rxjs';

import type {
  LifecycleNode,
  LifecycleTreeResponse,
} from '@lifecycle/contracts';
import {
  TOPIC_VIEWER_REPOS,
  TopicViewerService,
  type TopicViewerRepo,
} from './topic-viewer.service';
import {
  deepResolveCandidate,
  errMessage,
  type DeepResolveHost,
  type IssueResolution,
  resolveIssueNumber as deepResolve,
} from './topic-viewer-deep-resolve';

export interface TopicRow {
  number: number;
  title: string;
  stageLabel?: string;
  closed: boolean;
}

export interface TreeRow {
  node: LifecycleNode;
  depth: number;
}

export type { IssueResolution } from './topic-viewer-deep-resolve';

/** One topic's render unit in the all-topics right pane (#1638) —
 *  `status` drives the page's skeleton / error+retry / rows branch. */
export interface AllTopicBlock {
  topic: LifecycleNode;
  status: 'ready' | 'loading' | 'error';
  error: string | null;
  rows: TreeRow[];
}

interface LifecycleState {
  repos: TopicViewerRepo[];
  selectedRepoIndex: number;
  /** The slim INDEX response — roots carry `children: []` (#1635).
   *  Left-pane rows/filters read this; subtree data lives in `trees`. */
  response: LifecycleTreeResponse | null;
  /** Session-scoped memo of populated subtrees (#1637) — keyed by topic
   *  number, filled by ensureTopic, dropped wholesale on refresh/repo
   *  switch. */
  trees: Record<number, LifecycleNode>;
  /** Per-topic fetch timestamp (as-of display for the selected tree). */
  treeFetchedAt: Record<number, string>;
  /** Topic numbers with an in-flight subtree fetch — skeleton drivers
   *  (consumed by the page's per-topic states, #1638). */
  treeLoading: number[];
  /** Per-topic fetch error — the page's section/pane error + retry
   *  signal (#1638). */
  treeErrors: Record<number, string>;
  /** The all-topics queue hit a rate-limit-class error and drained —
   *  the page's drain notice (#1638); re-enable or refresh retries. */
  allTopicsDrained: boolean;
  selectedTopicNumber: number | null;
  expandedIds: number[];
  /** Explicit user collapses of auto-expanded match ancestors —
   *  subtracted from the effective expansion; cleared when the query
   *  empties or the selected tree/repo changes. */
  suppressedIds: number[];
  showClosed: boolean;
  query: string;
  showAllTopics: boolean;
  loading: boolean;
  error: string | null;
  fetchedAt: string | null;
  /** Monotonic fetch token — late-arriving responses for a switched-away
   *  repo are discarded (stale-response guard). */
  fetchSeq: number;
  /** Memo epoch — bumped on refresh/repo switch; in-flight subtree
   *  fetches from an older epoch discard their result on resolve. */
  memoSeq: number;
  /** Deep resolution status (#1696) — null when no digit query is in
   *  play; drives the page's scoped note (resolving / resolved /
   *  not-in-tree / not-found / error). */
  issueResolution: IssueResolution | null;
  /** Monotonic resolution epoch — a newer query, repo switch, or refresh
   *  bumps it so an in-flight resolution's continuation no-ops. */
  resolveSeq: number;
  /** The node a successful resolution landed on — the tree's distinct
   *  resolved-row highlight (kept separate from query matchSet). */
  resolvedNodeNumber: number | null;
}

const initialState: LifecycleState = {
  repos: TOPIC_VIEWER_REPOS,
  selectedRepoIndex: 0,
  response: null,
  trees: {},
  treeFetchedAt: {},
  treeLoading: [],
  treeErrors: {},
  allTopicsDrained: false,
  selectedTopicNumber: null,
  expandedIds: [],
  suppressedIds: [],
  showClosed: false,
  query: '',
  showAllTopics: false,
  loading: false,
  error: null,
  fetchedAt: null,
  fetchSeq: 0,
  memoSeq: 0,
  issueResolution: null,
  resolveSeq: 0,
  resolvedNodeNumber: null,
};

function toRow(n: LifecycleNode): TopicRow {
  return {
    number: n.number,
    title: n.title,
    stageLabel: n.stageLabel,
    closed: n.state === 'closed',
  };
}

/** Search predicate (#1531): title substring (case-insensitive), the
 *  exact issue number for a `154`/`#154` numeric query, or a substring
 *  hit on any label name. An empty/blank query matches everything. */
function matchesQuery(
  n: { title: string; number: number; labels: string[] },
  needle: string, // pre-normalized: q.trim().toLowerCase()
): boolean {
  if (!needle) return true;
  if (n.title.toLowerCase().includes(needle)) return true;
  const dn = deepResolveCandidate(needle);
  if (dn !== null && n.number === dn) return true;
  return n.labels.some(l => l.toLowerCase().includes(needle));
}

const hasQuery = (q: string): boolean => q.trim().length > 0;

/** Flatten one topic into depth rows — the node emits children only
 *  when its number is in `expanded` (root row always emits so a
 *  collapsed root keeps its caret). Closed nodes filtered unless
 *  `showClosed`. Shared by treeRows and the all-topics builder. */
function flattenTopic(
  topic: LifecycleNode,
  expanded: ReadonlySet<number>,
  showClosed: boolean,
): TreeRow[] {
  const rows: TreeRow[] = [{ node: topic, depth: 0 }];
  if (!expanded.has(topic.number)) return rows;
  const walk = (nodes: LifecycleNode[], depth: number) => {
    for (const n of nodes) {
      if (!showClosed && n.state === 'closed') continue;
      rows.push({ node: n, depth });
      if (expanded.has(n.number) && n.children.length) {
        walk(n.children, depth + 1);
      }
    }
  };
  walk(topic.children, 1);
  return rows;
}

/** Immutably patch one node's labels inside a subtree — returns the
 *  same node when the number isn't present (no spurious identity
 *  change for downstream computeds). Shared by the index response
 *  patch and the per-topic memo patch (#1637). */
function patchNodeLabels<T extends LifecycleNode>(
  n: T,
  issueNumber: number,
  labels: string[],
): T {
  if (n.number === issueNumber) return { ...n, labels: [...labels] };
  if (!n.children.length) return n;
  const kids = n.children.map(c => patchNodeLabels(c, issueNumber, labels));
  return kids.some((k, i) => k !== n.children[i])
    ? { ...n, children: kids }
    : n;
}

function patchLabelsInResponse(
  res: LifecycleTreeResponse,
  issueNumber: number,
  labels: string[],
): LifecycleTreeResponse {
  const topics = res.topics.map(t => patchNodeLabels(t, issueNumber, labels));
  return topics.every((t, i) => t === res.topics[i])
    ? res
    : { ...res, topics };
}

export const TopicViewerStore = signalStore(
  { providedIn: 'root' },
  withState(initialState),

  withComputed((store) => ({
    /** Topics passing the closed filter AND the search predicate
     *  (#1531) — the single filtered set every view consumes. A deep
     *  resolution's root stays in the set (#1696): its number never
     *  matches the digit query textually, but the pane must render the
     *  landing — in all-topics mode the section appears, in single mode
     *  the row shows selected. */
    filteredTopics: computed<LifecycleNode[]>(() => {
      const res = store.response();
      if (!res) return [];
      const showClosed = store.showClosed();
      const q = store.query();
      const needle = q.trim().toLowerCase();
      const list = res.topics.filter(
        t => (showClosed || t.state !== 'closed') && matchesQuery(t, needle));
      const resolvedRoot = store.issueResolution()?.rootNumber ?? null;
      if (resolvedRoot !== null
          && list.every(t => t.number !== resolvedRoot)) {
        const root = res.topics.find(t => t.number === resolvedRoot);
        if (root) list.push(root);
      }
      return list;
    }),

    selectedRepo: computed(() => store.repos()[store.selectedRepoIndex()] ?? null),

    /** The selected topic's POPULATED node — read from the trees memo;
     *  null until ensureTopic lands it (the index root carries no
     *  children). */
    selectedTopic: computed<LifecycleNode | null>(() => {
      const num = store.selectedTopicNumber();
      return num === null ? null : (store.trees()[num] ?? null);
    }),

    /** In-flight subtree fetches as a Set — O(1) `treeLoading.has(n)`
     *  skeleton checks for the page. */
    treeLoadingSet: computed<ReadonlySet<number>>(
      () => new Set(store.treeLoading())),
  })),

  // Second block — these computeds consume first-block computeds.
  withComputed((store) => ({
    /** filteredTopics in issue-# ascending order — the single sort every
     *  topic list consumes (#1667: the old Issue-# sort is the only mode
     *  now that grouping is gone). */
    sortedFilteredTopics: computed<LifecycleNode[]>(
      () => [...store.filteredTopics()].sort((a, b) => a.number - b.number)),

    /** Filtered topics whose subtrees have actually been fetched — the
     *  honest "rendered trees" set for all-topics match/expand/rows
     *  derivations (unfetched sections contribute nothing, not stubs). */
    fetchedTopics: computed<LifecycleNode[]>(() => {
      const memo = store.trees();
      return store.filteredTopics()
        .map(t => memo[t.number])
        .filter((t): t is LifecycleNode => t !== undefined);
    }),
  })),

  // Third block — match scope consumes the fetched-trees set.
  withComputed((store) => ({
    /** In-tree search derivation — one walk per rendered root yields
     *  the match set AND the ancestors that must auto-expand to surface
     *  them. Scope = the FETCHED trees the page renders (#1637): every
     *  fetched filtered topic in all-topics mode, the selected topic
     *  otherwise (#1532). The match itself is NOT an ancestor (its
     *  children stay hidden). Empty sets without a query; closed nodes
     *  only count under showClosed. */
    matchInfo: computed<{
      set: ReadonlySet<number>;
      ancestors: ReadonlySet<number>;
    }>(() => {
      const q = store.query();
      const set = new Set<number>();
      const ancestors = new Set<number>();
      if (!hasQuery(q)) return { set, ancestors };
      const needle = q.trim().toLowerCase();
      const showClosed = store.showClosed();
      const sel = store.selectedTopic();
      const roots: LifecycleNode[] = store.showAllTopics()
        ? store.fetchedTopics()
        : (sel ? [sel] : []);
      const walk = (n: LifecycleNode, chain: number[]) => {
        for (const c of n.children) {
          if (!showClosed && c.state === 'closed') continue;
          if (matchesQuery(c, needle)) {
            set.add(c.number);
            chain.forEach(a => ancestors.add(a));
          }
          walk(c, [...chain, c.number]);
        }
      };
      for (const topic of roots) {
        if (matchesQuery(topic, needle)) set.add(topic.number);
        walk(topic, [topic.number]);
      }
      return { set, ancestors };
    }),

    /** The left pane's rows — the filtered set in issue-# order. */
    visibleTopics: computed<TopicRow[]>(() =>
      store.sortedFilteredTopics().map(toRow)),
  })),

  // Fourth block — match signals + effective expansion consume matchInfo.
  withComputed((store) => ({
    /** Nodes inside the selected topic matching the query (includes the
     *  root itself when it matches). */
    matchSet: computed<ReadonlySet<number>>(() => store.matchInfo().set),

    /** Ancestors of every match — auto-expanded so hits surface without
     *  touching the user's manual expansion. */
    matchAncestorIds: computed<ReadonlySet<number>>(() => store.matchInfo().ancestors),

    matchCount: computed(() => store.matchInfo().set.size),

    /** Expansion the tree actually renders — (manual ∪ match ancestors)
     *  − user suppressions. Clearing the query restores the manual set
     *  automatically (suppresses are query-scoped and are cleared with
     *  it; the manual set is never written by search). */
    effectiveExpandedIds: computed<ReadonlySet<number>>(() => {
      const ids = new Set(store.expandedIds());
      for (const a of store.matchInfo().ancestors) ids.add(a);
      for (const s of store.suppressedIds()) ids.delete(s);
      return ids;
    }),
  })),

  // Fifth block — flattened rows + expandable scan consume the
  // effective expansion and the fetched-trees set.
  withComputed((store) => ({
    /** Node ids that are expandable (have *visible* children) — expandAll
     *  target. A node whose children are all closed isn't expandable when
     *  showClosed is off, same rule the tree caret applies. In
     *  all-topics mode the set spans every FETCHED filtered tree. */
    expandableIds: computed<number[]>(() => {
      const showClosed = store.showClosed();
      const visible = (n: LifecycleNode) =>
        n.children.filter(c => showClosed || c.state === 'open');
      const sel = store.selectedTopic();
      const roots: LifecycleNode[] = store.showAllTopics()
        ? store.fetchedTopics()
        : (sel ? [sel] : []);
      const ids: number[] = [];
      const walk = (n: LifecycleNode) => {
        if (visible(n).length) {
          ids.push(n.number);
          visible(n).forEach(walk);
        }
      };
      roots.forEach(walk);
      return ids;
    }),
    /** Flattened visible rows of the selected topic — a node emits its
     *  children only when its number is in the effective expansion.
     *  Closed nodes filtered unless showClosed. */
    treeRows: computed<TreeRow[]>(() => {
      const topic = store.selectedTopic();
      if (!topic) return [];
      return flattenTopic(
        topic, store.effectiveExpandedIds(), store.showClosed());
    }),

    /** Every filtered topic's render state for the all-topics right
     *  pane (#1638) — flat issue-# ascending (#1667: group sections
     *  removed). Unfetched topics emit a 'loading' block (skeleton),
     *  failed ones an 'error' block with its own retry, fetched ones
     *  their flattened rows. Blocks land progressively as trees land. */
    allTopicsBlocks: computed<AllTopicBlock[]>(() => {
      const trees = store.trees();
      const errors = store.treeErrors();
      const expanded = store.effectiveExpandedIds();
      const showClosed = store.showClosed();
      return store.sortedFilteredTopics()
        .map(t => {
          const tree = trees[t.number];
          const error = errors[t.number] ?? null;
          const status: AllTopicBlock['status'] =
            tree ? 'ready' : error ? 'error' : 'loading';
          return {
            topic: t,
            status,
            error,
            rows: tree ? flattenTopic(tree, expanded, showClosed) : [],
          };
        });
    }),

  })),

  // Sixth block — page-state signals (#1637 QA remediation): honest
  // loading/error surface ahead of #1638's styled skeletons.
  withComputed((store) => ({
    /** Selected topic's subtree in flight — the pane shows a loading
     *  indicator instead of the misleading unselected copy. */
    selectedTreeLoading: computed(() => {
      const n = store.selectedTopicNumber();
      return n !== null
        && store.trees()[n] === undefined
        && store.treeLoadingSet().has(n);
    }),
    /** Selected topic's fetch error, if any — pane error + retry. */
    selectedTreeError: computed<string | null>(() => {
      const n = store.selectedTopicNumber();
      return n === null ? null : (store.treeErrors()[n] ?? null);
    }),
    /** Any subtree fetch in flight — gates the all-topics empty copy
     *  so the pane reads "fetching" during the queue drain instead of
     *  flashing "No Topics found" (review M5). */
    anyTreeLoading: computed(() => store.treeLoadingSet().size > 0),
    /** Any subtree fetch error — gates the all-topics empty copy so a
     *  fully-failed drain reads "failed" instead of "No Topics". */
    anyTreeError: computed(() => Object.keys(store.treeErrors()).length > 0),
  })),

  withMethods((store) => {
    const service = inject(TopicViewerService);

    /** In-flight subtree fetch dedupe (#1637) — promises aren't render
     *  state, so the map lives in the closure, not signal state. */
    const inFlight = new Map<number, Promise<LifecycleNode | null>>();

    /** All-topics fetch queue — FIFO topic numbers at bounded
     *  concurrency. `queueActive` counts queue-dispatched fetches only:
     *  user-triggered ensureTopic (a selection click) is a priority
     *  lane outside the cap — the cap bounds background fetch bursts.
     *  The queue is rebuilt (not appended to) on every top-up so a
     *  narrowed filter never fetches topics that left the render set. */
    const QUEUE_CONCURRENCY = 4;
    let queue: number[] = [];
    let queueActive = 0;
    /** Dispatch generation — bumped by dropMemo so a stale in-flight
     *  queue fetch's .finally can't decrement a counter it doesn't own
     *  (review M1: refresh mid-drain would blow the concurrency cap). */
    let queueEpoch = 0;

    const isRateLimit = (err: unknown): boolean =>
      ((err as { code?: string })?.code ?? '').includes('resource-exhausted');

    /** Index fetch only — never fires a subtree call (#1637). Returns
     *  true on success so refresh knows whether to drop the memo. */
    async function fetchIndex(): Promise<boolean> {
      const repo = store.selectedRepo();
      if (!repo) return false;
      const seq = store.fetchSeq() + 1;
      patchState(store, { fetchSeq: seq, loading: true, error: null });
      try {
        const response = await firstValueFrom(
          service.getLifecycleTopicIndex$({ owner: repo.owner, repo: repo.repo }));
        if (store.fetchSeq() !== seq) return false; // stale — a newer fetch owns the slot
        const selected = store.selectedTopicNumber();
        patchState(store, {
          response,
          loading: false,
          fetchedAt: response.fetchedAt,
          // keep selection + expansion only if the node still exists
          ...(selected !== null
            && response.topics.every(t => t.number !== selected)
            ? { selectedTopicNumber: null, expandedIds: [] }
            : {}),
        });
        return true;
      } catch (err) {
        if (store.fetchSeq() !== seq) return false;
        patchState(store, {
          loading: false,
          error: errMessage(err), // previous index + trees kept — page stays up under the banner
        });
        return false;
      }
    }

    /** Drop the memo + queue/in-flight bookkeeping (refresh and repo
     *  switch). In-flight promises still resolve — the bumped epoch
     *  makes their patches no-ops. Deep-resolution state dies with the
     *  dataset too: the resolved node and learned overlay belong to the
     *  old repo's trees (#1696). */
    function dropMemo(): void {
      inFlight.clear();
      queue = [];
      queueActive = 0;
      queueEpoch++;
      if (debounceTimer !== null) { clearTimeout(debounceTimer); debounceTimer = null; }
      patchState(store, {
        trees: {},
        treeFetchedAt: {},
        treeLoading: [],
        treeErrors: {},
        allTopicsDrained: false,
        memoSeq: store.memoSeq() + 1,
        issueResolution: null,
        resolveSeq: store.resolveSeq() + 1,
        resolvedNodeNumber: null,
      });
    }

    /** The memo + dedupe gate every subtree fetch funnels through
     *  (#1637): memo hit → in-flight join → fresh callable. Errors
     *  isolate to treeErrors[n]; a rate-limit-class error additionally
     *  drains the all-topics queue so siblings don't pile on. */
    function ensureTopic(n: number): Promise<LifecycleNode | null> {
      const memo = store.trees()[n];
      if (memo) return Promise.resolve(memo);
      const pending = inFlight.get(n);
      if (pending) return pending;

      const repo = store.selectedRepo();
      if (!repo) return Promise.resolve(null);
      const epoch = store.memoSeq();
      const hadError = store.treeErrors()[n] !== undefined;
      const errors = hadError ? { ...store.treeErrors() } : store.treeErrors();
      if (hadError) delete errors[n];
      patchState(store, {
        treeLoading: [...store.treeLoading(), n],
        treeErrors: errors,
      });

      // A synchronous dispatch throw (e.g. injection-context misuse)
      // must route through the same error path — otherwise the topic
      // stays in treeLoading forever with no fetch and no error.
      const tree$ = (() => {
        try {
          return service.getLifecycleTopicTree$({
            owner: repo.owner, repo: repo.repo, topicNumber: n,
          });
        } catch (err) {
          return throwError(() => err);
        }
      })();
      const p = firstValueFrom(tree$).then(res => {
        if (store.memoSeq() !== epoch) return null; // repo switch / refresh superseded
        const loading = store.treeLoading().filter(x => x !== n);
        const topic = res.topics[0] ?? null;
        if (topic) {
          patchState(store, {
            trees: { ...store.trees(), [n]: topic },
            treeFetchedAt: { ...store.treeFetchedAt(), [n]: res.fetchedAt },
            treeLoading: loading,
          });
        } else {
          patchState(store, {
            treeLoading: loading,
            treeErrors: { ...store.treeErrors(), [n]: 'empty subtree response' },
          });
        }
        return topic;
      }).catch(err => {
        if (store.memoSeq() !== epoch) return null;
        patchState(store, {
          treeLoading: store.treeLoading().filter(x => x !== n),
          treeErrors: { ...store.treeErrors(), [n]: errMessage(err) },
          ...(isRateLimit(err) ? { allTopicsDrained: true } : {}),
        });
        if (isRateLimit(err)) queue = [];
        return null;
      }).finally(() => {
        // Conditional — a stale-epoch promise must not delete the NEW
        // epoch's dedupe entry registered after dropMemo cleared the map
        // (review M2: otherwise a third trigger fires a duplicate call).
        if (inFlight.get(n) === p) inFlight.delete(n);
      });

      inFlight.set(n, p);
      return p;
    }

    // ── deep issue-number resolution (#1696) ────────────────────────────
    // The orchestration lives in topic-viewer-deep-resolve.ts — the
    // store keeps the trigger (setQuery's digit branch + debounce) and
    // hands the module its surface through DeepResolveHost.

    /** Debounce on the digit-query trigger — per-keystroke resolution
     *  would hammer the callable while the user is still typing.
     *  DestroyRef cleanup: a pending fire after teardown would patch a
     *  dead store (spec teardown, route-away). */
    const DEEP_RESOLVE_DEBOUNCE_MS = 350;
    let debounceTimer: ReturnType<typeof setTimeout> | null = null;
    inject(DestroyRef).onDestroy(() => {
      if (debounceTimer !== null) clearTimeout(debounceTimer);
    });

    /** selectTopic's patch — a closure so the resolver can share it:
     *  seed the root expanded (additive under all-topics so a resolution
     *  can't collapse sibling trees), clear query-scoped suppressions. */
    function doSelectTopic(number: number): void {
      patchState(store, {
        selectedTopicNumber: number,
        expandedIds: store.showAllTopics()
          ? [...new Set([...store.expandedIds(), number])]
          : [number],
        suppressedIds: [],
      });
    }

    /** The seam into the deep-resolve module — signals as callables,
     *  shared collaborators, the service's resolver wrapper as a
     *  promise, and patchState forwarded. */
    const deepResolveHost: DeepResolveHost = {
      selectedRepo: () => store.selectedRepo(),
      selectedTopicNumber: () => store.selectedTopicNumber(),
      resolveSeq: () => store.resolveSeq(),
      response: () => store.response(),
      expandedIds: () => store.expandedIds(),
      suppressedIds: () => store.suppressedIds(),
      showClosed: () => store.showClosed(),
      treeErrors: () => store.treeErrors(),
      resolveLifecycleIssue$: (req) => firstValueFrom(
        service.resolveLifecycleIssue$(req)),
      ensureTopic,
      selectRoot: doSelectTopic,
      patch: (p) => patchState(store, p),
    };

    function resolveIssueNumber(issueNumber: number): Promise<void> {
      return deepResolve(deepResolveHost, issueNumber);
    }

    /** Debounced trigger for digit queries (#1696 AC6) — a newer query
     *  supersedes the pending timer AND any in-flight resolution via
     *  resolveSeq. */
    function scheduleResolve(issueNumber: number): void {
      const seq = store.resolveSeq() + 1;
      patchState(store, { resolveSeq: seq });
      if (debounceTimer !== null) clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => {
        debounceTimer = null;
        if (store.resolveSeq() === seq) void resolveIssueNumber(issueNumber);
      }, DEEP_RESOLVE_DEBOUNCE_MS);
    }


    /** Rebuild the queue from the CURRENT filtered set — only unfetched,
     *  not-in-flight topics. Runs on all-topics enable and on any filter
     *  change while it's enabled (top-up). */
    function enqueueFiltered(): void {
      const memo = store.trees();
      const loading = new Set(store.treeLoading());
      queue = store.filteredTopics()
        .map(t => t.number)
        .filter(n => memo[n] === undefined && !loading.has(n));
      // Re-populating the queue IS the retry path — a drained flag left
      // set would show the drain notice over successfully loaded data.
      if (store.allTopicsDrained()) patchState(store, { allTopicsDrained: false });
      pump();
    }

    function pump(): void {
      while (queueActive < QUEUE_CONCURRENCY && queue.length) {
        const n = queue.shift()!;
        const gen = queueEpoch;
        queueActive++;
        try {
          void ensureTopic(n).finally(() => {
            // Stale dispatch — dropMemo already zeroed the counter and
            // the new epoch owns its own bookkeeping.
            if (gen !== queueEpoch) return;
            queueActive--;
            pump();
          });
        } catch {
          queueActive--; // synchronous dispatch throw must not leak the slot
        }
      }
    }

    return {
      /** Memo → in-flight join → fetch. Callers that only need the side
       *  effect fire-and-forget it; specs/refresh await the join. */
      ensureTopic,

      async selectRepo(index: number): Promise<void> {
        if (!store.repos()[index]) return; // dropdown can't emit this; guards programmatic calls
        if (index === store.selectedRepoIndex()) return;
        dropMemo();
        patchState(store, {
          selectedRepoIndex: index,
          response: null,
          selectedTopicNumber: null,
          expandedIds: [],
          suppressedIds: [],
          query: '', // the predicate belongs to the old dataset
          error: null,
          fetchedAt: null,
        });
        await fetchIndex();
        // All-topics stays on across a repo switch — re-queue the new
        // repo's filtered set (memo was just dropped wholesale).
        if (store.showAllTopics()) enqueueFiltered();
      },

      selectTopic(number: number): void {
        doSelectTopic(number);
        void ensureTopic(number); // subtree fetch — skeleton → tree (#1637)
      },

      /** Deep issue-number resolution (#1696) — map lookup → navigate;
       *  miss/stale → resolveLifecycleIssue fallback. setQuery's digit
       *  branch calls this via the debounce; specs drive it directly. */
      resolveIssueNumber,

      /** Index refetch → memo drop → refetch ONLY the rendered set
       *  (filtered topics in all-topics mode, the selection otherwise).
       *  A failed index fetch keeps the old index AND the memo. */
      async refresh(): Promise<void> {
        if (!await fetchIndex()) return;
        dropMemo();
        if (store.showAllTopics()) {
          enqueueFiltered();
        } else {
          const sel = store.selectedTopicNumber();
          if (sel !== null) void ensureTopic(sel);
        }
      },

      /** Toggle a node's *effective* expansion. Collapsing an
       *  auto-expanded match ancestor records a suppression instead of
       *  touching the manual set — re-toggling lifts the suppression.
       *  Nodes outside the auto-expansion toggle manual membership. */
      toggleExpanded(number: number): void {
        const manual = new Set(store.expandedIds());
        const suppressed = new Set(store.suppressedIds());
        const ancestors = store.matchInfo().ancestors;
        if (store.effectiveExpandedIds().has(number)) {
          manual.delete(number);
          if (ancestors.has(number)) suppressed.add(number);
        } else if (suppressed.has(number)) {
          suppressed.delete(number); // re-join the auto-expansion
        } else {
          manual.add(number);
        }
        patchState(store, {
          expandedIds: [...manual],
          suppressedIds: [...suppressed],
        });
      },

      expandAll(): void {
        // Opt-in expand overrides any active suppressions.
        patchState(store, {
          expandedIds: [...store.expandableIds()],
          suppressedIds: [],
        });
      },

      collapseAll(): void {
        // Explicit collapse-all wins over the auto-expansion too —
        // suppress the live ancestors rather than leave them expanded.
        patchState(store, {
          expandedIds: [],
          suppressedIds: [...store.matchInfo().ancestors],
        });
      },

      /** Direct setter — the checkbox binds $event.checked so state can't
       *  desync if showClosed is ever set elsewhere. Index-level filter
       *  only — no subtree calls from the toggle itself; in all-topics
       *  mode the widened set tops up the queue. */
      setShowClosed(v: boolean): void {
        patchState(store, { showClosed: v });
        if (store.showAllTopics()) enqueueFiltered();
      },

      setQuery(q: string): void {
        // An emptied query retires its suppressions — the tree returns
        // to exactly the manual expansion.
        patchState(store, {
          query: q,
          ...(q.trim() ? {} : { suppressedIds: [] }),
        });
        if (store.showAllTopics()) enqueueFiltered(); // top-up on filter change

        // Deep digit resolution (#1696): fires only when no VISIBLE
        // topic root already matches the number — root hits stay on the
        // existing index predicate. Non-digit queries retire any
        // resolution state and supersede in-flight work.
        const n = deepResolveCandidate(q);
        const cur = store.issueResolution();
        if (n !== null && cur?.issueNumber === n
            && (cur.phase === 'resolved' || cur.phase === 'resolving')) {
          return; // same number already landed or in flight — retyping
                  // is a no-op (a miss phase re-arms: the map may have
                  // healed since)
        }
        if (n !== null
            && !store.filteredTopics().some(t => t.number === n)) {
          scheduleResolve(n);
        } else {
          // A pending debounce carries no issueResolution yet — clear it
          // unconditionally or it fires under a superseding query (#1696
          // review: '30' → '30x' inside 350ms used to still resolve #30).
          const hadTimer = debounceTimer !== null;
          if (debounceTimer !== null) {
            clearTimeout(debounceTimer);
            debounceTimer = null;
          }
          if (hadTimer || cur !== null || store.resolvedNodeNumber() !== null) {
            patchState(store, {
              resolveSeq: store.resolveSeq() + 1,
              issueResolution: null,
              resolvedNodeNumber: null,
            });
          }
        }
      },

      setShowAllTopics(v: boolean): void {
        patchState(store, { showAllTopics: v });
        if (v) {
          patchState(store, { allTopicsDrained: false }); // re-enable = drain retry
          enqueueFiltered();
        } else {
          queue = []; // in-flight finish into the memo — revisit is free
        }
      },

      /** Re-arm the queue after a rate-limit drain — the drain
       *  notice's Resume path. enqueueFiltered rebuilds from the
       *  current filtered set and clears the flag itself. */
      resumeAllTopics(): void {
        if (store.showAllTopics()) enqueueFiltered();
      },

      /** Patch one node's labels wherever it lives — the index root
       *  AND any memoized subtree (#1637). Absent numbers are a no-op
       *  (container identities preserved). */
      applyLabelUpdate(issueNumber: number, labels: string[]): void {
        const res = store.response();
        if (res) {
          const next = patchLabelsInResponse(res, issueNumber, labels);
          if (next !== res) patchState(store, { response: next });
        }
        const memo = store.trees();
        let changed = false;
        const trees: Record<number, LifecycleNode> = {};
        for (const [key, t] of Object.entries(memo)) {
          const patched = patchNodeLabels(t, issueNumber, labels);
          trees[Number(key)] = patched;
          if (patched !== t) changed = true;
        }
        if (changed) patchState(store, { trees });
      },

      /** Issue-label write orchestration (#1531): delegates to the
       *  callable, patches the response on success, surfaces the error
       *  in the page banner on failure (response untouched). Returns
       *  the callable result, or null on failure. */
      async updateIssueLabels(
        issueNumber: number,
        add: string[],
        remove: string[],
      ): Promise<{ labels: string[]; created: string[] } | null> {
        const repo = store.selectedRepo();
        if (!repo) return null;
        const epoch = store.memoSeq();
        try {
          const res = await firstValueFrom(service.updateIssueLabels$({
            owner: repo.owner, repo: repo.repo,
            issueNumber, add, remove,
          }));
          // The write went to the OLD repo's data — a repo switch or
          // refresh during the await must not let its labels land on
          // the new dataset's same-numbered issue (review M3).
          if (store.memoSeq() !== epoch) return res;
          this.applyLabelUpdate(issueNumber, res.labels);
          patchState(store, { error: null }); // symmetric with the failure path
          return res;
        } catch (err) {
          patchState(store, { error: errMessage(err) });
          return null;
        }
      },
    };
  }),
);
