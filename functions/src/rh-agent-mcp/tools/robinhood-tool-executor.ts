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
   * Authoritative schema source — pass the LIVE tools/list definition when
   * the bundled catalog may have drifted (ajv removeAdditional would strip a
   * live-only param before the call). Falls back to the bundled catalog.
   */
  definition?: RobinhoodToolDefinition;
  /** Test seam — forwarded to the stored-credential refresh's token POST. */
  fetchFn?: OAuthRefreshFetch;
}

/** Timeout for individual MCP tool calls (45 seconds — longer than the frontend 30s). */
export const MCP_CALL_TIMEOUT_MS = 45_000;

/** Timeout for session establishment — credential load, token refresh, and
 *  the transport handshake all live inside connect and must never hang a
 *  request through to the host timeout. */
export const MCP_CONNECT_TIMEOUT_MS = 30_000;

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

  let connection: ConnectedRobinhoodMcpSession | undefined;
  let connectAbandoned = false;
  const connectPromise = connectLocalRobinhoodMcpSession({
    transportFactory: options.transportFactory,
    repository: options.repository,
    fetchFn: options.fetchFn,
  });
  // Promise.race can't cancel — if the timeout wins, the late-arriving
  // connection must still be closed or it leaks a live MCP session/socket.
  void connectPromise.then(
    (conn) => {
      if (connectAbandoned) {
        void conn.close().catch(() => undefined);
      }
    },
    () => undefined,
  );
  try {
    connection = await withTimeout(
      connectPromise,
      MCP_CONNECT_TIMEOUT_MS,
      `MCP session connect timed out after ${MCP_CONNECT_TIMEOUT_MS / 1000}s for tool "${toolName}"`,
    );
    const mcpResult = await withTimeout(
      connection.session.callTool(stripServerPrefix(toolName), validation.args),
      MCP_CALL_TIMEOUT_MS,
      `MCP callTool timed out after ${MCP_CALL_TIMEOUT_MS / 1000}s for tool "${toolName}"`,
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
    connectAbandoned = true;
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
      category: categorizeExecutionError(error),
    };
  } finally {
    await connection?.close().catch(() => undefined);
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
