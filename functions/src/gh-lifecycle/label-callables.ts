/**
 * @topic #619 — GitHub read-only issue UI (tasks #1528, #1529)
 *
 * Label callables: listRepoLabels (read — GITHUB_READ_TOKEN) and
 * updateIssueLabels / manageRepoLabel (write — GITHUB_WRITE_TOKEN).
 * Same envelope as getLifecycleTree: auth guard → SUPPORTED_REPOS
 * validation → injected `Rest` transport → mapGitHubError.
 *
 * REST over GraphQL for the write surface — simple CRUD, no batching
 * need, matches fetchFileText's existing REST precedent.
 */

import { onCall, HttpsError } from 'firebase-functions/v2/https';
import type { CallableRequest } from 'firebase-functions/v2/https';
import type {
  ListRepoLabelsRequest,
  ListRepoLabelsResponse,
  ManageRepoLabelRequest,
  ManageRepoLabelResponse,
  RepoLabel,
  UpdateIssueLabelsRequest,
  UpdateIssueLabelsResponse,
} from '@lifecycle/labels';
import { isSystemLabel, STAGE_LABEL_PATTERN } from '@lifecycle/labels';
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

/** Color for repo labels minted via updateIssueLabels / create. */
const DEFAULT_LABEL_COLOR = 'ededed';
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

export function ghLabelWriteDeps(): GhLabelDeps {
  const token = process.env.GITHUB_WRITE_TOKEN;
  if (!token) {
    throw new HttpsError(
      'failed-precondition',
      'GITHUB_WRITE_TOKEN secret is not configured — see task #1526',
    );
  }
  return { rest: githubRest(token) };
}

/** Map GitHubApiError → HttpsError, adding label-specific codes.
 *  `conflictOn422` scopes the already-exists mapping to label-CREATE
 *  paths — a 422 anywhere else (PATCH validation, attach) is a rejected
 *  payload, not a name conflict. */
