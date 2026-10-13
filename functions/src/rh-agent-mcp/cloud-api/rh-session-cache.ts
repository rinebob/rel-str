/**
 * Warm MCP session cache for the cloud `rhApi` function (task #808).
 *
 * A connected Robinhood MCP session costs a credential load, possibly a
 * token refresh, and the transport handshake — hundreds of milliseconds per
 * request when every call connects fresh. One module-scope cache per warm
 * instance keeps the session alive across requests.
 *
 * Reuse is keyed on the repository's stored access token: `acquire()` reads
 * the bundle, and a token that changed since the session was built (another
 * instance rotated the credential) discards the cached connection and
 * rebuilds. The token compared is the one the session was *actually* built
 * with (`ConnectedRobinhoodMcpSession.accessToken` — captured post-connect,
 * so an in-connect refresh doesn't leave the entry stale).
 *
 * `recover(failed)` handles the reconnect-once path: if the failed
 * connection is still the cached one it is closed and replaced; if a
 * concurrent request already rotated it, the current entry is adopted
 * instead of double-closing a session a peer may be using. Rebuilds are
 * single-flight — concurrent acquires share one connect.
 */
import {
  connectLocalRobinhoodMcpSession,
  NO_STORED_CREDENTIAL_MESSAGE,
  RobinhoodMcpConnectionError,
  type ConnectedRobinhoodMcpSession,
  type ConnectLocalRobinhoodMcpSessionOptions,
} from '../auth/robinhood-mcp-connection';
import type { RobinhoodCredentialRepository } from '../auth/credential-repository';
import {
  boundSessionConnect,
  closeSessionBounded,
  MCP_CONNECT_TIMEOUT_MS,
} from '../tools/session-acquisition';

/** Structured lifecycle signal — prod wires it to `logger.info` so session
 *  reuse is observable in Cloud Logging (`rh_mcp_session` events). */
export interface SessionCacheEvent {
  type: 'connect';
  reason: 'cold' | 'token_mismatch' | 'recover' | 'timeout_streak';
}

export interface RobinhoodMcpSessionCacheOptions {
  repository: RobinhoodCredentialRepository;
  transportFactory?: ConnectLocalRobinhoodMcpSessionOptions['transportFactory'];
  /** Test seam — defaults to connectLocalRobinhoodMcpSession. */
  connect?: (
    options: ConnectLocalRobinhoodMcpSessionOptions,
  ) => Promise<ConnectedRobinhoodMcpSession>;
  /** Test seam — bound on the connect attempt itself. Default
   *  MCP_CONNECT_TIMEOUT_MS. */
  connectTimeoutMs?: number;
  onEvent?: (event: SessionCacheEvent) => void;
}

/** Consecutive call timeouts on one entry before the session is rebuilt.
 *  A single timeout is usually a slow call — the call may still be executing
 *  server-side, so it is never retried. But a transport that stays "open"
 *  while never responding produces timeouts forever, and nothing else heals
 *  it: after a streak the entry is treated as wedged and rotated (the
 *  rebuild closes the old connection — a rare, justified disruption). */
const TIMEOUT_STREAK_LIMIT = 3;

interface SessionEntry {
  connection: ConnectedRobinhoodMcpSession;
  accessToken: string;
  timeouts: number;
}

export class RobinhoodMcpSessionCache {
  private entry?: SessionEntry;
  private pending?: Promise<ConnectedRobinhoodMcpSession>;

  constructor(private readonly options: RobinhoodMcpSessionCacheOptions) {}

  /**
   * Reuse the cached session when the repository's stored access token still
   * matches the one the session was built with; otherwise rebuild. Never
   * hands out a connection the caller must close.
   */
  async acquire(): Promise<ConnectedRobinhoodMcpSession> {
    const bundle = await this.options.repository.load();
    const currentToken = bundle?.tokens?.access_token;
    if (!currentToken) {
      throw new RobinhoodMcpConnectionError(NO_STORED_CREDENTIAL_MESSAGE);
    }
    if (this.entry?.accessToken === currentToken) {
      return this.entry.connection;
    }
    return this.rebuild(this.entry ? 'token_mismatch' : 'cold');
  }

  /**
   * Called when `failed` produced a session-level error. If it is still the
   * cached connection, close and rebuild; if a peer already rotated it,
   * re-validate and adopt the current entry — never close a connection
   * owned by an in-flight sibling request.
   */
  async recover(
    failed: ConnectedRobinhoodMcpSession,
  ): Promise<ConnectedRobinhoodMcpSession> {
    if (this.entry?.connection !== failed) {
      return this.acquire();
    }
    this.entry = undefined;
    await closeSessionBounded(failed);
    return this.rebuild('recover');
  }

  /**
   * Call-outcome signal for liveness tracking — the executor reports a
   * timeout vs. a completed call on `connection`. A success resets the
   * streak; reaching TIMEOUT_STREAK_LIMIT rotates the entry in the
   * background. No-op for connections the cache has already rotated past.
   */
  noteOutcome(
    connection: ConnectedRobinhoodMcpSession,
    outcome: 'completed' | 'timeout',
  ): void {
    if (this.entry?.connection !== connection) return;
    if (outcome === 'completed') {
      this.entry.timeouts = 0;
      return;
    }
    this.entry.timeouts += 1;
    if (this.entry.timeouts < TIMEOUT_STREAK_LIMIT) return;
    const wedged = this.entry;
    this.entry = undefined;
    void closeSessionBounded(wedged.connection);
    void this.rebuild('timeout_streak').catch(() => undefined);
  }

  /** Single-flight rebuild — concurrent acquires share one connect. The
   *  attempt is bounded HERE, not just by callers: a hung connect must not
   *  leave `pending` unsettled forever — every later acquire would join it
   *  and time out until the instance restarts. The attempt itself keeps
   *  running after the bound fires; a late-resolving session still adopts
   *  itself into `entry`, so the cache self-heals a wedged connect. */
  private rebuild(reason: SessionCacheEvent['reason']): Promise<ConnectedRobinhoodMcpSession> {
    this.pending ??= boundSessionConnect(
      this.connect(reason),
      `session rebuild (${reason})`,
      this.options.connectTimeoutMs ?? MCP_CONNECT_TIMEOUT_MS,
    ).finally(() => {
      this.pending = undefined;
    });
    return this.pending;
  }

  private async connect(
    reason: SessionCacheEvent['reason'],
  ): Promise<ConnectedRobinhoodMcpSession> {
    const connect = this.options.connect ?? connectLocalRobinhoodMcpSession;
    // Close the replaced session first — its token is stale, and some MCP
    // servers accept only one transport at a time. recover() already closed
    // `failed` itself; in that path `previous` is undefined.
    const previous = this.entry;
    this.entry = undefined;
    if (previous) {
      await closeSessionBounded(previous.connection);
    }
    const connection = await connect({
      repository: this.options.repository,
      transportFactory: this.options.transportFactory,
    });
    // A peer attempt may have adopted an entry while this one was still
    // connecting (this attempt timed out for its joiners but kept running).
    // Ours is redundant then — close it and hand back the peer's session.
    // Read through a cast: `this.entry` may have been repopulated across the
    // awaits even though control-flow narrowing still believes it undefined.
    const adopted = this.entry as SessionEntry | undefined;
    if (adopted !== undefined) {
      await closeSessionBounded(connection);
      return adopted.connection;
    }
    this.entry = { connection, accessToken: connection.accessToken, timeouts: 0 };
    this.options.onEvent?.({ type: 'connect', reason });
    return connection;
  }
}
