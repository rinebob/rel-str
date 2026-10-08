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
  getObservationToolDefinition,
  isObservationTool,
  stripServerPrefix,
} from './robinhood-tools';
import { redactResponse, type RedactionOptions } from './robinhood-response-redactor';
import { validateToolArgs } from './schema-validation';
import {
  ToolExecutionErrorCategory,
  type RobinhoodToolDefinition,
  type ToolExecutionError,
  type ToolExecutionResult,
} from '@robinhood-mcp/contracts';
import { isPlainObject } from '@robinhood-mcp/utils';

export interface ExecuteObservationToolOptions {
  transportFactory?: RobinhoodMcpTransportFactory;
  repository?: ConnectLocalRobinhoodMcpSessionOptions['repository'];
  /**
   * Caller-owned session to execute against instead of connecting fresh —
   * the caller owns the lifecycle; the executor neither connects nor
   * closes it. Ignored by `executeObservationToolBatch`, which always
   * owns its session.
   */
  session?: ConnectedRobinhoodMcpSession;
  /**
   * Authoritative schema source — pass the LIVE tools/list definition when
   * the bundled catalog may have drifted (ajv removeAdditional would strip a
   * live-only param before the call). Falls back to the bundled catalog.
   * Per-tool: never reuse across different tool names.
   */
  definition?: RobinhoodToolDefinition;
  /** Test seam — forwarded to the stored-credential refresh's token POST. */
  fetchFn?: OAuthRefreshFetch;
  /** Test seam — per-call MCP timeout override. Default MCP_CALL_TIMEOUT_MS. */
  callTimeoutMs?: number;
  /** Test seam — total batch budget override. Default MCP_BATCH_BUDGET_MS. */
  batchBudgetMs?: number;
}

/** Timeout for individual MCP tool calls (45 seconds — longer than the frontend 30s). */
export const MCP_CALL_TIMEOUT_MS = 45_000;

/** Timeout for session establishment — credential load, token refresh, and
 *  the transport handshake all live inside connect and must never hang a
 *  request through to the host timeout. */
export const MCP_CONNECT_TIMEOUT_MS = 30_000;

/** Upper bound on total batch execution, measured from batch start including
 *  connect. Must stay under the local API's 90s request timeout and rhApi's
 *  120s function timeout — a host kill mid-batch loses every result. 75s
 *  leaves headroom for auth and body parsing on either host. Per-call
 *  timeouts are clamped to the remaining budget so a dispatched call can't
 *  overrun it; calls still pending at the deadline get failure entries. */
export const MCP_BATCH_BUDGET_MS = 75_000;

/** Reject a promise if it does not settle within timeoutMs. */
export function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(message)), timeoutMs);
  });
  return Promise.race([promise, timeoutPromise]).finally(() => {
    if (timer) clearTimeout(timer);
  });
}

interface McpToolContentItem {
  type: string;
  text?: string;
}

interface McpToolResultShape {
  content?: McpToolContentItem[];
}

function hasTextContent(value: unknown): value is McpToolResultShape {
  if (!isPlainObject(value)) {
    return false;
  }
  const content = value.content;
  return Array.isArray(content) && content.length > 0 && typeof content[0].text === 'string';
}

export function parseToolResult(raw: unknown): unknown | undefined {
  if (!hasTextContent(raw)) {
    return undefined;
  }
  try {
    return JSON.parse(raw.content![0].text!);
  } catch {
    return undefined;
  }
}

/**
 * Surface an MCP envelope-level `isError` flag — the envelope is discarded
 * once `parsed` holds the inner body, so `parsed` alone can never see it.
 */
export function toolEnvelopeError(raw: unknown): string | undefined {
  if (!isPlainObject(raw) || raw.isError !== true) {
    return undefined;
  }
  // No truncation — a cut could split a resolved env secret mid-value and
  // leave a partial match downstream scrubbing can't mask.
  if (hasTextContent(raw)) {
    return (raw.content as McpToolContentItem[])[0].text!;
  }
  return 'Tool returned an error result';
}