function mapLabelError(err: GitHubApiError, conflictOn422 = false): HttpsError {
  if (err.status === 422) {
    if (conflictOn422) {
      return new HttpsError('already-exists', `label already exists: ${err.message}`);
    }
    return new HttpsError('invalid-argument', `GitHub rejected the request: ${err.message}`);
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
  opts?: { conflictOn422?: boolean },
): Promise<T> {
  try {
    return (await deps.rest(method, path, body)) as T;
  } catch (err) {
    throw err instanceof GitHubApiError ? mapLabelError(err, opts?.conflictOn422) : err;
  }
}

function labelsPath(entry: SupportedRepo): string {
  return `/repos/${entry.owner}/${entry.repo}/labels`;
}

function issueLabelsPath(entry: SupportedRepo, issueNumber: number): string {
  return `/repos/${entry.owner}/${entry.repo}/issues/${issueNumber}/labels`;
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

// ── updateIssueLabels (#1529) ──────────────────────────────────────────────

function validateUpdate(data: unknown): UpdateIssueLabelsRequest & SupportedRepo {
  const req = (data ?? {}) as Partial<UpdateIssueLabelsRequest>;
  if (req.add !== undefined && !Array.isArray(req.add)) {
    throw new HttpsError('invalid-argument', 'add must be an array of label names');
  }
  if (req.remove !== undefined && !Array.isArray(req.remove)) {
    throw new HttpsError('invalid-argument', 'remove must be an array of label names');
  }
  const add = req.add ?? [];
  const remove = req.remove ?? [];
  const n = req.issueNumber;
  if (typeof n !== 'number' || !Number.isInteger(n) || n <= 0) {
    throw new HttpsError('invalid-argument', 'expected a positive integer issueNumber');
  }
  if (!add.every(s => typeof s === 'string' && s.trim()) ||
      !remove.every(s => typeof s === 'string' && s.trim())) {
    throw new HttpsError('invalid-argument', 'add/remove must be arrays of non-empty label names');
  }
  if (add.length === 0 && remove.length === 0) {
    throw new HttpsError('invalid-argument', 'add and remove are both empty — nothing to do');
  }
  if (add.some(name => remove.includes(name))) {
    throw new HttpsError('invalid-argument', 'a name may not appear in both add and remove');
  }
  // Stage labels are workflow state in both directions: attaching one
  // fabricates stage position, detaching one erases it. Neither is the
  // label editor's business.
  const stage = [...add, ...remove].find(name => STAGE_LABEL_PATTERN.test(name));
  if (stage !== undefined) {
    throw new HttpsError(
      'invalid-argument',
      `'${stage}' is a workflow stage label — managed by the lifecycle, not the label editor`,
    );
  }
  return { ...req, add, remove } as UpdateIssueLabelsRequest & SupportedRepo;
}

export async function handleUpdateIssueLabels(
  request: CallableRequest<UpdateIssueLabelsRequest>,
  deps: GhLabelDeps,
): Promise<UpdateIssueLabelsResponse> {
  return internalGuard('updateIssueLabels', async () => {
    if (!request.auth?.uid) throw new HttpsError('unauthenticated', 'unauthenticated');
    const entry = resolveSupportedRepo(request.data);
    const req = validateUpdate(request.data);
    const add = req.add ?? [];
    const remove = req.remove ?? [];

    // Removes first — detaching a missing label 404s; that's the no-op
    // case (idempotent remove), not an error.
    let finalLabels: string[] | undefined;
    for (const name of remove) {
      try {
        const remaining = await call<{ name: string }[]>(
          deps, 'DELETE',
          `${issueLabelsPath(entry, req.issueNumber)}/${encodeURIComponent(name)}`);
        finalLabels = remaining.map(l => l.name);
      } catch (err) {
        if (!(err instanceof HttpsError && err.code === 'not-found')) throw err;
      }
    }

    // Adds: names absent from the repo's label set are minted first.
    const created: string[] = [];
    if (add.length > 0) {
      const repoLabels = await collectPages<RepoLabel>(deps, labelsPath(entry));
      const existing = new Set(repoLabels.map(l => l.name));
      for (const name of add) {
        if (existing.has(name)) continue;
        try {
          await call(deps, 'POST', labelsPath(entry), {
            name, color: DEFAULT_LABEL_COLOR, description: '',
          }, { conflictOn422: true });
          created.push(name);
        } catch (err) {
          // 422 = raced into existence between list and create — the
          // label exists now either way; attach below still applies.
          if (!(err instanceof HttpsError && err.code === 'already-exists')) throw err;
        }
      }
      const attached = await call<{ name: string }[]>(
        deps, 'POST', issueLabelsPath(entry, req.issueNumber), { labels: add });
      finalLabels = attached.map(l => l.name);
    }

    if (finalLabels === undefined) {
      const labels = await call<{ name: string }[]>(
        deps, 'GET', issueLabelsPath(entry, req.issueNumber));
      finalLabels = labels.map(l => l.name);
    }
    return { labels: finalLabels, created };
  });
}

// ── manageRepoLabel (#1529) ────────────────────────────────────────────────

function validateManage(data: unknown): ManageRepoLabelRequest {
  const req = (data ?? {}) as Partial<ManageRepoLabelRequest>;
  if (req.op !== 'create' && req.op !== 'update' && req.op !== 'delete') {
    throw new HttpsError('invalid-argument', 'expected op create|update|delete');
  }
  if (typeof req.name !== 'string' || !req.name.trim()) {
    throw new HttpsError('invalid-argument', 'expected a non-empty name');
  }
  if (req.newName !== undefined &&
      (typeof req.newName !== 'string' || !req.newName.trim())) {
    throw new HttpsError('invalid-argument', 'newName must be a non-empty string when present');
  }
  if (req.color !== undefined && typeof req.color !== 'string') {
    throw new HttpsError('invalid-argument', 'color must be a string when present');
  }
  if (req.description !== undefined && typeof req.description !== 'string') {
    throw new HttpsError('invalid-argument', 'description must be a string when present');
  }
  // System labels (stage/structural/Category/domain) are taxonomy, not
  // user content — the label manager may not create, rename, or delete
  // them, and may not rename an arbitrary label INTO one.
  if (isSystemLabel(req.name)) {
    throw new HttpsError(
      'invalid-argument',
      `'${req.name}' is a system label — managed by the workflow taxonomy`,
    );
  }
  if (req.newName !== undefined && isSystemLabel(req.newName)) {
    throw new HttpsError(
      'invalid-argument',
      `'${req.newName}' is a system label name — a rename may not mint taxonomy`,
    );
  }
  return req as ManageRepoLabelRequest;
}

export async function handleManageRepoLabel(
  request: CallableRequest<ManageRepoLabelRequest>,
  deps: GhLabelDeps,
): Promise<ManageRepoLabelResponse> {
  return internalGuard('manageRepoLabel', async () => {
    if (!request.auth?.uid) throw new HttpsError('unauthenticated', 'unauthenticated');
    const entry = resolveSupportedRepo(request.data);
    const req = validateManage(request.data);
    const namePath = `${labelsPath(entry)}/${encodeURIComponent(req.name)}`;

    if (req.op === 'create') {
      await call(deps, 'POST', labelsPath(entry), {
        name: req.name,
        color: req.color ?? DEFAULT_LABEL_COLOR,
        ...(req.description !== undefined ? { description: req.description } : {}),
      }, { conflictOn422: true });
      return { op: 'create' };
    }
    if (req.op === 'update') {
      await call(deps, 'PATCH', namePath, {
        new_name: req.newName,
        color: req.color,
        description: req.description,
      });
      return { op: 'update' };
    }

    // delete: surface how many issues carried the label — GitHub
    // detaches on delete, so the FE confirms before dropping an in-use
    // label. Count via the issues list paged on the label filter.
    const issues = await collectPages<{ number: number }>(
      deps, `/repos/${entry.owner}/${entry.repo}/issues?labels=${encodeURIComponent(req.name)}&state=all`);
    await call(deps, 'DELETE', namePath);
    return { op: 'delete', usageCount: issues.length };
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

export const updateIssueLabels = onCall<UpdateIssueLabelsRequest, Promise<UpdateIssueLabelsResponse>>(
  {
    cors: OPTIONS_STRATEGY_ALLOWED_ORIGINS,
    secrets: ['GITHUB_WRITE_TOKEN'],
    timeoutSeconds: 60,
  },
  (request) => handleUpdateIssueLabels(request, ghLabelWriteDeps()),
);

export const manageRepoLabel = onCall<ManageRepoLabelRequest, Promise<ManageRepoLabelResponse>>(
  {
    cors: OPTIONS_STRATEGY_ALLOWED_ORIGINS,
    secrets: ['GITHUB_WRITE_TOKEN'],
    timeoutSeconds: 60,
  },
  (request) => handleManageRepoLabel(request, ghLabelWriteDeps()),
);
