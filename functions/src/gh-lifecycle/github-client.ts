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
    /** First errors[] type when GitHub answers with a GraphQL error
     *  envelope (e.g. NOT_FOUND) — lets callers distinguish a missing
     *  resource from a transport/server failure. */
    readonly gqlType?: string,
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
      errors?: { message: string; type?: string }[];
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
        body.errors[0]?.type,
      );
    }
    if (!body?.data) {
      throw new GitHubApiError(res.status, rateLimited, 'GitHub GraphQL: empty data');
    }
    return body.data;
  };
}

/** Injectable REST transport for the label read/write callables —
 *  same error envelope as `Gql` so `mapGitHubError` covers both. */
export type Rest = (
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
  /** Repo-absolute API path, e.g. `/repos/{o}/{r}/labels`. */
  path: string,
  body?: Record<string, unknown>,
) => Promise<unknown>;

/** Production transport: REST calls against api.github.com. */
export function githubRest(token: string): Rest {
  return async (method, path, body) => {
    const res = await fetch(`https://api.github.com${path}`, {
      method,
      headers: {
        authorization: `bearer ${token}`,
        accept: 'application/vnd.github+json',
        'x-github-api-version': '2022-11-28',
        ...(body ? { 'content-type': 'application/json' } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    const rateLimited =
      res.status === 429 ||
      (res.status === 403 &&
        (res.headers.get('x-ratelimit-remaining') === '0' ||
          res.headers.get('retry-after') !== null));
    if (!res.ok) {
      const errBody = (await res.json().catch(() => null)) as {
        message?: string;
      } | null;
      throw new GitHubApiError(
        res.status,
        rateLimited,
        `GitHub ${res.status}: ${errBody?.message ?? res.statusText}`,
      );
    }
    // 204 (delete success) has no body — callers get null.
    return res.status === 204 ? null : res.json();
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
