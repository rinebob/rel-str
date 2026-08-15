/** @topic #114 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { ConnectedRobinhoodMcpSession } from '../../../functions/src/rh-agent-mcp/auth/robinhood-mcp-connection';
import {
  RobinhoodMcpSessionManager,
  createRobinhoodMcpSessionManagerFromEnv,
} from '../../../functions/src/options-strategy-engine/mcp/robinhood-mcp-session-manager';

function makeFakeConnection(
  responses: unknown[] = [],
): { connection: ConnectedRobinhoodMcpSession; calls: unknown[]; closed: boolean } {
  const calls: unknown[] = [];
  let callIndex = 0;
  const closed = { value: false };
  const connection: ConnectedRobinhoodMcpSession = {
    session: {
      callTool: async (name: string, args: Record<string, unknown>) => {
        calls.push({ name, args });
        const response = responses[callIndex++] ?? { content: [{ type: 'text', text: '{}' }] };
        return response as { content: Array<{ type: string; text?: string }> };
      },
    },
    close: async () => {
      closed.value = true;
    },
  } as unknown as ConnectedRobinhoodMcpSession;
  return { connection, calls, closed: closed.value };
}

function makeManager(connection: ConnectedRobinhoodMcpSession): RobinhoodMcpSessionManager {
  let connectCount = 0;
  const manager = new RobinhoodMcpSessionManager({
    repository: {
      load: async () => null,
      store: async () => {
        throw new Error('read-only');
      },
      delete: async () => {},
    },
    connect: async () => {
      connectCount++;
      return connection;
    },
  });
  return manager;
}

describe('RobinhoodMcpSessionManager', () => {
  it('opens one connection and reuses it across multiple callTool calls', async () => {
    const { connection, calls } = makeFakeConnection([
      { content: [{ type: 'text', text: JSON.stringify({ ok: true, n: 1 }) }] },
      { content: [{ type: 'text', text: JSON.stringify({ ok: true, n: 2 }) }] },
    ]);
    let connectCount = 0;
    const manager = new RobinhoodMcpSessionManager({
      repository: {
        load: async () => null,
        store: async () => {
          throw new Error('read-only');
        },
        delete: async () => {},
      },
      connect: async () => {
        connectCount++;
        return connection;
      },
    });

    const first = await manager.callTool('mcp__robinhood-trading__test_tool', { a: 1 });
    const second = await manager.callTool('test_tool', { a: 2 });

    assert.equal(connectCount, 1);
    assert.deepEqual(first, { ok: true, n: 1 });
    assert.deepEqual(second, { ok: true, n: 2 });
    assert.equal(calls.length, 2);
    assert.equal((calls[0] as { name: string }).name, 'test_tool');
    assert.deepEqual((calls[0] as { args: unknown }).args, { a: 1 });
    assert.equal((calls[1] as { name: string }).name, 'test_tool');
    assert.deepEqual((calls[1] as { args: unknown }).args, { a: 2 });
  });

  it('closes the connection on close and reconnects on the next call', async () => {
    const { connection, closed } = makeFakeConnection();
    let connectCount = 0;
    let closedCount = 0;
    const manager = new RobinhoodMcpSessionManager({
      repository: {
        load: async () => null,
        store: async () => {
          throw new Error('read-only');
        },
        delete: async () => {},
      },
      connect: async () => {
        connectCount++;
        const conn = makeFakeConnection().connection;
        conn.close = async () => {
          closedCount++;
        };
        return conn;
      },
    });

    await manager.callTool('test', {});
    assert.equal(connectCount, 1);
    await manager.close();
    assert.equal(closedCount, 1);
    await manager.callTool('test', {});
    assert.equal(connectCount, 2);
  });

  it('returns undefined for a result with no text content', async () => {
    const { connection } = makeFakeConnection([{ content: [] }]);
    const manager = makeManager(connection);
    const result = await manager.callTool('test', {});
    assert.equal(result, undefined);
  });

  it('strips the mcp__robinhood-trading__ prefix from tool names', async () => {
    const { connection, calls } = makeFakeConnection([
      { content: [{ type: 'text', text: '{}' }] },
    ]);
    const manager = makeManager(connection);
    await manager.callTool('mcp__robinhood-trading__get_option_quotes', {
      instrument_ids: ['abc'],
    });
    assert.equal(calls.length, 1);
    assert.deepEqual(calls[0], {
      name: 'get_option_quotes',
      args: { instrument_ids: ['abc'] },
    });
  });

  it('surfaces connection errors from the connect factory', async () => {
    const manager = new RobinhoodMcpSessionManager({
      repository: {
        load: async () => null,
        store: async () => {
          throw new Error('read-only');
        },
        delete: async () => {},
      },
      connect: async () => {
        throw new Error('connection refused');
      },
    });

    await assert.rejects(
      () => manager.callTool('test', {}),
      /connection refused/,
    );
  });
});
