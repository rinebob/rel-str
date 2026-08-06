import {GoogleAuth} from "google-auth-library";
import { DEFAULT_PARTNER_CALLER_SA, IAM_CREDENTIALS_BASE_URL, OAUTH_CLOUD_PLATFORM_SCOPE, IAM_SERVICE_ACCOUNTS_PATH, IamCredentialsMethod } from './config/constants';

// Base host retained for compatibility, but audiences should be function URLs per SA quickstart
export const PARTNER_AUDIENCE =
  process.env.PARTNER_AUDIENCE ||
  "https://us-central1-alpha-vantage-proxy-api.cloudfunctions.net";

// Service account email for rel-str prod
export const CALLER_SA = process.env.PARTNER_CALLER_SA || DEFAULT_PARTNER_CALLER_SA;

/** Error thrown by partner API calls; carries the HTTP status code for typed handling. */
export class PartnerHttpError extends Error {
  constructor(
    message: string,
    public readonly status: number,
  ) {
    super(message);
    this.name = 'PartnerHttpError';
  }
}

export type PartnerInterval = "DAILY" | "WEEKLY" | "MONTHLY";

/**
 * Generate a Google ID token with includeEmail=true for the given audience using
 * IAM Credentials API `projects/-/serviceAccounts/{sa}:generateIdToken`.
 * Works with local impersonation (GOOGLE_IMPERSONATE_SERVICE_ACCOUNT) and in prod
 * where the function runs under the desired runtime service account.
 */
export async function generateIdTokenWithEmail(audience: string, serviceAccountEmail: string): Promise<string> {
  const auth = new GoogleAuth({ scopes: [OAUTH_CLOUD_PLATFORM_SCOPE] });
  // Acquire an access token to call IAM Credentials
  const accessToken = await auth.getAccessToken();
  const url = `${IAM_CREDENTIALS_BASE_URL}/${IAM_SERVICE_ACCOUNTS_PATH}/${encodeURIComponent(serviceAccountEmail)}:${IamCredentialsMethod.GENERATE_ID_TOKEN}`;
  const body = { audience, includeEmail: true };
  const resp = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`generateIdToken failed: ${resp.status} ${resp.statusText} :: ${text}`);
  }
  const data = (await resp.json()) as { token: string };
  return data.token;
}

/** Options for fetchWithRetry — method, body, and maxAttempts. */
export interface FetchWithRetryOptions {
  maxAttempts?: number;
  method?: string;
  body?: string;
}

/** Simple bounded retry with exponential backoff + jitter for transient upstream errors. */
export async function fetchWithRetry(
  url: string,
  headers: Record<string, string>,
  options?: number | FetchWithRetryOptions,
): Promise<Response> {
  const opts: FetchWithRetryOptions =
    typeof options === 'number'
      ? { maxAttempts: options }
      : options ?? {};
  const maxAttempts = opts.maxAttempts ?? 3;
  const method = opts.method ?? 'GET';
  const body = opts.body;

  let lastResp: Response | undefined;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const resp = await fetch(url, { headers, method, body });
    if (resp.ok) return resp;
    lastResp = resp;
    const retriable = [429, 500, 502, 503, 504].includes(resp.status);
    if (!retriable || attempt === maxAttempts) return resp;
    const base = 200 * Math.pow(2, attempt - 1);
    const jitter = Math.floor(Math.random() * 150);
    await new Promise((r) => setTimeout(r, base + jitter));
  }
  // Fallback, should not reach here
  return lastResp as Response;
}
