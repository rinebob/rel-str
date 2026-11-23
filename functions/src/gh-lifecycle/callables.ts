/**
 * @topic #619 — GitHub read-only issue UI (tasks #640, #1635, #1695)
 *
 * Lifecycle tree callables — thin wrappers: auth guard → deps → fetch →
 * shared transforms → LifecycleTreeResponse. All GitHub I/O lives in
 * github-client.ts; all tree logic in shared/. GitHub stays read-only;
 * the issue-map Firestore doc is written by tree-fetch maintenance
 * (#1695 — see issue-map.ts). resolveLifecycleIssue lives in
 * resolve-callable.ts.
 */

import { onCall, HttpsError } from 'firebase-functions/v2/https';
import type { CallableRequest } from 'firebase-functions/v2/https';
import type {
  LifecycleRepoRequest,
  LifecycleTopicTreeRequest,
  LifecycleTreeResponse,
} from '@lifecycle/contracts';
import {
  assignGroups,
  buildTree,
  isTopicRoot,
  parseInventoryGroups,
  type LifecycleInventoryGroup,
} from '@lifecycle/tree';
import { OPTIONS_STRATEGY_ALLOWED_ORIGINS } from '../paper-trading/engine/options-strategy-cors';
import { SUPPORTED_REPOS, type SupportedRepo } from './config';
import {
  fetchFileText,
  githubGql,
  GitHubApiError,
} from './github-client';
import {
  fetchIssueAncestorChain,
  fetchLifecycleData,
  fetchTopicIndexData,
  fetchTopicRootRef,
  fetchTopicSubtreeData,
  type IssueAncestorChain,
  type LifecycleFetchResult,
  type TopicRootRef,
} from './lifecycle-fetch';
import {
  readIssueMap,
  syncIssueMapFromTree,
  upsertIssueMapEntries,
} from './issue-map';

const INVENTORY_PATH = 'docs/dev-notes/TOPICS-INVENTORY.md';

// ── Dependencies ──────────────────────────────────────────────────────────

export interface GhLifecycleDeps {
  fetchData: (entry: SupportedRepo) => Promise<LifecycleFetchResult>;
  /** Slim roots-only fetch for the topic index — no subIssues expansion. */
  fetchIndexData: (entry: SupportedRepo) => Promise<LifecycleFetchResult>;
  /** Root probe for the per-topic callable — null when the issue is gone. */
  fetchTopicRef: (entry: SupportedRepo, topicNumber: number) => Promise<TopicRootRef | null>;
  /** BFS over one root's subtree — identical semantics to the monolith walk. */
  fetchSubtreeData: (entry: SupportedRepo, root: { number: number; id: string }) => Promise<LifecycleFetchResult>;
  /** Raw TOPICS-INVENTORY.md; null on 404. Throws for other failures. */
  fetchInventoryDoc: (entry: SupportedRepo) => Promise<string | null>;
  /** issueNumber → rootTopicNumber for the repo ({} on missing doc). */
  readIssueMap: (entry: SupportedRepo) => Promise<Record<number, number>>;
  /** Upsert a fetched subtree into the map + prune stale entries for that root. */
  syncIssueMapFromTree: (entry: SupportedRepo, data: LifecycleFetchResult) => Promise<void>;
  /** Upsert resolved issue→root entries (resolver writes). */
  upsertIssueMapEntries: (entry: SupportedRepo, entries: Record<number, number>) => Promise<void>;
  /** resolveIssue's parent-chain walk; null when the issue doesn't exist. */
  fetchIssueChain: (entry: SupportedRepo, issueNumber: number) => Promise<IssueAncestorChain | null>;
}

