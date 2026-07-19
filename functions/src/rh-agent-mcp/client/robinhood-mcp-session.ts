import type { OAuthClientProvider } from '@modelcontextprotocol/sdk/client/auth.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import { ROBINHOOD_TRADING_MCP_URL } from '../contracts/robinhood-mcp';

export type McpToolDefinition = Awaited<ReturnType<Client['listTools']>>['tools'][number];
export type McpToolResult = Awaited<ReturnType<Client['callTool']>>;

export type RobinhoodMcpTransportFactory = (
  serverUrl: URL,
  accessToken: string,
) => Transport;

function createRobinhoodTransport(
  serverUrl: URL,
  accessToken: string,
): Transport {
  return new StreamableHTTPClientTransport(serverUrl, {
    requestInit: {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    },
  });
}

export class McpSessionNotConnectedError extends Error {
  override name = 'McpSessionNotConnectedError';
}

export class RobinhoodMcpSession {
  private client: Client | undefined;
  private transport: Transport | undefined;

  constructor(
    private readonly provider: OAuthClientProvider,
    private readonly createTransport: RobinhoodMcpTransportFactory = createRobinhoodTransport,
  ) {}

  async connect(): Promise<void> {
    if (this.client) {
      return;
    }

    const tokens = await this.provider.tokens();
    if (!tokens?.access_token) {
      throw new McpSessionNotConnectedError();
    }
    const transport = this.createTransport(
      new URL(ROBINHOOD_TRADING_MCP_URL),
      tokens.access_token,
    );
    const client = new Client(
      { name: 'rh-agent-mcp', version: '1.0.0' },
      { capabilities: {} },
    );
    this.transport = transport;
    this.client = client;

    try {
      await client.connect(transport);
    } catch (error) {
      this.client = undefined;
      this.transport = undefined;
      await transport.close().catch(() => undefined);
      throw error;
    }
  }

  async getToolDefinitions(): Promise<McpToolDefinition[]> {
    if (!this.client) {
      throw new McpSessionNotConnectedError();
    }
    const { tools } = await this.client.listTools();
    return tools;
  }

  async callTool(
    name: string,
    args: Record<string, unknown>,
  ): Promise<McpToolResult> {
    if (!this.client) {
      throw new McpSessionNotConnectedError();
    }
    return await this.client.callTool({ name, arguments: args });
  }

  async close(): Promise<void> {
    const client = this.client;
    const transport = this.transport;
    this.client = undefined;
    this.transport = undefined;

    if (client) {
      await client.close();
      return;
    }
    await transport?.close();
  }
}