export async function executeObservationTool(
  toolName: string,
  args: unknown,
  redactionOptions: RedactionOptions = {},
  options: ExecuteObservationToolOptions = {},
): Promise<ToolExecutionResult | ToolExecutionError> {
  if (!isObservationTool(toolName)) {
    return {
      success: false,
      error: `Tool "${toolName}" is not in the observation allowlist.`,
      category: ToolExecutionErrorCategory.VALIDATION,
    };
  }

  // A supplied definition is per-tool — a mismatched one (e.g. plumbed
  // through a shared options bag) would mis-validate every tool.
  if (
    options.definition != null &&
    (typeof options.definition.name !== 'string' ||
      stripServerPrefix(options.definition.name) !== stripServerPrefix(toolName))
  ) {
    return {
      success: false,
      error: `definition for "${String(options.definition.name)}" does not match tool "${toolName}".`,
      category: ToolExecutionErrorCategory.VALIDATION,
    };
  }
  const definition =
    options.definition ?? (await getObservationToolDefinition(toolName));
  if (!definition) {
    return {
      success: false,
      error: `Tool "${toolName}" is not in the observation allowlist.`,
      category: ToolExecutionErrorCategory.VALIDATION,
    };
  }

  if (!isPlainObject(args)) {
    return {
      success: false,
      error: `Tool arguments must be a JSON object.`,
      category: ToolExecutionErrorCategory.VALIDATION,
    };
  }

  const validation = validateToolArgs(definition.inputSchema, args);
  if (!validation.valid) {
    return {
      success: false,
      error: validation.error,
      category: ToolExecutionErrorCategory.VALIDATION,
    };
  }

  const ownsConnection = options.session === undefined;
  let connection: ConnectedRobinhoodMcpSession | undefined;
  try {
    connection = ownsConnection
      ? await acquireMcpSession(options, `tool "${toolName}"`)
      : options.session!;
    const callTimeoutMs = options.callTimeoutMs ?? MCP_CALL_TIMEOUT_MS;
    const mcpResult = await withTimeout(
      connection.session.callTool(stripServerPrefix(toolName), validation.args),
      callTimeoutMs,
      `MCP callTool timed out after ${callTimeoutMs / 1000}s for tool "${toolName}"`,
    );
    const parsed = parseToolResult(mcpResult);
    const toolError = toolEnvelopeError(mcpResult);
    return {
      success: true,
      parsed,
      redacted: redactResponse(parsed ?? mcpResult, redactionOptions),
      tool: toolName,
      ...(toolError !== undefined ? { toolError } : {}),
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
      category: categorizeExecutionError(error),
    };
  } finally {
    if (ownsConnection && connection) {
      await withTimeout(connection.close(), 5_000, 'MCP session close timed out')
        .catch(() => undefined);
    }
  }
}

/**
 * Connect with timeout for an executor-owned session — the single entry
 * point for session acquisition so the batch path can't drift. A
 * Promise.race can't cancel connect: if the timeout wins, the late-arriving
 * connection must still be closed or it leaks a live MCP session/socket.
 */
async function acquireMcpSession(
  options: ExecuteObservationToolOptions,
  context: string,
): Promise<ConnectedRobinhoodMcpSession> {
  let abandoned = false;
  const connectPromise = connectLocalRobinhoodMcpSession({
    transportFactory: options.transportFactory,
    repository: options.repository,
    fetchFn: options.fetchFn,
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
    return await withTimeout(
      connectPromise,
      MCP_CONNECT_TIMEOUT_MS,
      `MCP session connect timed out after ${MCP_CONNECT_TIMEOUT_MS / 1000}s for ${context}`,
    );
  } catch (error) {
    abandoned = true;
    throw error;
  }
}

export interface ObservationBatchCall {
  tool: string;
  args?: unknown;
}

/** Per-item result — every entry carries `tool` so a failure is still
 *  self-describing without index correlation. */
export type ObservationBatchItemResult = ToolExecutionResult & { tool: string };

/** `{ success: true, results }` on a connected batch; a connect-level
 *  failure returns the single-call-style failure envelope instead. */
export type ObservationBatchOutcome =
  | { success: true; results: ObservationBatchItemResult[] }
  | ToolExecutionError;

/**
 * Sequential batch over ONE MCP session. Per-item failures (allowlist,
 * schema, MCP error, timeout, budget) are isolated — a throw inside a call
 * is converted to its failure entry and never aborts the loop. The
 * batch-level budget bounds total execution so a max-size batch can't be
 * host-killed mid-flight.
 */
export async function executeObservationToolBatch(
  calls: ObservationBatchCall[],
  options: ExecuteObservationToolOptions = {},
): Promise<ObservationBatchOutcome> {
  if (calls.length === 0) {
    return { success: true, results: [] };
  }
  const budgetMs = options.batchBudgetMs ?? MCP_BATCH_BUDGET_MS;
  const deadline = Date.now() + budgetMs;

  let connection: ConnectedRobinhoodMcpSession;
  try {
    connection = await acquireMcpSession(options, 'batch');
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
      category: categorizeExecutionError(error),
    };
  }

  try {
    const results: ObservationBatchItemResult[] = [];
    for (const call of calls) {
      // Safe even on a malformed item — the isolation guarantee is
      // self-contained here, not delegated to the route's validation.
      const tool = typeof call?.tool === 'string' ? call.tool : '';
      const remaining = deadline - Date.now();
      if (remaining <= 0) {
        results.push({
          success: false,
          tool,
          error: `Batch budget of ${budgetMs / 1000}s exhausted before dispatch`,
          category: ToolExecutionErrorCategory.MCP,
        });
        continue;
      }
      try {
        const result = await executeObservationTool(tool, call?.args ?? {}, {}, {
          ...options,
          // Clamp the call's timeout to the remaining budget so the
          // deadline bounds total execution, not just dispatch.
          callTimeoutMs: Math.min(
            options.callTimeoutMs ?? MCP_CALL_TIMEOUT_MS,
            remaining,
          ),
          // `definition` is per-tool — a caller-supplied one would
          // mis-validate every subsequent item in the batch.
          definition: undefined,
          session: connection,
        });
        results.push({ ...result, tool });
      } catch (error) {
        results.push({
          success: false,
          tool,
          error: error instanceof Error ? error.message : String(error),
          category: categorizeExecutionError(error),
        });
      }
    }
    return { success: true, results };
  } finally {
    await withTimeout(connection.close(), 5_000, 'MCP session close timed out')
      .catch(() => undefined);
  }
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
