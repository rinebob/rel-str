import { randomUUID } from 'node:crypto';
import { refreshAuthorization } from '@modelcontextprotocol/sdk/client/auth.js';
import { CredentialRepositoryBusyError } from './credential-repository';
import type { RefreshLeasePort } from './credential-repository';
import type { RepositoryOAuthProvider } from './repository-oauth-provider';

export type OAuthRefreshFetch = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>;

export interface StoredCredentialRefreshOptions {
  /** Unused — the provider stamps lastTokenResponseAt from its own clock.
   *  Kept optional for caller convenience. */
  now?: Date;
  fetchFn?: OAuthRefreshFetch;
  /** Lease holder identity — defaults to a fresh UUID per refresh. */
  holderId?: string;
  /** Lease TTL — covers crashed holders (default 60s, well over a POST). */
  leaseTtlMs?: number;
  /** How long a lease loser waits for the winner's write before retrying
   *  acquire (default 20s). */
  leaseWaitMs?: number;
  /** Loser poll interval while waiting on the winner (default 400ms). */
  leasePollMs?: number;
  /** Test seam for the loser's wait loop. */
  sleepFn?: (ms: number) => Promise<void>;
}

export interface StoredCredentialRefreshResult {
  refreshTokenRotated: boolean;
  /** True when this call adopted a concurrent winner's rotation instead of
   *  POSTing — the store carries the winner's grant, none was presented. */
  adoptedWinner?: boolean;
}

export class StoredCredentialReauthorizationRequiredError extends Error {
  override name = 'StoredCredentialReauthorizationRequiredError';
  readonly errorCode = 'invalid_grant';
}

export class StoredCredentialRefreshMisconfiguredError extends Error {
  override name = 'StoredCredentialRefreshMisconfiguredError';
  readonly errorCode = 'invalid_client';
}

const DEFAULT_LEASE_TTL_MS = 60_000;
const DEFAULT_LEASE_WAIT_MS = 20_000;
const DEFAULT_LEASE_POLL_MS = 400;

const defaultSleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

export async function refreshStoredCredential(
  provider: RepositoryOAuthProvider,
  options: StoredCredentialRefreshOptions,
): Promise<StoredCredentialRefreshResult> {
  const tokens = await provider.tokens();
  const clientInformation = await provider.clientInformation();
  const discoveryState = await provider.discoveryState();
  if (!tokens?.refresh_token) {
    throw new StoredCredentialReauthorizationRequiredError();
  }
  if (!clientInformation || !discoveryState) {
    throw new StoredCredentialRefreshMisconfiguredError();
  }

  const leasePort = provider.refreshLeasePort;
  if (!leasePort) {
    return postAndStore(provider, tokens.refresh_token, clientInformation, discoveryState, options);
  }
  return refreshUnderLease(provider, tokens.refresh_token, leasePort, options);
}

type ProviderCredentials = Awaited<
  ReturnType<RepositoryOAuthProvider['clientInformation']>
>;

/**
 * Lease-serialized refresh: only the lease winner POSTs. A loser waits for
 * the winner's revision bump and adopts the rotated grant — presenting an
 * already-rotated refresh token gets the grant revoked server-side (#1658).
 */
async function refreshUnderLease(
  provider: RepositoryOAuthProvider,
  baselineRefreshToken: string,
  leasePort: RefreshLeasePort,
  options: StoredCredentialRefreshOptions,
): Promise<StoredCredentialRefreshResult> {
  const holderId = options.holderId ?? randomUUID();
  const ttlMs = options.leaseTtlMs ?? DEFAULT_LEASE_TTL_MS;
  const waitMs = options.leaseWaitMs ?? DEFAULT_LEASE_WAIT_MS;
  const pollMs = options.leasePollMs ?? DEFAULT_LEASE_POLL_MS;
  const sleep = options.sleepFn ?? defaultSleep;

  const baselineRevision = await leasePort.currentRevision();
  let lease = await leasePort.acquire(holderId, ttlMs);
  if (!lease) {
    // Another instance is refreshing — wait for its write, then adopt.
    if (await waitForWinnerWrite(leasePort, baselineRevision, waitMs, pollMs, sleep)) {
      const adopted = await provider.reloadBundle();
      if (adopted !== null && adopted.tokens?.refresh_token !== baselineRefreshToken) {
        provider.discardPendingWrites();
        return { refreshTokenRotated: true, adoptedWinner: true };
      }
      // The bump didn't rotate the rt — a non-refresh write, or a refresh
      // whose response the winner failed to persist. If the winner POSTed
      // but exhausted its store budget the grant is doomed regardless;
      // otherwise the rt is still valid. Either way the lease may now be
      // free: fall through and try our own refresh.
    }
    // No usable write landed — holder may have crashed post-acquire. One
    // retry; if the lease is still live-held, defer to the next request.
    lease = await leasePort.acquire(holderId, ttlMs);
    if (!lease) {
      throw new CredentialRepositoryBusyError();
    }
  }

  try {
    const fresh = await provider.reloadBundle();
    if (!fresh?.tokens?.refresh_token) {
      throw new StoredCredentialReauthorizationRequiredError();
    }
    if (fresh.tokens.refresh_token !== baselineRefreshToken) {
      // The grant rotated while we queued — the doc holds the winner's grant.
      provider.discardPendingWrites();
      return { refreshTokenRotated: true, adoptedWinner: true };
    }
    const clientInformation = await provider.clientInformation();
    const discoveryState = await provider.discoveryState();
    if (!clientInformation || !discoveryState) {
      throw new StoredCredentialRefreshMisconfiguredError();
    }
    return await postAndStore(provider, baselineRefreshToken, clientInformation, discoveryState, options);
  } finally {
    // A failed release must not fail the refresh — the TTL reclaims the slot.
    await leasePort.release(lease).catch(() => undefined);
  }
}

/** Poll until the stored revision moves — the winner's write landing. */
async function waitForWinnerWrite(
  leasePort: RefreshLeasePort,
  baselineRevision: number | null,
  waitMs: number,
  pollMs: number,
  sleep: (ms: number) => Promise<void>,
): Promise<boolean> {
  const deadline = Date.now() + waitMs;
  while (Date.now() < deadline) {
    await sleep(pollMs);
    if ((await leasePort.currentRevision()) !== baselineRevision) {
      return true;
    }
  }
  return false;
}

async function postAndStore(
  provider: RepositoryOAuthProvider,
  baselineRefreshToken: string,
  clientInformation: NonNullable<ProviderCredentials>,
  discoveryState: NonNullable<Awaited<ReturnType<RepositoryOAuthProvider['discoveryState']>>>,
  options: StoredCredentialRefreshOptions,
): Promise<StoredCredentialRefreshResult> {
  const refreshedTokens = await refreshAuthorization(
    discoveryState.authorizationServerUrl,
    {
      metadata: discoveryState.authorizationServerMetadata,
      clientInformation,
      refreshToken: baselineRefreshToken,
      resource: discoveryState.resourceMetadata?.resource === undefined
        ? undefined
        : new URL(discoveryState.resourceMetadata.resource),
      fetchFn: options.fetchFn,
    },
  );
  await provider.saveTokens(refreshedTokens);
  return {
    refreshTokenRotated: refreshedTokens.refresh_token !== baselineRefreshToken,
  };
}
