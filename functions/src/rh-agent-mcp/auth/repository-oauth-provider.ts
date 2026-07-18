import type {
  OAuthClientProvider,
  OAuthDiscoveryState,
} from '@modelcontextprotocol/sdk/client/auth.js';
import type {
  OAuthClientInformationMixed,
  OAuthClientMetadata,
  OAuthTokens,
} from '@modelcontextprotocol/sdk/shared/auth.js';
import type { RobinhoodCredentialRepository } from './credential-repository';
import type { RobinhoodCredentialBundle } from '../contracts/authentication';

export interface RepositoryOAuthProviderOptions {
  redirectUrl: string;
  state?: string;
  openAuthorizationUrl(authorizationUrl: URL): void | Promise<void>;
}

export interface RepositoryOAuthProviderSnapshot {
  discoveryStatePresent: boolean;
  authorizationServerMetadataPresent: boolean;
  resourceMetadataPresent: boolean;
  clientInformationPresent: boolean;
  pkceVerifierGenerated: boolean;
  tokenPresent: boolean;
  credentialsPersisted: boolean;
  clientRegistrationPersisted: boolean;
  accessTokenPresent: boolean;
  refreshTokenPresent: boolean;
  expiryPresent: boolean;
}

export class RepositoryOAuthProvider implements OAuthClientProvider {
  private loaded = false;
  private bundle: RobinhoodCredentialBundle | null = null;
  private pendingClientInformation: OAuthClientInformationMixed | undefined;
  private pendingDiscoveryState: OAuthDiscoveryState | undefined;
  private verifier: string | undefined;
  private oauthState: string | undefined;
  private pkceGenerated = false;

  constructor(
    private readonly repository: RobinhoodCredentialRepository,
    private readonly options: RepositoryOAuthProviderOptions,
  ) {
    this.oauthState = options.state;
  }

  get redirectUrl(): string {
    return this.options.redirectUrl;
  }

  get clientMetadata(): OAuthClientMetadata {
    return {
      client_name: 'RH Agent local authentication proof',
      redirect_uris: [this.options.redirectUrl],
      grant_types: ['authorization_code'],
      response_types: ['code'],
      token_endpoint_auth_method: 'none',
    };
  }

  state(): string {
    if (!this.oauthState) {
      throw new Error('OAuth state unavailable');
    }
    return this.oauthState;
  }

  async clientInformation(): Promise<OAuthClientInformationMixed | undefined> {
    await this.ensureLoaded();
    return this.pendingClientInformation ?? this.bundle?.clientInformation;
  }

  async saveClientInformation(clientInformation: OAuthClientInformationMixed): Promise<void> {
    await this.ensureLoaded();
    if (!this.bundle) {
      this.pendingClientInformation = clientInformation;
      return;
    }
    this.bundle = await this.repository.store({
      ...this.bundle,
      clientInformation,
    }, this.bundle.revision);
  }

  async tokens(): Promise<OAuthTokens | undefined> {
    await this.ensureLoaded();
    return this.bundle?.tokens;
  }

  async saveTokens(tokens: OAuthTokens): Promise<void> {
    await this.ensureLoaded();
    const expectedRevision = this.bundle?.revision ?? null;
    const stored = await this.repository.store({
      schemaVersion: 1,
      revision: expectedRevision ?? 0,
      tokens,
      clientInformation:
        this.pendingClientInformation ?? this.bundle?.clientInformation,
      discoveryState:
        this.pendingDiscoveryState ?? this.bundle?.discoveryState,
      lastSuccessfulRefreshAt: this.bundle?.lastSuccessfulRefreshAt,
    }, expectedRevision);
    this.bundle = stored;
    this.pendingClientInformation = undefined;
    this.pendingDiscoveryState = undefined;
  }

  redirectToAuthorization(authorizationUrl: URL): void | Promise<void> {
    return this.options.openAuthorizationUrl(authorizationUrl);
  }

  saveCodeVerifier(codeVerifier: string): void {
    this.verifier = codeVerifier;
    this.pkceGenerated = true;
  }

  codeVerifier(): string {
    if (!this.verifier) {
      throw new Error('PKCE verifier unavailable');
    }
    return this.verifier;
  }

  async saveDiscoveryState(discoveryState: OAuthDiscoveryState): Promise<void> {
    await this.ensureLoaded();
    if (!this.bundle) {
      this.pendingDiscoveryState = discoveryState;
      return;
    }
    this.bundle = await this.repository.store({
      ...this.bundle,
      discoveryState,
    }, this.bundle.revision);
  }

  async discoveryState(): Promise<OAuthDiscoveryState | undefined> {
    await this.ensureLoaded();
    return this.pendingDiscoveryState ?? this.bundle?.discoveryState;
  }

  clearBootstrapState(): void {
    this.oauthState = undefined;
    this.verifier = undefined;
  }

  snapshot(): RepositoryOAuthProviderSnapshot {
    const discoveryState = this.pendingDiscoveryState ?? this.bundle?.discoveryState;
    const clientInformation =
      this.pendingClientInformation ?? this.bundle?.clientInformation;
    const tokens = this.bundle?.tokens;
    return {
      discoveryStatePresent: discoveryState !== undefined,
      authorizationServerMetadataPresent:
        discoveryState?.authorizationServerMetadata !== undefined,
      resourceMetadataPresent: discoveryState?.resourceMetadata !== undefined,
      clientInformationPresent: clientInformation !== undefined,
      pkceVerifierGenerated: this.pkceGenerated,
      tokenPresent: tokens !== undefined,
      credentialsPersisted: this.bundle !== null,
      clientRegistrationPersisted: this.bundle?.clientInformation !== undefined,
      accessTokenPresent: Boolean(tokens?.access_token),
      refreshTokenPresent: Boolean(tokens?.refresh_token),
      expiryPresent: tokens?.expires_in !== undefined,
    };
  }

  private async ensureLoaded(): Promise<void> {
    if (this.loaded) {
      return;
    }
    this.bundle = await this.repository.load();
    this.loaded = true;
  }
}
