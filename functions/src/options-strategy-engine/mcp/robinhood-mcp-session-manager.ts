/**
 *
 * Robinhood MCP session manager for a single Cloud Function invocation.
 *
 * Opens one MCP session lazily, reuses it across tool calls, and closes it
 * when the function returns. In production it reads the `RH_CREDENTIAL_BUNDLE`
 * secret from the function environment.
 */

import { type RobinhoodMcpTransportFactory } from '../../rh-agent-mcp/client/robinhood-mcp-session';
import {
  connectLocalRobinhoodMcpSession,
  type ConnectedRobinhoodMcpSession,
  type ConnectLocalRobinhoodMcpSessionOptions,
} from '../../rh-agent-mcp/auth/robinhood-mcp-connection';
import type { RobinhoodCredentialRepository } from '../../rh-agent-mcp/auth/credential-repository';
import { EnvCredentialRepository } from '../../rh-agent-mcp/auth/env-credential-repository';
import type { RobinhoodCredentialBundle } from '../../rh-agent-mcp/contracts/authentication';
import { stripServerPrefix } from '../../rh-agent-mcp/tools/robinhood-tools';

export interface RobinhoodMcpSessionManagerOptions {
  repository: RobinhoodCredentialRepository;
  transportFactory?: RobinhoodMcpTransportFactory;
  connect?: (
    options: ConnectLocalRobinhoodMcpSessionOptions,
  ) => Promise<ConnectedRobinhoodMcpSession>;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
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
  return (
    Array.isArray(content) &&
    content.length > 0 &&
    isPlainObject(content[0]) &&
    typeof (content[0] as Record<string, unknown>).text === 'string'
  );
}

function parseMcpToolResult(raw: unknown): unknown {
  if (!hasTextContent(raw)) {
    return undefined;
  }
  try {
    return JSON.parse(raw.content![0].text!);
  } catch {
    return undefined;
  }
}

export class RobinhoodMcpSessionManager {
  private connection: ConnectedRobinhoodMcpSession | undefined;

  constructor(private readonly options: RobinhoodMcpSessionManagerOptions) {}

  async connect(): Promise<void> {
    if (this.connection) {
      return;
    }
    const connectFn = this.options.connect ?? connectLocalRobinhoodMcpSession;
    this.connection = await connectFn({
      repository: this.options.repository,
      transportFactory: this.options.transportFactory,
    });
  }

  async callTool(
    name: string,
    args: Record<string, unknown>,
  ): Promise<unknown> {
    await this.connect();
    const result = await this.connection!.session.callTool(
      stripServerPrefix(name),
      args,
    );
    return parseMcpToolResult(result);
  }

  async close(): Promise<void> {
    const connection = this.connection;
    this.connection = undefined;
    if (connection) {
      await connection.close();
    }
  }
}

export async function createRobinhoodMcpSessionManagerFromEnv(): Promise<RobinhoodMcpSessionManager> {
  const bundleJson = process.env.RH_CREDENTIAL_BUNDLE;
  if (!bundleJson) {
    throw new Error('RH_CREDENTIAL_BUNDLE is not set');
  }
  const bundle = JSON.parse(bundleJson) as RobinhoodCredentialBundle;
  return new RobinhoodMcpSessionManager({
    repository: new EnvCredentialRepository(bundle),
  });
}
