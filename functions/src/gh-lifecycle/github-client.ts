/**
 * @topic #619 — GitHub read-only issue UI (task #639)
 *
 * GraphQL BFS fetch shell for getLifecycleTree: paginated topic-root
 * search → level-batched node expansion → mandatory truncation counting.
 * The "never silently miss issues" guarantee lives in `truncatedNodes`:
 * the callable throws when it would be nonzero.
 *
 * Transport is injectable (`Gql`) so specs drive fixture pages without
 * mocking fetch; production uses `githubGql(token)` over native fetch —
 * no Octokit for a handful of query shapes.
 */

import type { LifecycleRawIssue } from '@lifecycle/tree';
import type { SupportedRepo } from './config';

export type Gql = (
  query: string,
  variables?: Record<string, unknown>,
) => Promise<Record<string, any>>;

export class GitHubApiError extends Error {
  constructor(
    readonly status: number,
    readonly rateLimited: boolean,
    message: string,
  ) {
    super(message);
    this.name = 'GitHubApiError';
  }
}

/** Production transport: POST the query to api.github.com/graphql. */
export function githubGql(token: string): Gql {
  return async (query, variables) => {
    const res = await fetch('https://api.github.com/graphql', {
      method: 'POST',
      headers: {
        authorization: `bearer ${token}`,
        'content-type': 'application/json',
        accept: 'application/vnd.github+json',
      },
      body: JSON.stringify({ query, variables }),
    });
    const rateLimited =
      res.status === 429 ||
      (res.status === 403 &&
        (res.headers.get('x-ratelimit-remaining') === '0' ||
          res.headers.get('retry-after') !== null));
    const body = (await res.json().catch(() => null)) as {
      data?: Record<string, any>;
      errors?: { message: string }[];
      message?: string;
    } | null;
    if (!res.ok) {
      throw new GitHubApiError(
        res.status,
        rateLimited,
        `GitHub ${res.status}: ${body?.message ?? res.statusText}`,
      );
    }
    if (body?.errors?.length) {
      throw new GitHubApiError(
        res.status,
        rateLimited,
        `GitHub GraphQL: ${body.errors.map(e => e.message).join('; ')}`,
      );
    }
    if (!body?.data) {
      throw new GitHubApiError(res.status, rateLimited, 'GitHub GraphQL: empty data');
    }
    return body.data;
  };
}

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
    nodes { ... on Issue { number id } }
    pageInfo { hasNextPage endCursor }
  }
}`;

// labels(first:50) soft-degrades — >50 labels misses the tail.
const ISSUE_FIELDS = `number id title state url updatedAt
  labels(first: 50) { nodes { name } }
  projectItems(first: 10) { nodes {
    project { number }
    fieldValues(first: 20) { nodes {
      ... on ProjectV2ItemFieldSingleSelectValue {
        name
        field { ... on ProjectV2SingleSelectField { name } }
      }
    } }
  } }
  subIssues(first: 100) {
    nodes { number id }
    totalCount
    pageInfo { hasNextPage endCursor }
  }`;

const NODES_BATCH = `query($ids: [ID!]!) {
  nodes(ids: $ids) { ... on Issue { ${ISSUE_FIELDS} } }
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

interface PageInfo { hasNextPage: boolean; endCursor: string | null }
interface SubRef { number: number; id: string }
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
  let hasNext = true;
  do {
    const data = await gql(SEARCH_PAGE, { q, after });
    const page = data.search;
    if (!page) throw new GitHubApiError(200, false, 'GitHub GraphQL: missing search payload');
    issueCount = page.issueCount ?? issueCount;
    for (const n of page.nodes ?? []) {
      if (n?.id && typeof n.number === 'number') refs.push({ number: n.number, id: n.id });
    }
    hasNext = !!page.pageInfo?.hasNextPage;
    after = hasNext ? page.pageInfo.endCursor : null;
    // hasNextPage without a cursor means we cannot page further — truncated.
    if (hasNext && after === null) break;
  } while (after !== null);
  const truncated = hasNext && after === null ? true : refs.length < issueCount;
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
  const rootNumbers = rootRefs.map(r => r.number);

  const numToId = new Map<number, string>(rootRefs.map(r => [r.number, r.id]));
  const records = new Map<number, LifecycleRawIssue>();
  const subLists = new Map<number, SubRef[]>();
  const statusOf = new Map<number, string>();
  const seen = new Set<number>(rootNumbers);
  let truncatedNodes = rootsTruncated ? 1 : 0;
  let frontier = rootNumbers;

  while (frontier.length > 0) {
    const next: number[] = [];
    for (const batch of chunks(frontier, BATCH_SIZE)) {
      const data = await gql(NODES_BATCH, {
        ids: batch.map(n => numToId.get(n)!),
      });
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

/** Fetch a repo file's raw contents; 404 → null, other errors throw. */
export async function fetchFileText(
  token: string,
  entry: SupportedRepo,
  path: string,
): Promise<string | null> {
  const res = await fetch(
    `https://api.github.com/repos/${entry.owner}/${entry.repo}/contents/${path}`,
    {
      headers: {
        authorization: `bearer ${token}`,
        accept: 'application/vnd.github.raw+json',
      },
    },
  );
  if (res.status === 404) return null;
  if (!res.ok) {
    const rateLimited =
      res.status === 429 ||
      (res.status === 403 &&
        (res.headers.get('x-ratelimit-remaining') === '0' ||
          res.headers.get('retry-after') !== null));
    const body = (await res.text()).slice(0, 200); // bounded — never leak a huge upstream body into errors
    throw new GitHubApiError(res.status, rateLimited, `GitHub ${res.status}: ${body}`);
  }
  return res.text();
}
