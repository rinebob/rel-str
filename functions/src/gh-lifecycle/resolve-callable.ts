/**
 * @topic #619 — GitHub read-only issue UI (task #1695 / Blueprint #1694)
 *
 * resolveLifecycleIssue — onCall endpoint for the issue-number map's
 * cold/stale path: any issue number → its Topic root via GitHub's
 * `Issue.parent` chain. The path is returned root→issue so the FE can
 * expand straight to it; every chain number is also upserted into the
 * issue map (cold misses only ever pay the walk once). Same envelope as
 * the tree callables: auth guard → SUPPORTED_REPOS validation →
 * injected deps → mapGitHubError.
 */

import { onCall, HttpsError } from 'firebase-functions/v2/https';
import type { CallableRequest } from 'firebase-functions/v2/https';
import type {
  LifecycleResolveIssueRequest,
  LifecycleResolveIssueResponse,
} from '@lifecycle/contracts';
import { isTopicRoot } from '@lifecycle/tree';
import { OPTIONS_STRATEGY_ALLOWED_ORIGINS } from '../paper-trading/engine/options-strategy-cors';
import { GitHubApiError } from './github-client';
import type { IssueAncestorChain } from './lifecycle-fetch';
import {
  ghLifecycleDeps,
  internalGuard,
  mapGitHubError,
  requirePositiveInt,
  resolveSupportedRepo,
  type GhLifecycleDeps,
} from './callables';

async function handleResolve(
  request: CallableRequest<LifecycleResolveIssueRequest>,
  deps: GhLifecycleDeps,
): Promise<LifecycleResolveIssueResponse> {
  if (!request.auth?.uid) throw new HttpsError('unauthenticated', 'unauthenticated');
  const entry = resolveSupportedRepo(request.data);
  const issueNumber = requirePositiveInt(request.data, 'issueNumber');
  let chain: IssueAncestorChain | null;
  try {
    chain = await deps.fetchIssueChain(entry, issueNumber);
  } catch (err) {
    throw err instanceof GitHubApiError ? mapGitHubError(err) : err;
  }
  if (!chain) {
    throw new HttpsError('not-found', `issue #${issueNumber} not found in ${entry.owner}/${entry.repo}`);
  }
  const top = chain.ancestors[chain.ancestors.length - 1];
  const response: LifecycleResolveIssueResponse = {
    issue: {
      number: chain.issue.number,
      title: chain.issue.title,
      state: chain.issue.state === 'CLOSED' ? 'closed' : 'open',
      url: chain.issue.url,
      labels: chain.issue.labels,
    },
  };
  // A `Topic:` issue resolves to itself — the map self-maps roots, so
  // the resolver must agree (a root created after the last seed is a
  // map miss the FE lands here).
  const selfRoot = isTopicRoot(chain.issue.title);
  if (!selfRoot && (top === undefined || !isTopicRoot(top.title))) return response;
  const root = selfRoot ? chain.issue.number : top.number;
  response.path = selfRoot
    ? [chain.issue.number]
    : [...chain.ancestors.map(a => a.number).reverse(), chain.issue.number];
  // Best-effort map write — every resolved chain number joins the map.
  try {
    const entries: Record<number, number> = {};
    for (const n of response.path) entries[n] = root;
    await deps.upsertIssueMapEntries(entry, entries);
  } catch (err) {
    console.warn(`resolveLifecycleIssue: issueMap upsert failed for #${issueNumber}`, err);
  }
  return response;
}

export async function handleResolveLifecycleIssue(
  request: CallableRequest<LifecycleResolveIssueRequest>,
  deps: GhLifecycleDeps,
): Promise<LifecycleResolveIssueResponse> {
  return internalGuard('resolveLifecycleIssue', () => handleResolve(request, deps));
}

/** One GraphQL probe + one best-effort map write — the 30s/256MiB
 *  budget matches the single-query walk. */
export const resolveLifecycleIssue = onCall<LifecycleResolveIssueRequest, Promise<LifecycleResolveIssueResponse>>(
  {
    cors: OPTIONS_STRATEGY_ALLOWED_ORIGINS,
    secrets: ['GITHUB_READ_TOKEN'],
    timeoutSeconds: 30,
    memory: '256MiB',
  },
  (request) => handleResolveLifecycleIssue(request, ghLifecycleDeps()),
);
