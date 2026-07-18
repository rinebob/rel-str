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
  now?: () => Date;
  openAuthorizationUrl(authorizationUrl: URL): void | Promise<void>;
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
    await this.persistTokens(tokens);
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

  async currentBundle(): Promise<RobinhoodCredentialBundle | null> {
    await this.ensureLoaded();
    return this.bundle;
  }

  currentRevision(): number | undefined {
    return this.bundle?.revision;
  }

  pkceVerifierGenerated(): boolean {
    return this.pkceGenerated;
  }

  private async persistTokens(tokens: OAuthTokens): Promise<void> {
    await this.ensureLoaded();
    const expectedRevision = this.bundle?.revision ?? null;
    const lastTokenResponseAt = (this.options.now ?? (() => new Date()))().toISOString();
    this.bundle = await this.repository.store({
      schemaVersion: 1,
      revision: expectedRevision ?? 0,
      tokens,
      clientInformation:
        this.pendingClientInformation ?? this.bundle?.clientInformation,
      discoveryState:
        this.pendingDiscoveryState ?? this.bundle?.discoveryState,
      lastTokenResponseAt,
    }, expectedRevision);
    this.pendingClientInformation = undefined;
    this.pendingDiscoveryState = undefined;
  }

  private async ensureLoaded(): Promise<void> {
    if (this.loaded) {
      return;
    }
    this.bundle = await this.repository.load();
    this.loaded = true;
  }
}
