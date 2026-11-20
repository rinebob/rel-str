/**
 * @topic #619 — GitHub read-only issue UI (task #639)
 *
 * GraphQL BFS fetch shell for getLifecycleTree / getLifecycleTopicIndex /
 * getLifecycleTopicTree: paginated topic-root search -> level-batched
 * node expansion -> mandatory truncation counting. The "never silently
 * miss issues" guarantee lives in `truncatedNodes`: callers throw on
 * nonzero. Transport lives in github-client.ts; tree logic in shared/.
 */

import { isTopicRoot, type LifecycleRawIssue } from '@lifecycle/tree';
import type { SupportedRepo } from './config';
import { GitHubApiError, type Gql } from './github-client';

export interface LifecycleFetchResult {
  roots: LifecycleRawIssue[];
  /** Issue number → its children (records), in sub-issue order. */
  childrenOf: Map<number, LifecycleRawIssue[]>;
  /** Issue number → Project Status field name, configured project only. */
  statusOf: Map<number, string>;
  /** Nodes whose subIssues could not be fully paged — must be 0. */
  truncatedNodes: number;
}

const SEARCH_PAGE = `query($q: String!, $after: String) {
  search(query: $q, type: ISSUE, first: 100, after: $after) {
    issueCount
    nodes { ... on Issue { number id title } }
    pageInfo { hasNextPage endCursor }
  }
}`;

// labels(first:50) soft-degrades — >50 labels misses the tail.
const ISSUE_FIELDS_CORE = `number id title state url updatedAt
  labels(first: 50) { nodes { name } }
  projectItems(first: 10) { nodes {
    project { number }
    fieldValues(first: 20) { nodes {
      ... on ProjectV2ItemFieldSingleSelectValue {
        name
        field { ... on ProjectV2SingleSelectField { name } }
      }
    } }
  } }`;

const ISSUE_FIELDS = `${ISSUE_FIELDS_CORE}
  subIssues(first: 100) {
    nodes { number id }
    totalCount
    pageInfo { hasNextPage endCursor }
  }`;

const NODES_BATCH = `query($ids: [ID!]!) {
  nodes(ids: $ids) { ... on Issue { ${ISSUE_FIELDS} } }
}`;

/** Slim per-root expansion for the topic index — identical metadata to
 *  NODES_BATCH minus the subIssues connection the index never reads. */
const INDEX_NODES_BATCH = `query($ids: [ID!]!) {
  nodes(ids: $ids) { ... on Issue { ${ISSUE_FIELDS_CORE} } }
}`;

const SUBISSUES_PAGE = `query($owner: String!, $repo: String!, $issueNumber: Int!, $after: String) {
  repository(owner: $owner, name: $repo) {
    issue(number: $issueNumber) {
      subIssues(first: 100, after: $after) {
        nodes { number id }
        totalCount
        pageInfo { hasNextPage endCursor }
      }
    }
  }
}`;

const BATCH_SIZE = 50;
const SUBISSUES_PAGE_CAP = 50; // hard stop: >5000 sub-issues on one node is absurd

const ISSUE_PROBE = `query($owner: String!, $repo: String!, $issueNumber: Int!) {
  repository(owner: $owner, name: $repo) {
    issue(number: $issueNumber) { number id title }
  }
}`;

interface PageInfo { hasNextPage: boolean; endCursor: string | null }
interface SubRef { number: number; id: string }
/** Root-probe result for the per-topic callable — SubRef plus the title
 *  the isTopicRoot guard needs. */
export interface TopicRootRef { number: number; id: string; title: string }
interface SubConn {
  nodes: SubRef[];
  totalCount: number;
  pageInfo: PageInfo;
}

function chunks<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

