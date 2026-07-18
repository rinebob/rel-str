import { randomBytes } from 'node:crypto';
import {
  auth,
  type AuthResult,
  type OAuthClientProvider,
} from '@modelcontextprotocol/sdk/client/auth.js';
import { classifyAuthenticationError } from './authentication-error-classifier';
import type { RobinhoodCredentialRepository } from './credential-repository';
import { createLocalCredentialRepository } from './local-credential-repository';
import {
  RepositoryOAuthProvider,
  type RepositoryOAuthProviderSnapshot,
} from './repository-oauth-provider';
import { startLocalOAuthCallbackServer } from './local-oauth-callback-server';
import { openAuthorizationUrl } from './open-authorization-url';
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

export type OAuthAuthorizationDriver = (
  provider: OAuthClientProvider,
  authorizationCode?: string,
) => Promise<AuthResult>;

export type LocalOAuthBootstrapCategory =
  | 'INITIAL_AUTHORIZATION_FAILED'
  | 'CALLBACK_FAILED'
  | 'TOKEN_EXCHANGE_FAILED'
  | 'LIST_TOOLS_FAILED'
  | 'BOOTSTRAP_SUCCEEDED'
  | 'STORED_CREDENTIAL_REUSED';

export interface LocalOAuthBootstrapEvidence extends RepositoryOAuthProviderSnapshot {
  resultCategory: LocalOAuthBootstrapCategory;
  callbackAccepted: boolean;
  toolCount: number;
  accessTokenPresent: boolean;
  refreshTokenPresent: boolean;
  expiryPresent: boolean;
}

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
}

const sdkAuthorize: OAuthAuthorizationDriver = (provider, authorizationCode) =>
  auth(provider, {
    serverUrl: ROBINHOOD_TRADING_MCP_URL,
    authorizationCode,
  });

function evidence(
  provider: RepositoryOAuthProvider,
  resultCategory: LocalOAuthBootstrapCategory,
  callbackAccepted: boolean,
  toolCount: number,
): LocalOAuthBootstrapEvidence {
  return {
    resultCategory,
    callbackAccepted,
    toolCount,
    ...provider.snapshot(),
  };
}

export function runLocalOAuthBootstrap(): Promise<LocalOAuthBootstrapResult> {
  return runLocalOAuthBootstrapWithDependencies({});
}

export async function runLocalOAuthBootstrapWithDependencies(
  options: LocalOAuthBootstrapDependencies,
): Promise<LocalOAuthBootstrapResult> {
  const repository = options.repository ?? createLocalCredentialRepository();
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
      openAuthorizationUrl: options.openAuthorizationUrl ?? openAuthorizationUrl,
    },
  );
  const authorize = options.authorize ?? sdkAuthorize;

  try {
    let initialResult: AuthResult;
    try {
      initialResult = await authorize(provider);
    } catch (error) {
      return {
        state: classifyAuthenticationError(error).state,
        evidence: evidence(provider, 'INITIAL_AUTHORIZATION_FAILED', false, 0),
      };
    }

    if (initialResult === 'AUTHORIZED') {
      state = undefined;
      provider.clearBootstrapState();
      return await runSession(provider, options.transportFactory, 'STORED_CREDENTIAL_REUSED', false);
    }

    let authorizationCode: string | undefined;
    try {
      const callback = await callbackServer.callback;
      authorizationCode = callback.takeAuthorizationCode();
    } catch (error) {
      return {
        state: classifyAuthenticationError(error).state,
        evidence: evidence(provider, 'CALLBACK_FAILED', false, 0),
      };
    }

    try {
      if (await authorize(provider, authorizationCode) !== 'AUTHORIZED') {
        return {
          state: 'REAUTHORIZATION_REQUIRED',
          evidence: evidence(provider, 'TOKEN_EXCHANGE_FAILED', true, 0),
        };
      }
    } catch (error) {
      return {
        state: classifyAuthenticationError(error).state,
        evidence: evidence(provider, 'TOKEN_EXCHANGE_FAILED', true, 0),
      };
    } finally {
      authorizationCode = undefined;
      state = undefined;
      provider.clearBootstrapState();
    }

    return await runSession(provider, options.transportFactory, 'BOOTSTRAP_SUCCEEDED', true);
  } finally {
    state = undefined;
    provider.clearBootstrapState();
    await callbackServer.close();
  }
}

async function runSession(
  provider: RepositoryOAuthProvider,
  transportFactory: RobinhoodMcpTransportFactory | undefined,
  successCategory: LocalOAuthBootstrapCategory,
  callbackAccepted: boolean,
): Promise<LocalOAuthBootstrapResult> {
  const session = new RobinhoodMcpSession(provider, transportFactory);
  try {
    await session.connect();
    const toolCount = await session.listTools();
    return {
      state: 'CONNECTED',
      evidence: evidence(provider, successCategory, callbackAccepted, toolCount),
    };
  } catch (error) {
    return {
      state: classifyAuthenticationError(error).state,
      evidence: evidence(provider, 'LIST_TOOLS_FAILED', callbackAccepted, 0),
    };
  } finally {
    await session.close().catch(() => undefined);
  }
}
