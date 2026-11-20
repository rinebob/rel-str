/**
 *
 * Robinhood MCP session manager for a single Cloud Function invocation.
 *
 * Opens one MCP session lazily, reuses it across tool calls, and closes it
 * when the function returns. Production consumers use the KMS+Firestore
 * credential repository (`rh-agent-credentials/bundle`) so a rotated
 * refresh grant persists across instances.
 */

import { type RobinhoodMcpTransportFactory } from '../../rh-agent-mcp/client/robinhood-mcp-session';
import {
  connectLocalRobinhoodMcpSession,
  type ConnectedRobinhoodMcpSession,
  type ConnectLocalRobinhoodMcpSessionOptions,
} from '../../rh-agent-mcp/auth/robinhood-mcp-connection';
import type { RobinhoodCredentialRepository } from '../../rh-agent-mcp/auth/credential-repository';
import { createKmsCredentialRepository } from '../../rh-agent-mcp/auth/production-credential-repository';
import { stripServerPrefix } from '../../rh-agent-mcp/tools/robinhood-tools';
import { isPlainObject } from '@robinhood-mcp/utils';

export interface RobinhoodMcpSessionManagerOptions {
  repository: RobinhoodCredentialRepository;
  transportFactory?: RobinhoodMcpTransportFactory;
  connect?: (
    options: ConnectLocalRobinhoodMcpSessionOptions,
  ) => Promise<ConnectedRobinhoodMcpSession>;
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

/**
 * Production factory (#1639): the KMS+Firestore repository every deployed
 * pass shares. A refresh that rotates the grant stores the new bundle
 * transactionally — the next instance to cold-start loads it instead of a
 * stale secret copy. Overrides exist for tests only — when overriding
 * `connect`, pass `repository` too or the real KMS repo is still
 * constructed (and throws without RH_CREDENTIAL_KEY_NAME).
 */
export async function createRobinhoodMcpSessionManagerFromKms(
  options: Partial<RobinhoodMcpSessionManagerOptions> = {},
): Promise<RobinhoodMcpSessionManager> {
  return new RobinhoodMcpSessionManager({
    transportFactory: options.transportFactory,
    connect: options.connect,
    repository: options.repository ?? createKmsCredentialRepository(),
  });
}
