import { randomBytes } from 'node:crypto';
import {
  auth,
  type AuthResult,
  type OAuthClientProvider,
} from '@modelcontextprotocol/sdk/client/auth.js';
import { classifyAuthenticationError } from './authentication-error-classifier';
import type { RobinhoodCredentialRepository } from './credential-repository';
import { createLocalCredentialRepository } from './local-credential-repository';
import { RepositoryOAuthProvider } from './repository-oauth-provider';
import { startLocalOAuthCallbackServer } from './local-oauth-callback-server';
import { openAuthorizationUrl } from './open-authorization-url';
import {
  refreshStoredCredential,
  type OAuthRefreshFetch,
} from './stored-credential-refresh';
import {
  RobinhoodMcpSession,
  type RobinhoodMcpTransportFactory,
} from '../client/robinhood-mcp-session';
import type { AuthenticationState } from '../contracts/authentication';
import {
  LOCAL_OAUTH_CALLBACK_PORT,
  LOCAL_OAUTH_CALLBACK_TIMEOUT_MS,
  ROBINHOOD_TRADING_MCP_URL,
} from '../contracts/robinhood-mcp';
import {
  type LocalOAuthBootstrapCategory,
  type LocalOAuthBootstrapEvidence,
  type RefreshEvidence,
  NO_REFRESH_EVIDENCE,
  buildBootstrapEvidence,
} from './bootstrap-evidence';
import {
  DefaultTokenRefreshPolicy,
  type TokenRefreshPolicy,
} from './token-refresh-policy';

export type OAuthAuthorizationDriver = (
  provider: OAuthClientProvider,
  authorizationCode?: string,
) => Promise<AuthResult>;

export interface LocalOAuthBootstrapResult {
  state: AuthenticationState;
  evidence: LocalOAuthBootstrapEvidence;
}

export interface LocalOAuthBootstrapDependencies {
  authorize?: OAuthAuthorizationDriver;
  openAuthorizationUrl?: (authorizationUrl: URL) => void | Promise<void>;
  transportFactory?: RobinhoodMcpTransportFactory;
  callbackPort?: number;
  callbackTimeoutMs?: number;
  repository?: RobinhoodCredentialRepository;
  now?: () => Date;
  refreshFetch?: OAuthRefreshFetch;
  forceRefresh?: boolean;
  refreshPolicy?: TokenRefreshPolicy;
}

const sdkAuthorize: OAuthAuthorizationDriver = (provider, authorizationCode) =>
  auth(provider, {
    serverUrl: ROBINHOOD_TRADING_MCP_URL,
    authorizationCode,
  });

export function runLocalOAuthBootstrap(): Promise<LocalOAuthBootstrapResult> {
  return runLocalOAuthBootstrapWithDependencies({});
}

export async function runLocalOAuthBootstrapWithDependencies(
  options: LocalOAuthBootstrapDependencies,
): Promise<LocalOAuthBootstrapResult> {
  const repository = options.repository ?? createLocalCredentialRepository();
  const now = options.now ?? (() => new Date());
  const refreshPolicy = options.refreshPolicy ?? new DefaultTokenRefreshPolicy();
  let state: string | undefined = randomBytes(32).toString('base64url');
  const callbackServer = await startLocalOAuthCallbackServer({
    expectedState: state,
    port: options.callbackPort ?? LOCAL_OAUTH_CALLBACK_PORT,
    timeoutMs: options.callbackTimeoutMs ?? LOCAL_OAUTH_CALLBACK_TIMEOUT_MS,
  });
  void callbackServer.callback.catch(() => undefined);
  const provider = new RepositoryOAuthProvider(
    repository,
    {
      redirectUrl: callbackServer.redirectUrl,
      state,
      now,
      openAuthorizationUrl: options.openAuthorizationUrl ?? openAuthorizationUrl,
    },
  );
  const authorize = options.authorize ?? sdkAuthorize;

  try {
    const currentTime = now();
    const bundle = await provider.currentBundle();
    const previousRevision = provider.currentRevision();

    if (bundle?.tokens && !refreshPolicy.shouldRefresh(bundle, currentTime, options.forceRefresh)) {
      provider.clearBootstrapState();
      return await runSession(provider, options.transportFactory, 'STORED_CREDENTIAL_REUSED', false, NO_REFRESH_EVIDENCE);
    }

    if (bundle?.tokens) {
      return await tryRefreshStoredCredential(
        provider,
        currentTime,
        options.refreshFetch,
        options.transportFactory,
        previousRevision,
      );
    }

    return await performInitialAuthorization(
      provider,
      authorize,
      callbackServer,
      options.transportFactory,
    );
  } finally {
    state = undefined;
    provider.clearBootstrapState();
    await callbackServer.close();
  }
}

