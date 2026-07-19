import type { RobinhoodCredentialRepository } from './credential-repository';
import {
  RobinhoodMcpSession,
  type RobinhoodMcpTransportFactory,
} from '../client/robinhood-mcp-session';
import { createLocalCredentialRepository } from './local-credential-repository';
import { RepositoryOAuthProvider } from './repository-oauth-provider';
import { refreshStoredCredential } from './stored-credential-refresh';
import { DefaultTokenRefreshPolicy } from './token-refresh-policy';
import { classifyAuthenticationError } from './authentication-error-classifier';

export class RobinhoodMcpConnectionError extends Error {
  override name = 'RobinhoodMcpConnectionError';
  constructor(message: string) {
    super(message);
  }
}

export interface ConnectedRobinhoodMcpSession {
  session: RobinhoodMcpSession;
  close: () => Promise<void>;
}

export interface ConnectLocalRobinhoodMcpSessionOptions {
  repository?: RobinhoodCredentialRepository;
  transportFactory?: RobinhoodMcpTransportFactory;
  now?: Date;
}

export async function connectLocalRobinhoodMcpSession(
  options: ConnectLocalRobinhoodMcpSessionOptions = {},
): Promise<ConnectedRobinhoodMcpSession> {
  const repository = options.repository ?? createLocalCredentialRepository();
  const provider = new RepositoryOAuthProvider(repository, {
    redirectUrl: 'http://127.0.0.1:0/callback',
    openAuthorizationUrl: async () => {
      throw new RobinhoodMcpConnectionError(
        'No stored Robinhood credential. Run the local OAuth bootstrap first.',
      );
    },
  });

  const bundle = await provider.currentBundle();
  const now = options.now ?? new Date();
  const refreshPolicy = new DefaultTokenRefreshPolicy();

  if (!bundle?.tokens) {
    throw new RobinhoodMcpConnectionError(
      'No stored Robinhood credential. Run the local OAuth bootstrap first.',
    );
  }

  if (refreshPolicy.shouldRefresh(bundle, now, false)) {
    try {
      await refreshStoredCredential(provider, { now });
    } catch (error) {
      const { state } = classifyAuthenticationError(error);
      throw new RobinhoodMcpConnectionError(
        `Failed to refresh stored Robinhood credential: ${state}. Re-run the local OAuth bootstrap.`,
      );
    }
  }

  const session = new RobinhoodMcpSession(provider, options.transportFactory);
  await session.connect();

  return {
    session,
    close: async () => {
      await session.close().catch(() => undefined);
    },
  };
}
