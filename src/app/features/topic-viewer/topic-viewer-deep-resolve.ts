/**
 * Deep issue-number resolution (#1696) — the orchestration behind
 * `TopicViewerStore.resolveIssueNumber`. Extracted from the store so the
 * file stays under the size budget; the store keeps the trigger
 * (setQuery's digit branch + debounce) and delegates landing to
 * `resolveIssueNumber` here.
 *
 * Flow: index-emitted `issueMap` → navigate; miss or stale →
 * `resolveLifecycleIssue` walks the GitHub parent chain; a returned
 * path navigates like a map hit; a pathless issue lives outside every
 * lifecycle tree; a thrown not-found means GitHub has no such issue.
 * One callable per resolution — a landed tree that still lacks the
 * node reports not-in-tree instead of looping.
 *
 * Resolver-discovered paths fold back into `response.issueMap` (the
 * same object the backend emits) — one number→root source of truth,
 * repo-keyed and epoch-guarded for free because `response` is replaced
 * on repo switch and refresh.
 */

import type {
  LifecycleNode,
  LifecycleResolveIssueRequest,
  LifecycleResolveIssueResponse,
  LifecycleTopic,
  LifecycleTreeResponse,
} from '@lifecycle/contracts';
import type { TopicViewerRepo } from './topic-viewer.service';

/** Deep resolution outcome — the page's scoped indicator copy driver.
 *  `resolved` carries the owning root; `not-in-tree` means the issue
 *  exists but lives outside every lifecycle tree (or a resolver path
 *  contradicted the fetched tree); `not-found` means GitHub has no such
 *  issue; `error` is infra. */
export type IssueResolution =
  | {
      issueNumber: number;
      phase: 'resolving' | 'not-in-tree' | 'not-found' | 'error';
      message: string | null;
      rootNumber: number | null;
    }
  | {
      issueNumber: number;
      phase: 'resolved';
      message: string | null;
      rootNumber: number;
    };

/** The store fields a resolution writes — the seam the host's `patch`
 *  forwards to patchState. */
export interface DeepResolvePatch {
  expandedIds?: number[];
  suppressedIds?: number[];
  response?: LifecycleTreeResponse | null;
  resolvedNodeNumber?: number | null;
  issueResolution?: IssueResolution | null;
  resolveSeq?: number;
}

/** The store surface the resolver reads — signals as callables, plus the
 *  two collaborators it shares with the store (ensureTopic's memo seam,
 *  the selectTopic patch) and the service's callable wrapper. */
export interface DeepResolveHost {
  selectedRepo(): TopicViewerRepo | null;
  selectedTopicNumber(): number | null;
  resolveSeq(): number;
  response(): LifecycleTreeResponse | null;
  expandedIds(): number[];
  suppressedIds(): number[];
  showClosed(): boolean;
  treeErrors(): Record<number, string>;
  resolveLifecycleIssue$(
    req: LifecycleResolveIssueRequest,
  ): Promise<LifecycleResolveIssueResponse>;
  ensureTopic(n: number): Promise<LifecycleTopic | null>;
  /** selectTopic's patch — seed the root expanded (additive under
   *  all-topics), clear query-scoped suppressions. */
  selectRoot(n: number): void;
  patch(p: DeepResolvePatch): void;
}

/** Digit query → deep-resolution candidate: `154`/`#154` → 154,
 *  anything else → null (title/label substrings stay index-side). */
