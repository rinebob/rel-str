import type { RepositoryOAuthProvider } from './repository-oauth-provider';

export type LocalOAuthBootstrapCategory =
  | 'INITIAL_AUTHORIZATION_FAILED'
  | 'CALLBACK_FAILED'
  | 'TOKEN_EXCHANGE_FAILED'
  | 'LIST_TOOLS_FAILED'
  | 'REFRESH_FAILED'
  | 'BOOTSTRAP_SUCCEEDED'
  | 'STORED_CREDENTIAL_REFRESHED'
  | 'STORED_CREDENTIAL_REUSED';

export interface LocalOAuthBootstrapEvidence {
  resultCategory: LocalOAuthBootstrapCategory;
  callbackAccepted: boolean;
  toolCount: number;
  accessTokenPresent: boolean;
  refreshTokenPresent: boolean;
  expiryPresent: boolean;
  refreshAttempted: boolean;
  refreshSucceeded: boolean;
  refreshTokenRotated: boolean;
  credentialRevisionAdvanced: boolean;
  subsequentCallSucceeded: boolean;
  discoveryStatePresent: boolean;
  authorizationServerMetadataPresent: boolean;
  resourceMetadataPresent: boolean;
  clientInformationPresent: boolean;
  pkceVerifierGenerated: boolean;
  tokenPresent: boolean;
  credentialsPersisted: boolean;
  clientRegistrationPersisted: boolean;
}

export interface RefreshEvidence {
  refreshAttempted: boolean;
  refreshSucceeded: boolean;
  refreshTokenRotated: boolean;
  credentialRevisionAdvanced: boolean;
}

export const NO_REFRESH_EVIDENCE: RefreshEvidence = {
  refreshAttempted: false,
  refreshSucceeded: false,
  refreshTokenRotated: false,
  credentialRevisionAdvanced: false,
};

export interface BootstrapEvidenceInput {
  resultCategory: LocalOAuthBootstrapCategory;
  callbackAccepted: boolean;
  toolCount: number;
  refreshEvidence: RefreshEvidence;
}

export async function buildBootstrapEvidence(
  provider: RepositoryOAuthProvider,
  input: BootstrapEvidenceInput,
): Promise<LocalOAuthBootstrapEvidence> {
  const [tokens, clientInformation, discoveryState] = await Promise.all([
    provider.tokens(),
    provider.clientInformation(),
    provider.discoveryState(),
  ]);

  return {
    resultCategory: input.resultCategory,
    callbackAccepted: input.callbackAccepted,
    toolCount: input.toolCount,
    ...input.refreshEvidence,
    subsequentCallSucceeded: input.toolCount > 0,
    discoveryStatePresent: discoveryState !== undefined,
    authorizationServerMetadataPresent:
      discoveryState?.authorizationServerMetadata !== undefined,
    resourceMetadataPresent: discoveryState?.resourceMetadata !== undefined,
    clientInformationPresent: clientInformation !== undefined,
    pkceVerifierGenerated: provider.pkceVerifierGenerated(),
    tokenPresent: tokens !== undefined,
    credentialsPersisted: provider.currentRevision() !== undefined,
    clientRegistrationPersisted: clientInformation !== undefined,
    accessTokenPresent: Boolean(tokens?.access_token),
    refreshTokenPresent: Boolean(tokens?.refresh_token),
    expiryPresent: tokens?.expires_in !== undefined,
  };
}
