/**
 * @topic #619 — GitHub read-only issue UI (task #640)
 *
 * getLifecycleTree — onCall endpoint. Thin wrapper: auth guard → deps →
 * fetchLifecycleData → shared transforms → LifecycleTreeResponse. All
 * GitHub I/O lives in github-client.ts; all tree logic in shared/.
 * Read-only — no GitHub or Firestore writes.
 */

import { onCall, HttpsError } from 'firebase-functions/v2/https';
import type { CallableRequest } from 'firebase-functions/v2/https';
import type { LifecycleRepoRequest, LifecycleTreeResponse } from '@lifecycle/contracts';
import { buildTree, orderTopics, parseInventoryGroups } from '@lifecycle/tree';
import { OPTIONS_STRATEGY_ALLOWED_ORIGINS } from '../paper-trading/engine/options-strategy-cors';
import { SUPPORTED_REPOS, type SupportedRepo } from './config';
import {
  fetchFileText,
  fetchLifecycleData,
  githubGql,
  GitHubApiError,
  type LifecycleFetchResult,
} from './github-client';

const INVENTORY_PATH = 'docs/dev-notes/TOPICS-INVENTORY.md';

// ── Dependencies ──────────────────────────────────────────────────────────

export interface GhLifecycleDeps {
  fetchData: (entry: SupportedRepo) => Promise<LifecycleFetchResult>;
  /** Raw TOPICS-INVENTORY.md; null on 404. Throws for other failures. */
  fetchInventoryDoc: (entry: SupportedRepo) => Promise<string | null>;
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
    fetchInventoryDoc: entry => fetchFileText(token, entry, INVENTORY_PATH),
  };
}

// ── Handler ───────────────────────────────────────────────────────────────

function mapGitHubError(err: GitHubApiError): HttpsError {
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
async function internalGuard<T>(label: string, fn: () => Promise<T>): Promise<T> {
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

async function handle(
  request: CallableRequest<LifecycleRepoRequest>,
  deps: GhLifecycleDeps,
): Promise<LifecycleTreeResponse> {
  if (!request.auth?.uid) throw new HttpsError('unauthenticated', 'unauthenticated');
  const { owner, repo } = request.data ?? {};
  if (typeof owner !== 'string' || typeof repo !== 'string' || !owner || !repo) {
    throw new HttpsError('invalid-argument', 'expected { owner, repo }');
  }
  const entry = SUPPORTED_REPOS.find(r => r.owner === owner && r.repo === repo);
  if (!entry) {
    throw new HttpsError('invalid-argument', `unsupported repo ${owner}/${repo}`);
  }

  let data: LifecycleFetchResult;
  try {
    data = await deps.fetchData(entry);
  } catch (err) {
    throw err instanceof GitHubApiError ? mapGitHubError(err) : err;
  }
  if (data.truncatedNodes > 0) {
    throw new HttpsError(
      'internal',
      `lifecycle tree truncated — ${data.truncatedNodes} node(s) could not be fully fetched`,
    );
  }

  const fetchedAt = new Date().toISOString(); // stamp at data-ready time (post-walk)

  let groupingWarning: string | undefined;
  let groups = null;
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
  return {
    sections: orderTopics(trees, groups),
    fetchedAt,
    truncatedNodes: 0,
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
