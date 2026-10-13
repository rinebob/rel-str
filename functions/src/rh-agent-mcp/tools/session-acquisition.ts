/**
 * Session acquisition + call-failure plumbing shared by the executor's
 * single-call and batch paths and the warm session cache (task #808).
 *
 * Split out of robinhood-tool-executor.ts so the cache can depend on the
 * acquisition primitives without depending on the executor.
 */
import { McpError } from '@modelcontextprotocol/sdk/types.js';
import {
  type RobinhoodMcpTransportFactory,
  McpSessionNotConnectedError,
} from '../client/robinhood-mcp-session';
import {
  connectLocalRobinhoodMcpSession,
  type ConnectLocalRobinhoodMcpSessionOptions,
  type ConnectedRobinhoodMcpSession,
  RobinhoodMcpConnectionError,
} from '../auth/robinhood-mcp-connection';
import type { OAuthRefreshFetch } from '../auth/stored-credential-refresh';
import {
  ToolExecutionErrorCategory,
  type ToolExecutionError,
} from '@robinhood-mcp/contracts';

/**
 * Warm session source owned by the host (the cloud `rhApi` instance keeps one
 * across requests). `acquire()` returns a connected session the caller must
 * NOT close; `recover()` is invoked when a session produced a session-level
 * failure and returns a usable connection — rebuilding when `failed` is still
 * cached, adopting the current entry when a peer already rotated it.
 */
export interface ObservationSessionCache {
  acquire(): Promise<ConnectedRobinhoodMcpSession>;
  recover(
    failed: ConnectedRobinhoodMcpSession,
  ): Promise<ConnectedRobinhoodMcpSession>;
  /** Call-outcome signal for liveness tracking — timeouts count toward a
   *  wedged-session streak, completed calls reset it. */
  noteOutcome(
    connection: ConnectedRobinhoodMcpSession,
    outcome: 'completed' | 'timeout',
  ): void;
}

/** Timeout for session establishment — credential load, token refresh, and
 *  the transport handshake all live inside connect and must never hang a
 *  request through to the host timeout. */
export const MCP_CONNECT_TIMEOUT_MS = 30_000;

/** Timeout on an individual MCP callTool — kept distinct so the session
 *  cache's reconnect-once can exclude it: a timed-out call may still be
 *  executing server-side, and retrying a mutation could double-submit. */
export class McpCallTimeoutError extends Error {
  override name = 'McpCallTimeoutError';
}

/** Reject a promise if it does not settle within timeoutMs. */
export function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string | (() => Error)): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(typeof message === 'function' ? message() : new Error(message)),
      timeoutMs,
    );
  });
  return Promise.race([promise, timeoutPromise]).finally(() => {
    if (timer) clearTimeout(timer);
  });
}

/** Thrown errors from the call path that mean the session/transport is
 *  unusable — worth ONE recover + retry on a fresh connection. Excluded:
 *  - `McpCallTimeoutError` — the call may still be executing server-side;
 *    retrying a mutation could double-submit. A timeout streak rotates the
 *    session via `noteOutcome` instead.
 *  - `McpError` — a JSON-RPC error *response* (unknown tool, bad params,
 *    tool failure): proof the session and transport are alive. Treating it
 *    as session-level would tear down a healthy connection — severing
 *    sibling calls in flight. The name check covers a duplicated SDK copy
 *    in node_modules (instanceof would miss it). */
export function isSessionFailure(error: unknown): boolean {
  return (
    error instanceof Error &&
    !(error instanceof McpCallTimeoutError) &&
    !(error instanceof McpError || error.name === 'McpError')
  );
}

export function categorizeExecutionError(error: unknown): ToolExecutionErrorCategory {
  if (error instanceof RobinhoodMcpConnectionError || error instanceof McpSessionNotConnectedError) {
    return ToolExecutionErrorCategory.AUTH;
  }
  if (error instanceof Error) {
    return ToolExecutionErrorCategory.MCP;
  }
  return ToolExecutionErrorCategory.UNKNOWN;
}

/** Failure envelope for a tool call. `sessionFailure` is an internal retry
 *  marker — set it only for errors thrown by the `callTool` await itself
 *  (parse/redact throws mean the session answered fine), and strip it at
 *  the route boundary before serializing. */
export function toolCallFailure(
  error: unknown,
  sessionFailure = false,
): ToolExecutionError {
  return {
    success: false,
    error: error instanceof Error ? error.message : String(error),
    category: categorizeExecutionError(error),
    ...(sessionFailure ? { sessionFailure: true } : {}),
  };
}

/** Bound a session-cache operation (acquire or recover — both are connects
 *  underneath) to the given deadline. */
export function boundSessionConnect<T>(
  operation: Promise<T>,
  context: string,
  budgetMs = MCP_CONNECT_TIMEOUT_MS,
): Promise<T> {
  return withTimeout(
    operation,
    budgetMs,
    `MCP session connect timed out after ${budgetMs / 1000}s for ${context}`,
  );
}

/** Close under a bound — a hung close must never stall a request path. */
export async function closeSessionBounded(
  connection: ConnectedRobinhoodMcpSession,
): Promise<void> {
  await withTimeout(connection.close(), 5_000, 'MCP session close timed out')
    .catch(() => undefined);
}

export interface SessionConnectDeps {
  transportFactory?: RobinhoodMcpTransportFactory;
  repository?: ConnectLocalRobinhoodMcpSessionOptions['repository'];
  fetchFn?: OAuthRefreshFetch;
}

/**
 * Connect with timeout for an executor-owned session — the single entry
 * point for session acquisition so the batch path can't drift. A
 * Promise.race can't cancel connect: if the timeout wins, the late-arriving
 * connection must still be closed or it leaks a live MCP session/socket.
 */
export async function acquireMcpSession(
  deps: SessionConnectDeps,
  context: string,
): Promise<ConnectedRobinhoodMcpSession> {
  let abandoned = false;
  const connectPromise = connectLocalRobinhoodMcpSession({
    transportFactory: deps.transportFactory,
    repository: deps.repository,
    fetchFn: deps.fetchFn,
  });
  void connectPromise.then(
    (conn) => {
      if (abandoned) {
        void conn.close().catch(() => undefined);
      }
    },
    () => undefined,
  );
  try {
    return await boundSessionConnect(connectPromise, context);
  } catch (error) {
    abandoned = true;
    throw error;
  }
}
