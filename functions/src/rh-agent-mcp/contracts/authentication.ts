import type { OAuthDiscoveryState } from '@modelcontextprotocol/sdk/client/auth.js';
import type {
  OAuthClientInformationMixed,
  OAuthTokens,
} from '@modelcontextprotocol/sdk/shared/auth.js';

export type {
  OAuthDiscoveryState,
  OAuthClientInformationMixed,
  OAuthTokens,
};

export type AuthenticationState =
  | 'UNCONFIGURED'
  | 'AUTHORIZATION_PENDING'
  | 'CONNECTED'
  | 'REFRESHING'
  | 'REAUTHORIZATION_REQUIRED'
  | 'TEMPORARILY_UNAVAILABLE'
  | 'MISCONFIGURED';

export interface RobinhoodCredentialBundle {
  schemaVersion: number;
  revision: number;
  tokens: OAuthTokens;
  clientInformation?: OAuthClientInformationMixed;
  discoveryState?: OAuthDiscoveryState;
  lastSuccessfulRefreshAt?: string;
}