async function searchTopicRoots(
  entry: SupportedRepo,
  gql: Gql,
): Promise<{ refs: SubRef[]; truncated: boolean }> {
  const q = `repo:${entry.owner}/${entry.repo} is:issue Topic: in:title`;
  const refs: SubRef[] = [];
  let after: string | null = null;
  let issueCount = 0;
  // Raw search hits seen — fake roots ("Thread: Topic X") match the
  // substring search but are filtered below, so truncation must count
  // hits seen, not refs kept.
  let seen = 0;
  let hasNext = true;
  do {
    const data = await gql(SEARCH_PAGE, { q, after });
    const page = data.search;
    if (!page) throw new GitHubApiError(200, false, 'GitHub GraphQL: missing search payload');
    issueCount = page.issueCount ?? issueCount;
    for (const n of page.nodes ?? []) {
      // A hit we can't classify (no id/number/title) is a MISSED hit —
      // it stays under issueCount and trips the truncation guard rather
      // than being silently dropped.
      if (!n?.id || typeof n.number !== 'number' || typeof n.title !== 'string') continue;
      seen++;
      // Fake roots are dropped pre-BFS — they can never steal real
      // nodes via buildTree dedup or render as topics.
      if (isTopicRoot(n.title)) refs.push({ number: n.number, id: n.id });
    }
    hasNext = !!page.pageInfo?.hasNextPage;
    after = hasNext ? page.pageInfo.endCursor : null;
    // hasNextPage without a cursor means we cannot page further — truncated.
    if (hasNext && after === null) break;
  } while (after !== null);
  const truncated = (hasNext && after === null) || seen < issueCount;
  return { refs, truncated };
}

/** Page a node's subIssues to completion; returns refs + truncated flag. */
async function collectSubIssues(
  entry: SupportedRepo,
  issueNumber: number,
  first: SubConn,
  gql: Gql,
): Promise<{ refs: SubRef[]; truncated: boolean }> {
  let conn = first;
  const refs: SubRef[] = [];
  // subIssues.nodes is nullable-element too — a deleted/moved sub-issue
  // surfaces as a null slot; skip it (counted below via totalCount).
  for (const n of conn.nodes ?? []) {
    if (n?.id && typeof n.number === 'number') refs.push(n);
  }
  let hasNext = !!conn.pageInfo?.hasNextPage;
  let after = hasNext ? conn.pageInfo.endCursor : null;
  let pages = 1;
  while (after !== null && pages < SUBISSUES_PAGE_CAP) {
    const data = await gql(SUBISSUES_PAGE, {
      owner: entry.owner,
      repo: entry.repo,
      issueNumber,
      after,
    });
    const issue = data.repository?.issue;
    if (!issue?.subIssues) {
      // Issue deleted/transferred mid-walk — treat as truncation, not a crash.
      return { refs, truncated: true };
    }
    conn = issue.subIssues;
    for (const n of conn.nodes ?? []) {
      if (n?.id && typeof n.number === 'number') refs.push(n);
    }
    hasNext = !!conn.pageInfo?.hasNextPage;
    after = hasNext ? conn.pageInfo.endCursor : null;
    pages++;
  }
  // Truncated when: still pages left (cap hit, or hasNextPage with a null
  // cursor we can't follow) or the collected set is short of totalCount.
  const truncated = hasNext || refs.length < conn.totalCount;
  return { refs, truncated };
}

function decodeStatus(
  node: Record<string, any>,
  projectNumber: number | undefined,
): string | undefined {
  if (projectNumber === undefined) return undefined;
  // projectItems(first:10): an issue in >11 projects could hide the match —
  // soft-degrade (no status) rather than fail the tree over a metadata field.
  const item = (node.projectItems?.nodes ?? []).find(
    (p: Record<string, any>) => p.project?.number === projectNumber,
  );
  const field = (item?.fieldValues?.nodes ?? []).find(
    (v: Record<string, any>) => v?.field?.name === 'Status',
  );
  return field?.name || undefined;
}