export function deepResolveCandidate(q: string): number | null {
  const digits = q.trim().replace(/^#/, '');
  return /^\d+$/.test(digits) ? Number(digits) : null;
}

/** Inclusive root→target node chain, or null when the number isn't in
 *  the fetched tree (the stale-map signal). */
function findPathTo(
  root: LifecycleNode,
  target: number,
): LifecycleNode[] | null {
  if (root.number === target) return [root];
  for (const c of root.children) {
    const p = findPathTo(c, target);
    if (p) return [root, ...p];
  }
  return null;
}

/** Shared callable-error formatter — also imported by the store for its
 *  fetch/label error strings. */
export function errMessage(err: unknown): string {
  const code = (err as { code?: string })?.code;
  const msg = err instanceof Error ? err.message : String(err);
  return code ? `${code}: ${msg}` : msg;
}

type LandOutcome = 'resolved' | 'stale' | 'failed' | 'superseded';

/** Learn root mappings into the index response's issueMap itself — one
 *  source of truth (mirrors the BE upsert; dies with `response` on repo
 *  switch/refresh, matching the overlay semantics it replaces). */
function learnPath(
  host: DeepResolveHost,
  rootNumber: number,
  numbers: number[],
): void {
  const res = host.response();
  if (!res) return;
  const issueMap = { ...res.issueMap };
  for (const n of numbers) issueMap[n] = rootNumber;
  host.patch({ response: { ...res, issueMap } });
}

/** Navigate to a resolved node: select the root (only when the
 *  selection differs — re-selecting would reseed expansion), fetch the
 *  subtree, walk to the node, expand its ancestors through the MANUAL
 *  set (navigation, not query-matching — collapse behaves like a user
 *  collapse), and mark the resolved row. */
async function landOn(
  host: DeepResolveHost,
  issueNumber: number,
  rootNumber: number,
  seq: number,
): Promise<LandOutcome> {
  if (host.selectedTopicNumber() !== rootNumber) host.selectRoot(rootNumber);
  const tree = await host.ensureTopic(rootNumber);
  if (host.resolveSeq() !== seq) return 'superseded';
  if (!tree) {
    host.patch({
      issueResolution: {
        issueNumber, phase: 'error', rootNumber,
        message: host.treeErrors()[rootNumber]
          ?? `couldn't fetch the #${rootNumber} tree`,
      },
    });
    return 'failed';
  }
  const path = findPathTo(tree, issueNumber);
  if (!path) return 'stale';

  const expanded = new Set(host.expandedIds());
  for (const n of path.slice(0, -1)) expanded.add(n.number);
  learnPath(host, rootNumber, path.map(n => n.number));
  // selectRoot already clears suppressions when the selection differs —
  // this lift covers the same-root re-resolution where suppressions
  // survive and would keep the resolved ancestors hidden.
  const ancestorNums = new Set(path.slice(0, -1).map(n => n.number));
  const suppressed = host.suppressedIds()
    .filter(s => !ancestorNums.has(s));

  const target = path[path.length - 1];
  const hidden = !host.showClosed()
    && path.some(n => n.state === 'closed');
  const message = hidden
    ? (target.state === 'closed'
      ? `Issue #${issueNumber} is closed — enable Show closed to see it`
      : `Issue #${issueNumber} sits under a closed ancestor — enable Show closed`)
    : null;

  host.patch({
    expandedIds: [...expanded],
    suppressedIds: suppressed,
    resolvedNodeNumber: issueNumber,
    issueResolution: {
      issueNumber, phase: 'resolved', rootNumber, message,
    },
  });
  return 'resolved';
}

/** Cold/stale fallback: the BE resolver walks the GitHub parent chain.
 *  A returned path navigates like a map hit; a pathless issue lives
 *  outside every lifecycle tree; a thrown not-found means GitHub has no
 *  such issue. */
async function resolveViaCallable(
  host: DeepResolveHost,
  issueNumber: number,
  seq: number,
): Promise<void> {
  const repo = host.selectedRepo();
  if (!repo) {
    host.patch({
      issueResolution: {
        issueNumber, phase: 'error', rootNumber: null,
        message: 'no repository selected',
      },
    });
    return;
  }
  try {
    const res = await host.resolveLifecycleIssue$({
      owner: repo.owner, repo: repo.repo, issueNumber,
    });
    if (host.resolveSeq() !== seq) return;
    const path = res.path;
    if (path?.length) {
      learnPath(host, path[0], path);
      if (await landOn(host, issueNumber, path[0], seq) === 'stale') {
        host.patch({
          issueResolution: {
            issueNumber, phase: 'not-in-tree', rootNumber: path[0],
            message: `Issue #${issueNumber} resolved under #${path[0]} but isn't in the fetched tree — try Refresh`,
          },
        });
      }
      return;
    }
    host.patch({
      issueResolution: {
        issueNumber, phase: 'not-in-tree', rootNumber: null,
        message: `Issue #${issueNumber} — ${res.issue.title} — isn't in a lifecycle tree`,
      },
    });
  } catch (err) {
    if (host.resolveSeq() !== seq) return;
    const code = (err as { code?: string })?.code ?? '';
    host.patch({
      issueResolution: code.includes('not-found')
        ? {
            issueNumber, phase: 'not-found', rootNumber: null,
            message: `Issue #${issueNumber} doesn't exist in ${repo.owner}/${repo.repo}`,
          }
        : {
            issueNumber, phase: 'error', rootNumber: null,
            message: errMessage(err),
          },
    });
  }
}

/** The resolution entry point — bump the epoch, mark resolving, then
 *  map-hit → land / miss-or-stale → callable fallback. */
export function resolveIssueNumber(
  host: DeepResolveHost,
  issueNumber: number,
): Promise<void> {
  const seq = host.resolveSeq() + 1;
  const root = host.response()?.issueMap?.[issueNumber];
  host.patch({
    resolveSeq: seq,
    resolvedNodeNumber: null,
    issueResolution: {
      issueNumber, phase: 'resolving', message: null,
      // A map hit knows its root upfront — the filtered set shows the
      // section's skeleton while the subtree fetch is in flight.
      rootNumber: root ?? null,
    },
  });
  return root !== undefined
    ? landOn(host, issueNumber, root, seq).then(o => {
        // stale map → the callable fallback resolves once more
        if (o === 'stale') return resolveViaCallable(host, issueNumber, seq);
        return undefined;
      })
    : resolveViaCallable(host, issueNumber, seq);
}
