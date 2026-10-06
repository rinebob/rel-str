import type { RobinhoodCredentialRepository } from './credential-repository';
import { CredentialRevisionConflictError } from './credential-repository';
import {
  RobinhoodMcpSession,
  type RobinhoodMcpTransportFactory,
} from '../client/robinhood-mcp-session';
import { createLocalCredentialRepository } from './local-credential-repository';
import { RepositoryOAuthProvider } from './repository-oauth-provider';
import {
  refreshStoredCredential,
  type OAuthRefreshFetch,
} from './stored-credential-refresh';
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
  /** Test seam — forwarded to the stored-credential refresh's token POST. */
  fetchFn?: OAuthRefreshFetch;
}

export async function connectLocalRobinhoodMcpSession(
  options: ConnectLocalRobinhoodMcpSessionOptions = {},
): Promise<ConnectedRobinhoodMcpSession> {
  const repository = options.repository ?? createLocalCredentialRepository();
  const provider = new RepositoryOAuthProvider(repository, {
    redirectUrl: 'http://127.0.0.1:0/callback',
    openAuthorizationUrl: async () => {
      throw new RobinhoodMcpConnectionError(
        'No stored Robinhood credential. Run the local OAuth bootstrap, then upload-rh-credential.',
      );
    },
  });

  const bundle = await provider.currentBundle();
  const now = options.now ?? new Date();
  const refreshPolicy = new DefaultTokenRefreshPolicy();

  if (!bundle?.tokens) {
    throw new RobinhoodMcpConnectionError(
      'No stored Robinhood credential. Run the local OAuth bootstrap, then upload-rh-credential.',
    );
  }

  if (refreshPolicy.shouldRefresh(bundle, now, false)) {
    try {
      await refreshStoredCredential(provider, { now, fetchFn: options.fetchFn });
    } catch (error) {
      // A concurrent request/instance may have rotated the credential first.
      // Adopt the winner's stored bundle rather than minting a competing
      // rotation (which could strand the shared credential).
      if (error instanceof CredentialRevisionConflictError) {
        let latest;
        try {
          latest = await provider.reloadBundle();
        } catch (reloadError) {
          const { state } = classifyAuthenticationError(reloadError);
          throw new RobinhoodMcpConnectionError(
            `Failed to reload the concurrently-rotated Robinhood credential: ${state}. Re-run the local OAuth bootstrap, then upload-rh-credential.`,
          );
        }
        if (!latest?.tokens || refreshPolicy.shouldRefresh(latest, now, false)) {
          throw new RobinhoodMcpConnectionError(
            'Stored Robinhood credential was concurrently rotated and still requires refresh. Re-run the local OAuth bootstrap, then upload-rh-credential.',
          );
        }
      } else {
        const { state } = classifyAuthenticationError(error);
        throw new RobinhoodMcpConnectionError(
          `Failed to refresh stored Robinhood credential: ${state}. Re-run the local OAuth bootstrap, then upload-rh-credential.`,
        );
      }
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
