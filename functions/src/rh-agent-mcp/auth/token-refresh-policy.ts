import type { RobinhoodCredentialBundle } from '../contracts/authentication';

export const TOKEN_EXPIRY_SAFETY_WINDOW_MS = 60_000;

export interface TokenRefreshPolicy {
  shouldRefresh(
    credential: RobinhoodCredentialBundle | null,
    now: Date,
    forceRefresh?: boolean,
  ): boolean;
}

export class DefaultTokenRefreshPolicy implements TokenRefreshPolicy {
  shouldRefresh(
    credential: RobinhoodCredentialBundle | null,
    now: Date,
    forceRefresh?: boolean,
  ): boolean {
    if (forceRefresh) {
      return true;
    }
    if (!credential?.tokens) {
      return false;
    }
    if (credential.tokens.expires_in === undefined) {
      return false;
    }
    const refreshedAt = Date.parse(credential.lastTokenResponseAt ?? '');
    if (!Number.isFinite(refreshedAt)) {
      return true;
    }
    return refreshedAt + credential.tokens.expires_in * 1_000 - TOKEN_EXPIRY_SAFETY_WINDOW_MS <= now.getTime();
  }
}