function toRaw(node: Record<string, any>): LifecycleRawIssue {
  return {
    number: node.number,
    title: node.title,
    state: node.state === 'CLOSED' ? 'CLOSED' : 'OPEN',
    url: node.url,
    labels: (node.labels?.nodes ?? []).map((l: { name: string }) => l.name),
    updatedAt: node.updatedAt,
  };
}

/**
 * Walk a repo's issue tree breadth-first. Roots come from the topic-title
 * search; each level is expanded in `nodes(ids)` batches; subIssues are
 * paged to completion per node. `truncatedNodes` counts nodes whose child
 * list could not be fully collected (the caller throws on nonzero).
 */
export async function fetchLifecycleData(
  entry: SupportedRepo,
  gql: Gql,
): Promise<LifecycleFetchResult> {
  const { refs: rootRefs, truncated: rootsTruncated } = await searchTopicRoots(entry, gql);
  if (rootRefs.length === 0) {
    return {
      roots: [],
      childrenOf: new Map(),
      statusOf: new Map(),
      truncatedNodes: rootsTruncated ? 1 : 0,
    };
  }
  return walkSubtree(entry, rootRefs, rootsTruncated ? 1 : 0, gql);
}

/** Resolve one issue to a root ref for the per-topic callable.
 *  Unknown/deleted issue → null (handler maps to not-found); a probe
 *  that returns a malformed record fails closed like a bad batch. */
export async function fetchTopicRootRef(
  entry: SupportedRepo,
  issueNumber: number,
  gql: Gql,
): Promise<TopicRootRef | null> {
  let data: Record<string, any>;
  try {
    data = await gql(ISSUE_PROBE, {
      owner: entry.owner,
      repo: entry.repo,
      issueNumber,
    });
  } catch (err) {
    // GitHub resolves an unknown issue number through a NOT_FOUND
    // GraphQL error, not a null field — collapse it to null so the
    // handler's not-found contract holds. Everything else propagates.
    if (err instanceof GitHubApiError && err.gqlType === 'NOT_FOUND') return null;
    throw err;
  }
  const issue = data.repository?.issue;
  if (issue === null || issue === undefined) return null;
  if (!issue.id || typeof issue.number !== 'number' || typeof issue.title !== 'string') {
    throw new GitHubApiError(200, false, 'GitHub GraphQL: malformed issue probe');
  }
  return { number: issue.number, id: issue.id, title: issue.title };
}

/** The per-topic subtree fetch (#1636): the same BFS as the monolith,
 *  seeded with one root. Identical paging/truncation/`childrenOf`/`statusOf`
 *  guarantees — by construction, not by duplication. */
export async function fetchTopicSubtreeData(
  entry: SupportedRepo,
  root: { number: number; id: string },
  gql: Gql,
): Promise<LifecycleFetchResult> {
  return walkSubtree(entry, [root], 0, gql);
}

/** The shared BFS body — frontier of root refs → level-batched walk →
 *  childrenOf/statusOf/maps. `truncatedSeed` carries upstream truncation
 *  (e.g. a truncated root search) into the count. */
