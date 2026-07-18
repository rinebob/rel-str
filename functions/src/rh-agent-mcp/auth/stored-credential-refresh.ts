import { refreshAuthorization } from '@modelcontextprotocol/sdk/client/auth.js';
import type { RepositoryOAuthProvider } from './repository-oauth-provider';

export type OAuthRefreshFetch = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>;

export interface StoredCredentialRefreshOptions {
  now: Date;
  fetchFn?: OAuthRefreshFetch;
}

export interface StoredCredentialRefreshResult {
  refreshTokenRotated: boolean;
}

export class StoredCredentialReauthorizationRequiredError extends Error {
  override name = 'StoredCredentialReauthorizationRequiredError';
  readonly errorCode = 'invalid_grant';
}

export class StoredCredentialRefreshMisconfiguredError extends Error {
  override name = 'StoredCredentialRefreshMisconfiguredError';
  readonly errorCode = 'invalid_client';
}

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

  const refreshedTokens = await refreshAuthorization(
    discoveryState.authorizationServerUrl,
    {
      metadata: discoveryState.authorizationServerMetadata,
      clientInformation,
      refreshToken: tokens.refresh_token,
      resource: discoveryState.resourceMetadata?.resource === undefined
        ? undefined
        : new URL(discoveryState.resourceMetadata.resource),
      fetchFn: options.fetchFn,
    },
  );
  await provider.saveTokens(refreshedTokens);
  return {
    refreshTokenRotated: refreshedTokens.refresh_token !== tokens.refresh_token,
  };
}
