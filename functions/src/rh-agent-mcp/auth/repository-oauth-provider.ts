import type {
  OAuthClientProvider,
  OAuthDiscoveryState,
} from '@modelcontextprotocol/sdk/client/auth.js';
import type {
  OAuthClientInformationMixed,
  OAuthClientMetadata,
  OAuthTokens,
} from '@modelcontextprotocol/sdk/shared/auth.js';
import type {
  RefreshLeasePort,
  RobinhoodCredentialRepository,
} from './credential-repository';
import { CredentialRevisionConflictError } from './credential-repository';
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
  private storedRevision: number | undefined;
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

  /** The repository's refresh-serialization port, when the store supports
   *  it — the only collaborator surface refresh needs outside tokens. */
  get refreshLeasePort(): RefreshLeasePort | undefined {
    return this.repository.refreshLease;
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

  /** Drop pending field writes computed from an OLD baseline — call when
   *  adopting another writer's grant so stale pending can't shadow (and a
   *  later save merge over) the adopted doc's authoritative fields. */
  discardPendingWrites(): void {
    this.pendingClientInformation = undefined;
    this.pendingDiscoveryState = undefined;
  }

  async prepareForAuthorization(): Promise<void> {
    await this.ensureLoaded();
    if (!this.bundle) return;

    this.storedRevision = this.bundle.revision;
    this.pendingClientInformation = this.bundle.clientInformation;
    this.pendingDiscoveryState = this.bundle.discoveryState;
    this.bundle = null;
  }

  async currentBundle(): Promise<RobinhoodCredentialBundle | null> {
    await this.ensureLoaded();
    return this.bundle;
  }

  /** Re-read the repository, replacing the cached view — used after a CAS
   *  conflict so a concurrent refresh's winning bundle wins the session. */
  async reloadBundle(): Promise<RobinhoodCredentialBundle | null> {
    try {
      this.bundle = await this.repository.load();
    } catch (error) {
      // Don't leave `loaded: true` guarding a null bundle — a transient
      // load failure would otherwise permanently empty the provider.
      this.bundle = null;
      this.loaded = false;
      throw error;
    }
    this.loaded = true;
    return this.bundle;
  }

  currentRevision(): number | undefined {
    return this.bundle?.revision ?? this.storedRevision;
  }

  pkceVerifierGenerated(): boolean {
    return this.pkceGenerated;
  }

  private async persistTokens(tokens: OAuthTokens): Promise<void> {
    // A non-refresh writer (saveClientInformation, saveDiscoveryState, an
    // upload --replace) can bump the revision in our load→store gap. Under
    // the refresh lease the POST already minted rotated tokens — dropping
    // them on a CAS conflict leaves the store holding a dead refresh token
    // and the next refresh replays it (#1658). Reload and retry (bounded),
    // but first check whether the interposer ROTATED the grant —
    // deployment-skew old builds still refresh unguarded on the shared doc.
    // A rotated interposer position means our minted tokens are already
    // dead server-side: adopt rather than stamp a dead position over it.
    await this.ensureLoaded();
    const presentedRt = this.bundle?.tokens?.refresh_token;
    // Snapshot the baseline's auth fields alongside presentedRt — if a
    // null reload follows (the doc was deleted mid-flight), the resurrect
    // must write a COMPLETE doc: a tokens-only doc can never self-refresh
    // (missing clientInformation/discoveryState → MISCONFIGURED).
    const presentedClientInformation = this.bundle?.clientInformation;
    const presentedDiscoveryState = this.bundle?.discoveryState;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const expectedRevision = this.bundle?.revision ?? this.storedRevision ?? null;
      const lastTokenResponseAt = (this.options.now ?? (() => new Date()))().toISOString();
      try {
        this.bundle = await this.repository.store({
          schemaVersion: 1,
          revision: expectedRevision ?? 0,
          tokens,
          clientInformation:
            this.pendingClientInformation ?? this.bundle?.clientInformation ?? presentedClientInformation,
          discoveryState:
            this.pendingDiscoveryState ?? this.bundle?.discoveryState ?? presentedDiscoveryState,
          lastTokenResponseAt,
        }, expectedRevision);
        this.pendingClientInformation = undefined;
        this.pendingDiscoveryState = undefined;
        return;
      } catch (error) {
        if (!(error instanceof CredentialRevisionConflictError) || attempt === 2) {
          throw error;
        }
        await this.reloadBundle();
        if (this.bundle === null) {
          // The interposer DELETED the doc — nothing exists to adopt and
          // no revision to CAS against. Our minted tokens are now the
          // only live copy of the lineage (e.g. a zombie refresh racing
          // the upload-seal's delete): resurrect rather than drop them —
          // a lost rotated grant is unrecoverable, a re-created doc is not.
          this.storedRevision = undefined;
        } else if (this.bundle.tokens?.refresh_token !== presentedRt) {
          // Lineage moved past our POST — the interposer's grant wins.
          // Drop pending writes too: they were computed from the OLD
          // baseline and would shadow (and later merge over) the adopted
          // grant's authoritative fields.
          this.pendingClientInformation = undefined;
          this.pendingDiscoveryState = undefined;
          return;
        }
      }
    }
  }

  private async ensureLoaded(): Promise<void> {
    if (this.loaded) {
      return;
    }
    this.bundle = await this.repository.load();
    this.loaded = true;
  }
}