/** Production deps — exported so the verify script shares one wiring. */
export function ghLifecycleDeps(): GhLifecycleDeps {
  const token = process.env.GITHUB_READ_TOKEN;
  if (!token) {
    throw new HttpsError(
      'failed-precondition',
      'GITHUB_READ_TOKEN secret is not configured — see task #638',
    );
  }
  const gql = githubGql(token);
  return {
    fetchData: entry => fetchLifecycleData(entry, gql),
    fetchIndexData: entry => fetchTopicIndexData(entry, gql),
    fetchTopicRef: (entry, topicNumber) => fetchTopicRootRef(entry, topicNumber, gql),
    fetchSubtreeData: (entry, root) => fetchTopicSubtreeData(entry, root, gql),
    fetchInventoryDoc: entry => fetchFileText(token, entry, INVENTORY_PATH),
    readIssueMap: async entry => readIssueMap(await issueMapDb(), entry),
    syncIssueMapFromTree: async (entry, data) => syncIssueMapFromTree(await issueMapDb(), entry, data),
    upsertIssueMapEntries: async (entry, entries) => upsertIssueMapEntries(await issueMapDb(), entry, entries),
    fetchIssueChain: (entry, issueNumber) => fetchIssueAncestorChain(entry, issueNumber, gql),
  };
}

/** Lazy Firestore handle — dynamic import keeps module load side-effect
 *  free so handler tests never pay admin-init (and never hit the
 *  settings() re-init trap on fresh imports). */
let issueMapDbPromise: Promise<typeof import('../firebase-admin-init')['db']> | undefined;
function issueMapDb() {
  return (issueMapDbPromise ??= import('../firebase-admin-init').then(m => m.db));
}

// ── Handler ───────────────────────────────────────────────────────────────

export function mapGitHubError(err: GitHubApiError): HttpsError {
  if (err.rateLimited) {
    return new HttpsError('resource-exhausted', `GitHub rate-limited: ${err.message}`);
  }
  switch (err.status) {
    case 401:
      return new HttpsError(
        'unauthenticated',
        `GitHub rejected the token (is GITHUB_READ_TOKEN expired?): ${err.message}`,
      );
    case 403:
      return new HttpsError(
        'permission-denied',
        `GitHub denied the token (is GITHUB_READ_TOKEN scoped for this repo?): ${err.message}`,
      );
    default:
      return new HttpsError('internal', `GitHub request failed: ${err.message}`);
  }
}

