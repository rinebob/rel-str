/**
 * @topic #619 — GitHub read-only issue UI (task #1528)
 *
 * Label callables: listRepoLabels (read — GITHUB_READ_TOKEN). The write
 * callables (updateIssueLabels / manageRepoLabel — GITHUB_WRITE_TOKEN)
 * land with #1529.
 * Same envelope as getLifecycleTree: auth guard → SUPPORTED_REPOS
 * validation → injected `Rest` transport → mapGitHubError.
 */

import { onCall, HttpsError } from 'firebase-functions/v2/https';
import type { CallableRequest } from 'firebase-functions/v2/https';
import type {
  ListRepoLabelsRequest,
  ListRepoLabelsResponse,
  RepoLabel,
} from '@lifecycle/labels';
import { OPTIONS_STRATEGY_ALLOWED_ORIGINS } from '../paper-trading/engine/options-strategy-cors';
import type { SupportedRepo } from './config';
import {
  internalGuard,
  mapGitHubError,
  resolveSupportedRepo,
} from './callables';
import {
  githubRest,
  GitHubApiError,
  type Rest,
} from './github-client';

const LABEL_PAGE_SIZE = 100;
/** Wedged-transport bound — same hard-stop convention as
 *  SUBISSUES_PAGE_CAP in github-client. */
const PAGE_CAP = 50;

export interface GhLabelDeps {
  rest: Rest;
}

export function ghLabelReadDeps(): GhLabelDeps {
  const token = process.env.GITHUB_READ_TOKEN;
  if (!token) {
    throw new HttpsError(
      'failed-precondition',
      'GITHUB_READ_TOKEN secret is not configured — see task #638',
    );
  }
  return { rest: githubRest(token) };
}

/** Map GitHubApiError → HttpsError, adding label-specific codes. */
function mapLabelError(err: GitHubApiError): HttpsError {
  if (err.status === 422) {
    return new HttpsError('already-exists', `label already exists: ${err.message}`);
  }
  if (err.status === 404) {
    return new HttpsError('not-found', `not found: ${err.message}`);
  }
  return mapGitHubError(err);
}

async function call<T>(
  deps: GhLabelDeps,
  method: Parameters<Rest>[0],
  path: string,
  body?: Record<string, unknown>,
): Promise<T> {
  try {
    return (await deps.rest(method, path, body)) as T;
  } catch (err) {
    throw err instanceof GitHubApiError ? mapLabelError(err) : err;
  }
}

function labelsPath(entry: SupportedRepo): string {
  return `/repos/${entry.owner}/${entry.repo}/labels`;
}

/** GET a paged REST collection to completion (per_page=100). */
async function collectPages<T>(
  deps: GhLabelDeps,
  basePath: string,
): Promise<T[]> {
  const out: T[] = [];
  const sep = basePath.includes('?') ? '&' : '?';
  for (let page = 1; page <= PAGE_CAP; page++) {
    const rows = await call<T[]>(
      deps, 'GET', `${basePath}${sep}per_page=${LABEL_PAGE_SIZE}&page=${page}`);
    // A non-array body (incl. a string, which spreads as chars) must
    // never splinter onto the wire — error → internal via internalGuard.
    if (!Array.isArray(rows)) {
      throw new Error(`paged GET ${basePath} returned a non-array body`);
    }
    out.push(...rows);
    if (rows.length < LABEL_PAGE_SIZE) return out;
  }
  throw new Error(`paged GET ${basePath} exceeded ${PAGE_CAP} pages`);
}

// ── listRepoLabels (#1528) ─────────────────────────────────────────────────

export async function handleListRepoLabels(
  request: CallableRequest<ListRepoLabelsRequest>,
  deps: GhLabelDeps,
): Promise<ListRepoLabelsResponse> {
  return internalGuard('listRepoLabels', async () => {
    if (!request.auth?.uid) throw new HttpsError('unauthenticated', 'unauthenticated');
    const entry = resolveSupportedRepo(request.data);
    const raw = await collectPages<RepoLabel>(deps, labelsPath(entry));
    // Project to the contract — GitHub returns id/node_id/url/default
    // extras that must not drift onto the wire.
    const labels = raw.map(({ name, color, description }) =>
      ({ name, color, description: description ?? null }));
    return { labels, fetchedAt: new Date().toISOString() };
  });
}

// ── Callable exports ──────────────────────────────────────────────────────

export const listRepoLabels = onCall<ListRepoLabelsRequest, Promise<ListRepoLabelsResponse>>(
  {
    cors: OPTIONS_STRATEGY_ALLOWED_ORIGINS,
    secrets: ['GITHUB_READ_TOKEN'],
    timeoutSeconds: 60,
  },
  (request) => handleListRepoLabels(request, ghLabelReadDeps()),
);
