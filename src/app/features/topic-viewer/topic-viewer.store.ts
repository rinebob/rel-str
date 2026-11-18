/**
 * TopicViewerStore — NgRx SignalStore for the topic-viewer page
 * (Topic #619 / Blueprint #635 / task #642).
 *
 * Owns the fetched LifecycleTreeResponse and maps it to the view models
 * the page renders — grouped topic list (left pane) + flattened visible
 * tree of the selected topic (right pane). v2 view state (#1531): sort
 * modes, search predicate + in-tree match expansion, all-topics browse,
 * and the label-write patch path (updateIssueLabels orchestrates the
 * callable; applyLabelUpdate patches the response in place).
 */

import { computed, inject } from '@angular/core';
import {
  signalStore,
  withState,
  withComputed,
  withMethods,
  patchState,
} from '@ngrx/signals';
import { firstValueFrom } from 'rxjs';

import type {
  LifecycleNode,
  LifecycleTopic,
  LifecycleTreeResponse,
} from '@lifecycle/contracts';
import {
  TOPIC_VIEWER_REPOS,
  TopicViewerService,
  type TopicViewerRepo,
} from './topic-viewer.service';

export interface TopicRow {
  number: number;
  title: string;
  stageLabel?: string;
  status?: string;
  closed: boolean;
}

export interface TopicSectionVm {
  name: string;
  topics: TopicRow[];
}

export interface TreeRow {
  node: LifecycleNode;
  depth: number;
}

export type TopicSortMode = 'grouped' | 'number';

/** The single left-pane view model (#1531) — the pane binds this one
 *  signal and branches on `mode`: section headers + rows in grouped
 *  mode, a flat number-ascending list in number mode. */
export type VisibleTopics =
  | { mode: 'grouped'; sections: TopicSectionVm[] }
  | { mode: 'number'; topics: TopicRow[] };

/** One section's flattened trees in all-topics mode (#1531). */
export interface AllSectionRows {
  name: string;
  rows: TreeRow[];
}

interface LifecycleState {
  repos: TopicViewerRepo[];
  selectedRepoIndex: number;
  response: LifecycleTreeResponse | null;
  selectedTopicNumber: number | null;
  expandedIds: number[];
  /** Explicit user collapses of auto-expanded match ancestors —
   *  subtracted from the effective expansion; cleared when the query
   *  empties or the selected tree/repo changes. */
  suppressedIds: number[];
  showClosed: boolean;
  sortMode: TopicSortMode;
  query: string;
  showAllTopics: boolean;
  loading: boolean;
  error: string | null;
  fetchedAt: string | null;
  /** Monotonic fetch token — late-arriving responses for a switched-away
   *  repo are discarded (stale-response guard). */
  fetchSeq: number;
}

const initialState: LifecycleState = {
  repos: TOPIC_VIEWER_REPOS,
  selectedRepoIndex: 0,
  response: null,
  selectedTopicNumber: null,
  expandedIds: [],
  suppressedIds: [],
  showClosed: false,
  sortMode: 'grouped',
  query: '',
  showAllTopics: false,
  loading: false,
  error: null,
  fetchedAt: null,
  fetchSeq: 0,
};

function errMessage(err: unknown): string {
  const code = (err as { code?: string })?.code;
  const msg = err instanceof Error ? err.message : String(err);
  return code ? `${code}: ${msg}` : msg;
}