/** Wrap non-HttpsError failures — raw backend errors never leak to clients. */
export async function internalGuard<T>(label: string, fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof HttpsError) throw err;
    throw new HttpsError(
      'internal',
      `${label} failed: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

export async function handleGetLifecycleTree(
  request: CallableRequest<LifecycleRepoRequest>,
  deps: GhLifecycleDeps,
): Promise<LifecycleTreeResponse> {
  return internalGuard('getLifecycleTree', () => handle(request, deps));
}

export async function handleGetLifecycleTopicIndex(
  request: CallableRequest<LifecycleRepoRequest>,
  deps: GhLifecycleDeps,
): Promise<LifecycleTreeResponse> {
  return internalGuard('getLifecycleTopicIndex', () => handleIndex(request, deps));
}

export async function handleGetLifecycleTopicTree(
  request: CallableRequest<LifecycleTopicTreeRequest>,
  deps: GhLifecycleDeps,
): Promise<LifecycleTreeResponse> {
  return internalGuard('getLifecycleTopicTree', () => handleTopic(request, deps));
}

/** Shared validation for all gh-lifecycle callables — auth + repo pair. */
export function resolveSupportedRepo(data: unknown): SupportedRepo {
  const { owner, repo } = (data ?? {}) as { owner?: unknown; repo?: unknown };
  if (typeof owner !== 'string' || typeof repo !== 'string' || !owner || !repo) {
    throw new HttpsError('invalid-argument', 'expected { owner, repo }');
  }
  const entry = SUPPORTED_REPOS.find(r => r.owner === owner && r.repo === repo);
  if (!entry) {
    throw new HttpsError('invalid-argument', `unsupported repo ${owner}/${repo}`);
  }
  return entry;
}

/** Shared positive-int field validation — GitHub's Int is signed 32-bit,
 *  so a larger integer would pass Number.isInteger but coerce to a
 *  GraphQL error mid-probe. */
export function requirePositiveInt(data: unknown, field: string): number {
  const v = (data as Record<string, unknown> | null | undefined)?.[field];
  if (typeof v !== 'number' || !Number.isSafeInteger(v) || v <= 0 || v > 2_147_483_647) {
    throw new HttpsError('invalid-argument', `expected { owner, repo, ${field}: positive integer }`);
  }
  return v;
}

async function handle(
  request: CallableRequest<LifecycleRepoRequest>,
  deps: GhLifecycleDeps,
): Promise<LifecycleTreeResponse> {
  if (!request.auth?.uid) throw new HttpsError('unauthenticated', 'unauthenticated');
  const entry = resolveSupportedRepo(request.data);
  return fetchAndAssemble(entry, deps, deps.fetchData);
}

/** Index variant — identical pipeline over the slim roots-only fetch.
 *  `childrenOf` is empty by construction, so every topic lands with
 *  `children: []`. */
async function handleIndex(
  request: CallableRequest<LifecycleRepoRequest>,
  deps: GhLifecycleDeps,
): Promise<LifecycleTreeResponse> {
  if (!request.auth?.uid) throw new HttpsError('unauthenticated', 'unauthenticated');
  const entry = resolveSupportedRepo(request.data);
  const response = await fetchAndAssemble(entry, deps, deps.fetchIndexData);
  // issueMap emit — best-effort: a Firestore hiccup must not kill the
  // index; the FE falls back to resolveLifecycleIssue on a miss.
  try {
    const issueMap = await deps.readIssueMap(entry);
    if (Object.keys(issueMap).length > 0) response.issueMap = issueMap;
  } catch (err) {
    console.warn('getLifecycleTopicIndex: issueMap read failed — omitting', err);
  }
  return response;
}

/** Per-topic variant — same assembly pipeline after probe + topicNumber
 *  validation: unknown issue → not-found; a real issue that isn't a
 *  `Topic:` root → invalid-argument (never walks a non-topic subtree). */
async function handleTopic(
  request: CallableRequest<LifecycleTopicTreeRequest>,
  deps: GhLifecycleDeps,
): Promise<LifecycleTreeResponse> {
  if (!request.auth?.uid) throw new HttpsError('unauthenticated', 'unauthenticated');
  const entry = resolveSupportedRepo(request.data);
  const topicNumber = requirePositiveInt(request.data, 'topicNumber');
  let ref: TopicRootRef | null;
  try {
    ref = await deps.fetchTopicRef(entry, topicNumber);
  } catch (err) {
    throw err instanceof GitHubApiError ? mapGitHubError(err) : err;
  }
  if (!ref) {
    throw new HttpsError('not-found', `issue #${topicNumber} not found in ${entry.owner}/${entry.repo}`);
  }
  if (!isTopicRoot(ref.title)) {
    throw new HttpsError('invalid-argument', `issue #${topicNumber} is not a Topic root`);
  }
  return fetchAndAssemble(entry, deps, async e => {
    const fetched = await deps.fetchSubtreeData(e, ref);
    // Map maintenance rides every *complete* tree fetch — a truncated
    // walk would make honest entries look stale, so the guard that
    // fails the response also gates the write. Sync failures are
    // logged, never fail the response (the map is an accelerator).
    try {
      if (fetched.truncatedNodes === 0) await deps.syncIssueMapFromTree(e, fetched);
    } catch (err) {
      console.warn(`getLifecycleTopicTree: issueMap sync failed for #${ref.number}`, err);
    }
    return fetched;
  });
}

/** fetch → error-map → assemble — the post-validation body shared by
 *  every tree-producing handler (monolith, index; the per-topic handler
 *  resolves the same seam after its own request validation). */
async function fetchAndAssemble(
  entry: SupportedRepo,
  deps: GhLifecycleDeps,
  fetchData: (entry: SupportedRepo) => Promise<LifecycleFetchResult>,
): Promise<LifecycleTreeResponse> {
  let data: LifecycleFetchResult;
  try {
    data = await fetchData(entry);
  } catch (err) {
    throw err instanceof GitHubApiError ? mapGitHubError(err) : err;
  }
  return assembleTreeResponse(data, entry, deps);
}

/** Truncation guard → inventory grouping → tree assembly — shared by the
 *  monolith, index, and per-topic handlers so all three degrade and warn
 *  identically. */
