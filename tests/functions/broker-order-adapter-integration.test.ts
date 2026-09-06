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
  listOrders,
  getOrder,
} from '../../functions/src/rh-agent-mcp/broker/broker-order-adapter.ts';
import { BrokerAdapterError } from '../../functions/src/rh-agent-mcp/broker/broker-adapter-errors.ts';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const ORDER_FIXTURE = {
  id: 'rh-order-uuid-1',
  ref_id: 'ref-1',
  account_number: '1234567890',
  instrument_id: 'https://api.robinhood.com/instruments/SCHB/',
  symbol: 'SCHB',
  side: 'buy',
  type: 'market',
  state: 'filled',
  quantity: '10',
  cumulative_quantity: '10',
  remaining_quantity: '0',
  average_price: '99.42',
  fees: '0.00',
  time_in_force: 'gfd',
  trigger: 'immediate',
  created_at: '2026-09-04T15:51:00Z',
  last_transaction_at: '2026-09-04T15:51:05Z',
  executions: [{ price: '99.42', quantity: '10' }],
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
// Integration tests with InMemoryTransport
// ---------------------------------------------------------------------------

describe('broker-order-adapter integration', () => {
  it('listOrders normalizes a results array with cursor', async () => {
    const { server, clientTransport, serverTransport } = createServerWithTool('get_equity_orders', {
      results: [ORDER_FIXTURE],
      next: 'https://api.robinhood.com/orders/?cursor=abc123',
    });
    await server.connect(serverTransport);

    try {
      const page = await listOrders('1234567890', {
        executorOptions: {
          transportFactory: () => clientTransport,
          repository: new InMemoryCredentialRepository(createCredential()),
        },
      });

      assert.equal(page.orders.length, 1);
      assert.equal(page.orders[0]!.brokerOrderId, 'rh-order-uuid-1');
      assert.equal(page.orders[0]!.symbol, 'SCHB');
      assert.equal(page.orders[0]!.rawState, 'filled');
      assert.equal(page.nextCursor, 'abc123');
    } finally {
      await server.close();
    }
  });

  it('listOrders normalizes a nested parsed.data.order single response', async () => {
    const { server, clientTransport, serverTransport } = createServerWithTool('get_equity_orders', {
      data: { order: ORDER_FIXTURE },
    });
    await server.connect(serverTransport);

    try {
      const page = await listOrders('1234567890', {
        executorOptions: {
          transportFactory: () => clientTransport,
          repository: new InMemoryCredentialRepository(createCredential()),
        },
      });

      assert.equal(page.orders.length, 1);
      assert.equal(page.orders[0]!.brokerOrderId, 'rh-order-uuid-1');
    } finally {
      await server.close();
    }
  });

  it('listOrders returns empty page for empty results array', async () => {
    const { server, clientTransport, serverTransport } = createServerWithTool('get_equity_orders', {
      results: [],
      next: null,
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

  it('listOrders redacts account_number in rawResponse', async () => {
    const { server, clientTransport, serverTransport } = createServerWithTool('get_equity_orders', {
      data: { order: ORDER_FIXTURE },
    });
    await server.connect(serverTransport);

    try {
      const page = await listOrders('1234567890', {
        executorOptions: {
          transportFactory: () => clientTransport,
          repository: new InMemoryCredentialRepository(createCredential()),
        },
      });

      assert.equal(page.orders.length, 1);
      const raw = page.orders[0]!.rawResponse as Record<string, unknown>;
      // The adapter uses result.redacted, so account_number should be masked
      // in the retained rawResponse, not the full unredacted value.
      const innerOrder = (raw.data as Record<string, unknown>)?.order as Record<string, unknown> | undefined;
      const accountInRaw = innerOrder?.account_number;
      assert.notEqual(accountInRaw, '1234567890');
    } finally {
      await server.close();
    }
  });

  it('listOrders throws BrokerAdapterError on embedded tool error', async () => {
    const { server, clientTransport, serverTransport } = createServerWithTool('get_equity_orders', {
      isError: true,
      error: 'Insufficient buying power',
    });
    await server.connect(serverTransport);

    try {
      await assert.rejects(
        listOrders('1234567890', {
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

  it('listOrders throws BrokerAdapterError on nested tool error with message', async () => {
    const { server, clientTransport, serverTransport } = createServerWithTool('get_equity_orders', {
      data: { isError: true, error: 'Position not found' },
    });
    await server.connect(serverTransport);

    try {
      await assert.rejects(
        listOrders('1234567890', {
          executorOptions: {
            transportFactory: () => clientTransport,
            repository: new InMemoryCredentialRepository(createCredential()),
          },
        }),
        (err: unknown) => {
          assert.ok(err instanceof BrokerAdapterError);
          assert.ok(err.message.includes('Position not found'));
          return true;
        },
      );
    } finally {
      await server.close();
    }
  });

  it('getOrder returns a single order by broker order ID', async () => {
    const { server, clientTransport, serverTransport } = createServerWithTool('get_equity_orders', {
      data: { order: ORDER_FIXTURE },
    });
    await server.connect(serverTransport);

    try {
      const order = await getOrder('1234567890', 'rh-order-uuid-1', {
        executorOptions: {
          transportFactory: () => clientTransport,
          repository: new InMemoryCredentialRepository(createCredential()),
        },
      });

      assert.ok(order);
      assert.equal(order!.brokerOrderId, 'rh-order-uuid-1');
      assert.equal(order!.symbol, 'SCHB');
    } finally {
      await server.close();
    }
  });

  it('getOrder returns null for unrecognized response', async () => {
    const { server, clientTransport, serverTransport } = createServerWithTool('get_equity_orders', {
      unrelated: true,
    });
    await server.connect(serverTransport);

    try {
      const order = await getOrder('1234567890', 'nonexistent', {
        executorOptions: {
          transportFactory: () => clientTransport,
          repository: new InMemoryCredentialRepository(createCredential()),
        },
      });

      assert.equal(order, null);
    } finally {
      await server.close();
    }
  });

});