function toRow(n: LifecycleNode): TopicRow {
  return {
    number: n.number,
    title: n.title,
    stageLabel: n.stageLabel,
    status: n.status,
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
  const digits = needle.replace(/^#/, '');
  if (/^\d+$/.test(digits) && n.number === Number(digits)) return true;
  return n.labels.some(l => l.toLowerCase().includes(needle));
}

const hasQuery = (q: string): boolean => q.trim().length > 0;

/** Fold flat topics into groupOrder-named sections (contract v2 fold —
 *  shared by topicSections and the all-topics row builder so the two
 *  views can never disagree on grouping). */
function foldGroups(
  topics: LifecycleTopic[],
  groupOrder: string[],
): { name: string; topics: LifecycleTopic[] }[] {
  const byGroup = new Map<string, LifecycleTopic[]>();
  for (const t of topics) {
    const list = byGroup.get(t.group) ?? [];
    list.push(t);
    byGroup.set(t.group, list);
  }
  const byNumber = (a: LifecycleTopic, b: LifecycleTopic) => a.number - b.number;
  const names = [
    ...groupOrder,
    // Safety net: a stamped group absent from groupOrder still renders.
    ...[...byGroup.keys()].filter(n => !groupOrder.includes(n)),
  ];
  return names
    .map(name => ({ name, topics: (byGroup.get(name) ?? []).sort(byNumber) }))
    .filter(s => s.topics.length > 0);
}

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

/** Immutably patch one node's labels inside the response — returns the
 *  same response when the number isn't present (no spurious identity
 *  change for downstream computeds). */
function patchLabelsInResponse(
  res: LifecycleTreeResponse,
  issueNumber: number,
  labels: string[],
): LifecycleTreeResponse {
  const patch = <T extends LifecycleNode>(n: T): T => {
    if (n.number === issueNumber) return { ...n, labels: [...labels] };
    if (!n.children.length) return n;
    const kids = n.children.map(patch);
    return kids.some((k, i) => k !== n.children[i])
      ? { ...n, children: kids }
      : n;
  };
  const topics = res.topics.map(patch);
  return topics.every((t, i) => t === res.topics[i])
    ? res
    : { ...res, topics };
}

export const TopicViewerStore = signalStore(
  { providedIn: 'root' },
  withState(initialState),

  withComputed((store) => ({
    /** Topics passing the closed filter AND the search predicate
     *  (#1531) — the single filtered set every view consumes. */
    filteredTopics: computed<LifecycleTopic[]>(() => {
      const res = store.response();
      if (!res) return [];
      const showClosed = store.showClosed();
      const q = store.query();
      const needle = q.trim().toLowerCase();
      return res.topics.filter(
        t => (showClosed || t.state !== 'closed') && matchesQuery(t, needle));
    }),

    selectedRepo: computed(() => store.repos()[store.selectedRepoIndex()] ?? null),

    /** BE-side degrade notice (inventory doc failed non-404 / parsed
     *  empty) — surfaced by the page so flat sections aren't silent. */
    groupingWarning: computed(() => store.response()?.groupingWarning ?? null),

    /** The selected topic's node — looked up in the live response. */
    selectedTopic: computed<LifecycleNode | null>(() => {
      const num = store.selectedTopicNumber();
      const res = store.response();
      if (num === null || !res) return null;
      return res.topics.find(t => t.number === num) ?? null;
    }),
  })),

  // Second block — these computeds consume first-block computeds.
  withComputed((store) => ({
    /** Grouped topic list — flat `topics` folded into `groupOrder`
     *  sections (contract v2, #1522); closed topics hidden unless
     *  showClosed; emptied sections dropped (incl. query-emptied).
     *  Intra-group order is issue-number ascending — deterministic and
     *  stable across refreshes. Identical to the pre-search view when
     *  the query is empty. */
    topicSections: computed<TopicSectionVm[]>(() => {
      const res = store.response();
      if (!res) return [];
      return foldGroups(store.filteredTopics(), res.groupOrder)
        .map(s => ({ name: s.name, topics: s.topics.map(toRow) }));
    }),

    /** In-tree search derivation — one walk per rendered root yields
     *  the match set AND the ancestors that must auto-expand to surface
     *  them. Scope = the trees the page renders: every filtered topic in
     *  all-topics mode, the selected topic otherwise (#1532). The match
     *  itself is NOT an ancestor (its children stay hidden). Empty sets
     *  without a query; closed nodes only count under showClosed. */
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
        ? store.filteredTopics()
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
  })),

  // Third block — view dispatch + match signals consume second-block
  // computeds (topicSections/filteredTopics/matchInfo).
  withComputed((store) => ({
    /** The left pane's view model — grouped sections or the flat
     *  number-ascending list depending on sortMode (#1531). */
    visibleTopics: computed<VisibleTopics>(() =>
      store.sortMode() === 'grouped'
        ? { mode: 'grouped', sections: store.topicSections() }
        : {
            mode: 'number',
            topics: [...store.filteredTopics()]
              .sort((a, b) => a.number - b.number)
              .map(toRow),
          }),


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

    /** Node ids that are expandable (have *visible* children) — expandAll
     *  target. A node whose children are all closed isn't expandable when
     *  showClosed is off, same rule the tree caret applies. In
     *  all-topics mode the set spans every filtered tree. */
    expandableIds: computed<number[]>(() => {
      const showClosed = store.showClosed();
      const visible = (n: LifecycleNode) =>
        n.children.filter(c => showClosed || c.state === 'open');
      const sel = store.selectedTopic();
      const roots: LifecycleNode[] = store.showAllTopics()
        ? store.filteredTopics()
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
  })),

  // Fourth block — flattened rows consume the effective expansion.
  withComputed((store) => ({
    /** Flattened visible rows of the selected topic — a node emits its
     *  children only when its number is in the effective expansion.
     *  Closed nodes filtered unless showClosed. */
    treeRows: computed<TreeRow[]>(() => {
      const topic = store.selectedTopic();
      if (!topic) return [];
      return flattenTopic(
        topic, store.effectiveExpandedIds(), store.showClosed());
    }),

    /** Every filtered section's flattened trees for the all-topics
     *  right pane (#1531) — roots collapsed unless expanded. */
    allSectionsRows: computed<AllSectionRows[]>(() => {
      const res = store.response();
      if (!res) return [];
      const expanded = store.effectiveExpandedIds();
      const showClosed = store.showClosed();
      return foldGroups(store.filteredTopics(), res.groupOrder)
        .map(s => ({
          name: s.name,
          rows: s.topics.flatMap(t => flattenTopic(t, expanded, showClosed)),
        }));
    }),

  })),

  withMethods((store) => {
    const service = inject(TopicViewerService);

    async function fetch(): Promise<void> {
      const repo = store.selectedRepo();
      if (!repo) return;
      const seq = store.fetchSeq() + 1;
      patchState(store, { fetchSeq: seq, loading: true, error: null });
      try {
        const response = await firstValueFrom(
          service.getLifecycleTree$({ owner: repo.owner, repo: repo.repo }));
        if (store.fetchSeq() !== seq) return; // stale — a newer fetch owns the slot
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
      } catch (err) {
        if (store.fetchSeq() !== seq) return;
        patchState(store, {
          loading: false,
          error: errMessage(err), // previous response kept — tree stays up under the banner
        });
      }
    }

    return {
      async selectRepo(index: number): Promise<void> {
        if (!store.repos()[index]) return; // dropdown can't emit this; guards programmatic calls
        if (index === store.selectedRepoIndex()) return;
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
        await fetch();
      },

      selectTopic(number: number): void {
        // Seed the root expanded — depth-1 rows (threads) visible by
        // default. In all-topics mode the seed is additive: reseeding
        // would collapse every other rendered tree (#1532 review).
        patchState(store, {
          selectedTopicNumber: number,
          expandedIds: store.showAllTopics()
            ? [...new Set([...store.expandedIds(), number])]
            : [number],
          suppressedIds: [], // suppressions are scoped to the old tree's query
        });
      },

      async refresh(): Promise<void> {
        await fetch();
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
       *  desync if showClosed is ever set elsewhere. */
      setShowClosed(v: boolean): void {
        patchState(store, { showClosed: v });
      },

      setSortMode(mode: TopicSortMode): void {
        patchState(store, { sortMode: mode });
      },

      setQuery(q: string): void {
        // An emptied query retires its suppressions — the tree returns
        // to exactly the manual expansion.
        patchState(store, {
          query: q,
          ...(q.trim() ? {} : { suppressedIds: [] }),
        });
      },

      setShowAllTopics(v: boolean): void {
        patchState(store, { showAllTopics: v });
      },

      /** Patch one node's labels in the stored response after a
       *  successful write — the tree updates in place without a refetch.
       *  Absent numbers are a no-op (response identity preserved). */
      applyLabelUpdate(issueNumber: number, labels: string[]): void {
        const res = store.response();
        if (!res) return;
        const next = patchLabelsInResponse(res, issueNumber, labels);
        if (next !== res) patchState(store, { response: next });
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
        try {
          const res = await firstValueFrom(service.updateIssueLabels$({
            owner: repo.owner, repo: repo.repo,
            issueNumber, add, remove,
          }));
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