async function assembleTreeResponse(
  data: LifecycleFetchResult,
  entry: SupportedRepo,
  deps: GhLifecycleDeps,
): Promise<LifecycleTreeResponse> {
  if (data.truncatedNodes > 0) {
    throw new HttpsError(
      'internal',
      `lifecycle tree truncated — ${data.truncatedNodes} node(s) could not be fully fetched`,
    );
  }

  const fetchedAt = new Date().toISOString(); // stamp at data-ready time (post-walk)

  let groupingWarning: string | undefined;
  let groups: LifecycleInventoryGroup[] | null = null;
  try {
    const md = await deps.fetchInventoryDoc(entry);
    if (md !== null) {
      // null = no "## Open Topics" section or zero parseable groups —
      // the doc exists but drifted; warn so the UI can distinguish it
      // from a 404 (no doc → flat Ungrouped, no warning).
      const parsed = parseInventoryGroups(md);
      if (parsed === null) {
        groupingWarning = 'TOPICS-INVENTORY.md parsed to zero groups — showing ungrouped';
      } else {
        groups = parsed;
      }
    }
  } catch (err) {
    // Non-404 doc failure is non-fatal: flat sections + a sanitized warning
    // (never the raw upstream body — it goes to the client verbatim).
    groupingWarning = err instanceof GitHubApiError
      ? `grouping unavailable: GitHub ${err.status}${err.rateLimited ? ' (rate-limited)' : ''}`
      : `grouping unavailable: ${err instanceof Error ? err.message : String(err)}`;
  }

  const trees = buildTree(data.roots, data.childrenOf, data.statusOf);
  const { topics, groupOrder } = assignGroups(trees, groups);
  // Drift the parser can't catch: the doc parsed but lists none of the
  // fetched roots — every topic silently lands Ungrouped. Surface it
  // through the same degrade banner as the other doc failures.
  if (groups !== null && groups.length > 0 && topics.length > 0
      && !topics.some(t => groups.some(g => g.topicNumbers.includes(t.number)))) {
    groupingWarning = 'TOPICS-INVENTORY.md listed none of the fetched topics — doc may be stale';
  }
  return {
    topics,
    groupOrder,
    fetchedAt,
    ...(groupingWarning ? { groupingWarning } : {}),
  };
}

// ── Callable export ───────────────────────────────────────────────────────

export const getLifecycleTree = onCall<LifecycleRepoRequest, Promise<LifecycleTreeResponse>>(
  {
    cors: OPTIONS_STRATEGY_ALLOWED_ORIGINS,
    secrets: ['GITHUB_READ_TOKEN'],
    timeoutSeconds: 120,
    memory: '512MiB',
  },
  (request) => handleGetLifecycleTree(request, ghLifecycleDeps()),
);

/** Slim topic index — one search + one nodes() batch, seconds not
 *  30-60s; the left pane's default fetch under lazy loading (#1635). */
export const getLifecycleTopicIndex = onCall<LifecycleRepoRequest, Promise<LifecycleTreeResponse>>(
  {
    cors: OPTIONS_STRATEGY_ALLOWED_ORIGINS,
    secrets: ['GITHUB_READ_TOKEN'],
    timeoutSeconds: 60,
    memory: '512MiB',
  },
  (request) => handleGetLifecycleTopicIndex(request, ghLifecycleDeps()),
);

/** One topic's full subtree — probe + isTopicRoot guard + the monolith's
 *  BFS seeded with a single root (#1636). Lazy-loaded on expand/click;
 *  same 120s budget as the monolith since a fat topic still pages to
 *  completion. */
export const getLifecycleTopicTree = onCall<LifecycleTopicTreeRequest, Promise<LifecycleTreeResponse>>(
  {
    cors: OPTIONS_STRATEGY_ALLOWED_ORIGINS,
    secrets: ['GITHUB_READ_TOKEN'],
    timeoutSeconds: 120,
    memory: '512MiB',
  },
  (request) => handleGetLifecycleTopicTree(request, ghLifecycleDeps()),
);
