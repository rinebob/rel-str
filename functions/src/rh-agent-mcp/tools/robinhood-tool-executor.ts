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
import {
  getObservationToolDefinition,
  isObservationTool,
  stripServerPrefix,
} from './robinhood-tools';
import { redactResponse, type RedactionOptions } from './robinhood-response-redactor';
import { validateToolArgs } from './schema-validation';
import {
  ToolExecutionErrorCategory,
  type ToolExecutionError,
  type ToolExecutionResult,
} from '@robinhood-mcp/contracts';

export interface ExecuteObservationToolOptions {
  transportFactory?: RobinhoodMcpTransportFactory;
  repository?: ConnectLocalRobinhoodMcpSessionOptions['repository'];
}

interface McpToolContentItem {
  type: string;
  text?: string;
}

interface McpToolResultShape {
  content?: McpToolContentItem[];
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasTextContent(value: unknown): value is McpToolResultShape {
  if (!isPlainObject(value)) {
    return false;
  }
  const content = value.content;
  return Array.isArray(content) && content.length > 0 && typeof content[0].text === 'string';
}

function parseToolResult(raw: unknown): unknown | undefined {
  if (!hasTextContent(raw)) {
    return undefined;
  }
  try {
    return JSON.parse(raw.content![0].text!);
  } catch {
    return undefined;
  }
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

  const definition = await getObservationToolDefinition(toolName);
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
  try {
    connection = await connectLocalRobinhoodMcpSession({
      transportFactory: options.transportFactory,
      repository: options.repository,
    });
    const mcpResult = await connection.session.callTool(stripServerPrefix(toolName), validation.args);
    const parsed = parseToolResult(mcpResult);
    return {
      success: true,
      parsed,
      redacted: redactResponse(parsed ?? mcpResult, redactionOptions),
      tool: toolName,
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
      category: categorizeExecutionError(error),
    };
  } finally {
    await connection?.close().catch(() => undefined);
  }
}

function categorizeExecutionError(error: unknown): ToolExecutionErrorCategory {
  if (error instanceof RobinhoodMcpConnectionError || error instanceof McpSessionNotConnectedError) {
    return ToolExecutionErrorCategory.AUTH;
  }
  if (error instanceof Error) {
    return ToolExecutionErrorCategory.MCP;
  }
  return ToolExecutionErrorCategory.UNKNOWN;
}