async function tryRefreshStoredCredential(
  provider: RepositoryOAuthProvider,
  now: Date,
  refreshFetch: OAuthRefreshFetch | undefined,
  transportFactory: RobinhoodMcpTransportFactory | undefined,
  previousRevision: number | undefined,
): Promise<LocalOAuthBootstrapResult> {
  try {
    const refreshResult = await refreshStoredCredential(provider, {
      now,
      fetchFn: refreshFetch,
    });
    const newRevision = provider.currentRevision();
    const credentialRevisionAdvanced = previousRevision === undefined
      ? newRevision !== undefined
      : newRevision !== undefined && newRevision > previousRevision;
    provider.clearBootstrapState();
    return await runSession(
      provider,
      transportFactory,
      'STORED_CREDENTIAL_REFRESHED',
      false,
      {
        refreshAttempted: true,
        refreshSucceeded: true,
        refreshTokenRotated: refreshResult.refreshTokenRotated,
        credentialRevisionAdvanced,
      },
    );
  } catch (error) {
    return {
      state: classifyAuthenticationError(error).state,
      evidence: await buildBootstrapEvidence(provider, {
        resultCategory: 'REFRESH_FAILED',
        callbackAccepted: false,
        toolCount: 0,
        refreshEvidence: {
          refreshAttempted: true,
          refreshSucceeded: false,
          refreshTokenRotated: false,
          credentialRevisionAdvanced: false,
        },
      }),
    };
  }
}

async function performInitialAuthorization(
  provider: RepositoryOAuthProvider,
  authorize: OAuthAuthorizationDriver,
  callbackServer: Awaited<ReturnType<typeof startLocalOAuthCallbackServer>>,
  transportFactory: RobinhoodMcpTransportFactory | undefined,
): Promise<LocalOAuthBootstrapResult> {
  let initialResult: AuthResult;
  try {
    initialResult = await authorize(provider);
  } catch (error) {
    return {
      state: classifyAuthenticationError(error).state,
      evidence: await buildBootstrapEvidence(provider, {
        resultCategory: 'INITIAL_AUTHORIZATION_FAILED',
        callbackAccepted: false,
        toolCount: 0,
        refreshEvidence: NO_REFRESH_EVIDENCE,
      }),
    };
  }

  if (initialResult === 'AUTHORIZED') {
    provider.clearBootstrapState();
    return await runSession(provider, transportFactory, 'STORED_CREDENTIAL_REUSED', false, NO_REFRESH_EVIDENCE);
  }

  let authorizationCode: string | undefined;
  try {
    const callback = await callbackServer.callback;
    authorizationCode = callback.takeAuthorizationCode();
  } catch (error) {
    return {
      state: classifyAuthenticationError(error).state,
      evidence: await buildBootstrapEvidence(provider, {
        resultCategory: 'CALLBACK_FAILED',
        callbackAccepted: false,
        toolCount: 0,
        refreshEvidence: NO_REFRESH_EVIDENCE,
      }),
    };
  }

  try {
    if (await authorize(provider, authorizationCode) !== 'AUTHORIZED') {
      return {
        state: 'REAUTHORIZATION_REQUIRED',
        evidence: await buildBootstrapEvidence(provider, {
          resultCategory: 'TOKEN_EXCHANGE_FAILED',
          callbackAccepted: true,
          toolCount: 0,
          refreshEvidence: NO_REFRESH_EVIDENCE,
        }),
      };
    }
  } catch (error) {
    return {
      state: classifyAuthenticationError(error).state,
      evidence: await buildBootstrapEvidence(provider, {
        resultCategory: 'TOKEN_EXCHANGE_FAILED',
        callbackAccepted: true,
        toolCount: 0,
        refreshEvidence: NO_REFRESH_EVIDENCE,
      }),
    };
  } finally {
    authorizationCode = undefined;
    provider.clearBootstrapState();
  }

  return await runSession(provider, transportFactory, 'BOOTSTRAP_SUCCEEDED', true, NO_REFRESH_EVIDENCE);
}

async function runSession(
  provider: RepositoryOAuthProvider,
  transportFactory: RobinhoodMcpTransportFactory | undefined,
  successCategory: LocalOAuthBootstrapCategory,
  callbackAccepted: boolean,
  refreshEvidence: RefreshEvidence,
): Promise<LocalOAuthBootstrapResult> {
  const session = new RobinhoodMcpSession(provider, transportFactory);
  try {
    await session.connect();
    const toolCount = (await session.getToolDefinitions()).length;
    return {
      state: 'CONNECTED',
      evidence: await buildBootstrapEvidence(provider, {
        resultCategory: successCategory,
        callbackAccepted,
        toolCount,
        refreshEvidence,
      }),
    };
  } catch (error) {
    return {
      state: classifyAuthenticationError(error).state,
      evidence: await buildBootstrapEvidence(provider, {
        resultCategory: 'LIST_TOOLS_FAILED',
        callbackAccepted,
        toolCount: 0,
        refreshEvidence,
      }),
    };
  } finally {
    await session.close().catch(() => undefined);
  }
}
