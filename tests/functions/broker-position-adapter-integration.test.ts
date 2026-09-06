import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { InMemoryTransport } from '../../functions/node_modules/@modelcontextprotocol/sdk/dist/esm/inMemory.js';
import { McpServer } from '../../functions/node_modules/@modelcontextprotocol/sdk/dist/esm/server/mcp.js';
import type { RobinhoodCredentialBundle } from '../../functions/src/rh-agent-mcp/index';
import {
  FULL_DISCOVERY_STATE,
  InMemoryCredentialRepository,
} from './rh-agent-mcp-token-refresh-fixtures';
import {
  listPositions,
  listOrders,
} from '../../functions/src/rh-agent-mcp/broker/broker-order-adapter.ts';
import { BrokerAdapterError } from '../../functions/src/rh-agent-mcp/broker/broker-adapter-errors.ts';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const POSITION_FIXTURE = {
  account_number: '1234567890',
  symbol: 'SCHB',
  instrument_id: 'https://api.robinhood.com/instruments/SCHB/',
  quantity: '10.5',
  intraday_quantity: '0',
  average_buy_price: '99.42',
  shares_held_for_sells: '0',
  shares_available_for_sells: '10.5',
  position_type: 'long',
  updated_at: '2026-09-04T16:00:00Z',
};

function createCredential(): RobinhoodCredentialBundle {
  return {
    schemaVersion: 1,
    revision: 1,
    tokens: {
      access_token: 'synthetic-access-token',
      refresh_token: 'synthetic-refresh-token',
      expires_in: 3600,
      token_type: 'Bearer',
    },
    clientInformation: { client_id: 'synthetic-client' },
    discoveryState: FULL_DISCOVERY_STATE,
    lastTokenResponseAt: new Date().toISOString(),
  };
}

function createServerWithTool(
  toolName: string,
  response: unknown,
): { server: McpServer; clientTransport: InMemoryTransport; serverTransport: InMemoryTransport } {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const server = new McpServer({ name: 'synthetic-server', version: '1.0.0' });
  server.registerTool(toolName, {}, async () => ({
    content: [{ type: 'text', text: JSON.stringify(response) }],
  }));
  return { server, clientTransport, serverTransport };
}

// ---------------------------------------------------------------------------
// Position adapter integration tests
// ---------------------------------------------------------------------------

describe('broker-position-adapter integration', () => {
  it('listPositions normalizes a results array', async () => {
    const { server, clientTransport, serverTransport } = createServerWithTool('get_equity_positions', {
      results: [POSITION_FIXTURE],
      next: null,
    });
    await server.connect(serverTransport);

    try {
      const page = await listPositions('1234567890', {
        executorOptions: {
          transportFactory: () => clientTransport,
          repository: new InMemoryCredentialRepository(createCredential()),
        },
      });

      assert.equal(page.positions.length, 1);
      assert.equal(page.positions[0]!.symbol, 'SCHB');
      assert.equal(page.positions[0]!.quantity, '10.5');
      assert.equal(page.nextCursor, undefined);
    } finally {
      await server.close();
    }
  });

  it('listPositions throws BrokerAdapterError on embedded tool error', async () => {
    const { server, clientTransport, serverTransport } = createServerWithTool('get_equity_positions', {
      isError: true,
      error: 'Position unavailable',
    });
    await server.connect(serverTransport);

    try {
      await assert.rejects(
        listPositions('1234567890', {
          executorOptions: {
            transportFactory: () => clientTransport,
            repository: new InMemoryCredentialRepository(createCredential()),
          },
        }),
        BrokerAdapterError,
      );
    } finally {
      await server.close();
    }
  });

  it('listOrders returns empty page when MCP tool throws internally', async () => {
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const server = new McpServer({ name: 'synthetic-server', version: '1.0.0' });
    server.registerTool('get_equity_orders', {}, async () => {
      throw new Error('Connection refused');
    });
    await server.connect(serverTransport);

    try {
      const page = await listOrders('1234567890', {
        executorOptions: {
          transportFactory: () => clientTransport,
          repository: new InMemoryCredentialRepository(createCredential()),
        },
      });
      assert.equal(page.orders.length, 0);
    } finally {
      await server.close();
    }
  });

  it('listOrders times out and throws BrokerAdapterError with TIMEOUT category', async () => {
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const server = new McpServer({ name: 'synthetic-server', version: '1.0.0' });
    server.registerTool('get_equity_orders', {}, async () => {
      return new Promise(() => {
        // Never resolves — simulates a hung MCP server
      });
    });
    await server.connect(serverTransport);

    try {
      await assert.rejects(
        listOrders('1234567890', {
          timeoutMs: 50,
          executorOptions: {
            transportFactory: () => clientTransport,
            repository: new InMemoryCredentialRepository(createCredential()),
          },
        }),
        (err: unknown) => {
          assert.ok(err instanceof BrokerAdapterError);
          assert.equal(err.category, 'TIMEOUT');
          assert.ok(err.message.includes('timed out'));
          return true;
        },
      );
    } finally {
      await server.close();
    }
  });
});