async function walkSubtree(
  entry: SupportedRepo,
  rootRefs: SubRef[],
  truncatedSeed: number,
  gql: Gql,
): Promise<LifecycleFetchResult> {
  const rootNumbers = rootRefs.map(r => r.number);

  const numToId = new Map<number, string>(rootRefs.map(r => [r.number, r.id]));
  const records = new Map<number, LifecycleRawIssue>();
  const subLists = new Map<number, SubRef[]>();
  const statusOf = new Map<number, string>();
  const seen = new Set<number>(rootNumbers);
  let truncatedNodes = truncatedSeed;
  let frontier = rootNumbers;

  while (frontier.length > 0) {
    const next: number[] = [];
    for (const batch of chunks(frontier, BATCH_SIZE)) {
      const data = await gql(NODES_BATCH, {
        ids: batch.map(n => numToId.get(n)!),
      });
      // Same fail-closed guard as the index path: a malformed batch is a
      // controlled internal error, not a raw TypeError or silent skip.
      if (!Array.isArray(data.nodes)) {
        throw new GitHubApiError(200, false, 'GitHub GraphQL: missing nodes payload');
      }
      for (const node of data.nodes) {
        if (!node) continue;
        const raw = toRaw(node);
        records.set(raw.number, raw);
        numToId.set(raw.number, node.id);
        const status = decodeStatus(node, entry.projectNumber);
        if (status !== undefined) statusOf.set(raw.number, status);
        const { refs, truncated } = await collectSubIssues(
          entry, raw.number, node.subIssues, gql);
        if (truncated) truncatedNodes++;
        subLists.set(raw.number, refs);
        for (const ref of refs) {
          numToId.set(ref.number, ref.id);
          if (!seen.has(ref.number)) {
            seen.add(ref.number);
            next.push(ref.number);
          }
        }
      }
    }
    frontier = next;
  }

  // nodes() may return null slots (deleted/transferred/inaccessible issues):
  // those numbers never entered `records` — drop them and count as truncated
  // rather than leaking `undefined` into childrenOf/roots.
  const childrenOf = new Map<number, LifecycleRawIssue[]>();
  for (const [n, refs] of subLists) {
    const children: LifecycleRawIssue[] = [];
    for (const r of refs) {
      const rec = records.get(r.number);
      if (rec) children.push(rec); else truncatedNodes++;
    }
    childrenOf.set(n, children);
  }
  const missingRoots = rootNumbers.filter(n => !records.has(n)).length;
  return {
    roots: rootNumbers.filter(n => records.has(n)).map(n => records.get(n)!),
    childrenOf,
    statusOf,
    truncatedNodes: truncatedNodes + missingRoots,
  };
}

/**
 * Topic-root index for the lazy viewer (#1635): same search + metadata
 * decode as `fetchLifecycleData` but a slim nodes() batch with no
 * subIssues expansion — `childrenOf` comes back empty so `buildTree`
 * yields every root with `children: []`. Truncation guarantees are
 * identical: search-leg truncation and vanished roots (null slots)
 * both count.
 */
export async function fetchTopicIndexData(
  entry: SupportedRepo,
  gql: Gql,
): Promise<LifecycleFetchResult> {
  const { refs: rootRefs, truncated: rootsTruncated } = await searchTopicRoots(entry, gql);
  if (rootRefs.length === 0) {
    return {
      roots: [],
      childrenOf: new Map(),
      statusOf: new Map(),
      truncatedNodes: rootsTruncated ? 1 : 0,
    };
  }

  const records = new Map<number, LifecycleRawIssue>();
  const statusOf = new Map<number, string>();
  let truncatedNodes = rootsTruncated ? 1 : 0;
  for (const batch of chunks(rootRefs.map(r => r.id), BATCH_SIZE)) {
    const data = await gql(INDEX_NODES_BATCH, { ids: batch });
    if (!Array.isArray(data.nodes)) {
      throw new GitHubApiError(200, false, 'GitHub GraphQL: missing nodes payload');
    }
    for (const node of data.nodes) {
      if (!node) continue; // counted as missingRoots below, like the monolith
      const raw = toRaw(node);
      records.set(raw.number, raw);
      const status = decodeStatus(node, entry.projectNumber);
      if (status !== undefined) statusOf.set(raw.number, status);
    }
  }
  // Never trust nodes() positionally — same rule as the monolith's
  // missingRoots: any ref with no record (null slot, short array, or a
  // node that came back under a different number) is a MISSED root and
  // counts as truncated rather than dropping silently.
  const missingRoots = rootRefs.filter(r => !records.has(r.number)).length;
  return {
    roots: rootRefs
      .map(r => records.get(r.number))
      .filter((r): r is LifecycleRawIssue => r !== undefined),
    childrenOf: new Map(),
    statusOf,
    truncatedNodes: truncatedNodes + missingRoots,
  };
}

