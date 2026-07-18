import type { OAuthClientProvider } from '@modelcontextprotocol/sdk/client/auth.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import { ROBINHOOD_TRADING_MCP_URL } from '../contracts/robinhood-mcp';

export type RobinhoodMcpTransportFactory = (
  serverUrl: URL,
  provider: OAuthClientProvider,
) => Transport;

function createRobinhoodTransport(
  serverUrl: URL,
  provider: OAuthClientProvider,
): Transport {
  return new StreamableHTTPClientTransport(serverUrl, { authProvider: provider });
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

    const transport = this.createTransport(
      new URL(ROBINHOOD_TRADING_MCP_URL),
      this.provider,
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

  async listTools(): Promise<number> {
    if (!this.client) {
      throw new McpSessionNotConnectedError();
    }
    const { tools } = await this.client.listTools();
    return tools.length;
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
