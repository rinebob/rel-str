import assert from 'node:assert/strict';
import http from 'node:http';
import { describe, it, before, after } from 'node:test';
import type { AddressInfo } from 'node:net';
import { InMemoryTransport } from '../../functions/node_modules/@modelcontextprotocol/sdk/dist/esm/inMemory.js';
import { McpServer } from '../../functions/node_modules/@modelcontextprotocol/sdk/dist/esm/server/mcp.js';
import { createRhApiHandler } from '../../functions/src/rh-agent-mcp/cloud-api/rh-api';
import type { RhApiAuditEntry } from '../../functions/src/rh-agent-mcp/api-shared/rh-api-routes';
import type { RobinhoodCredentialBundle } from '../../functions/src/rh-agent-mcp/index';
import {
  FULL_DISCOVERY_STATE,
  InMemoryCredentialRepository,
} from './rh-agent-mcp-token-refresh-fixtures';

interface ResponseResult {
  status: number;
  body: unknown;
}

function request(
  url: string,
  options: { method?: string; headers?: Record<string, string> } = {},
  payload?: unknown,
): Promise<ResponseResult> {
  return new Promise((resolve, reject) => {
    const req = http.request(
      url,
      {
        method: options.method ?? 'GET',
        headers: { 'content-type': 'application/json', ...options.headers },
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk) => chunks.push(chunk));
        res.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf-8');
          let body: unknown = text;
          try {
            body = JSON.parse(text);
          } catch {
            // leave as raw text
          }
          resolve({ status: res.statusCode ?? 0, body });
        });
      },
    );
    req.on('error', reject);
    if (payload !== undefined) {
      req.write(typeof payload === 'string' ? payload : JSON.stringify(payload));
    }
    req.end();
  });
}

const OWNER = 'owner-uid-123';
const bearer = () => ({ authorization: 'Bearer good-token' });

function credential(): RobinhoodCredentialBundle {
  return {
    schemaVersion: 1,
    revision: 1,
    tokens: {
      access_token: 'synthetic-access-token',
      refresh_token: 'synthetic-refresh-token',
      expires_in: 86400,
      token_type: 'Bearer',
    },
    clientInformation: { client_id: 'synthetic-client' },
    discoveryState: FULL_DISCOVERY_STATE,
    lastTokenResponseAt: new Date().toISOString(),
  };
}

interface BatchItem {
  success: boolean;
  tool?: string;
  parsed?: unknown;
  error?: string;
  category?: string;
}

function batchBody(body: unknown): { success: boolean; results: BatchItem[] } {
  return body as { success: boolean; results: BatchItem[] };
}

describe('rhApi batch endpoint', () => {
  let server: http.Server;
  let baseUrl: string;
  let mcpServer: McpServer;
  let transportCount: number;
  const auditLog: RhApiAuditEntry[] = [];

  before(async () => {
    transportCount = 0;
    mcpServer = new McpServer({ name: 'synthetic-server', version: '1.0.0' });
    mcpServer.registerTool('get_accounts', {}, async () => ({
      content: [
        {
          type: 'text',
          text: JSON.stringify([{ account_number: '1234567890', type: 'margin' }]),
        },
      ],
    }));
    // 'get_pnl_trade_history' is intentionally NOT registered — callTool on
    // it yields an MCP-level error, exercising per-item failure isolation.

    const handler = createRhApiHandler({
      verifyIdToken: async () => ({ uid: OWNER }),
      ownerUid: OWNER,
      repository: new InMemoryCredentialRepository(credential()),
      transportFactory: () => {
        transportCount += 1;
        const [client, serverSide] = InMemoryTransport.createLinkedPair();
        void mcpServer.connect(serverSide);
        return client;
      },
      onAudit: (entry) => auditLog.push(entry),
    });

    server = http.createServer((req, res) => void handler(req, res));
    await new Promise<void>((resolve) => {
      server.listen(0, '127.0.0.1', () => {
        baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
        resolve();
      });
    });
  });

  after(async () => {
    await new Promise<void>((resolve, reject) =>
      server.close((e) => (e ? reject(e) : resolve())),
    );
    await mcpServer.close();
  });

  const post = (payload?: unknown) =>
    request(`${baseUrl}/api/rh/batch`, { method: 'POST', headers: bearer() }, payload);

  it('400 on empty calls', async () => {
    const { status } = await post({ calls: [] });
    assert.equal(status, 400);
  });

  it('400 on missing/non-array calls', async () => {
    assert.equal((await post({})).status, 400);
    assert.equal((await post({ calls: 'nope' })).status, 400);
  });

  it('400 on more than 20 calls', async () => {
    const calls = Array.from({ length: 21 }, () => ({ tool: 'get_accounts' }));
    const { status } = await post({ calls });
    assert.equal(status, 400);
  });

  it('400 on malformed items (missing/non-string tool)', async () => {
    assert.equal((await post({ calls: [{}] })).status, 400);
    assert.equal((await post({ calls: [{ tool: 42 }] })).status, 400);
  });

  it('runs every call on ONE session, ordered results, mixed success/error', async () => {
    transportCount = 0;
    const { status, body } = await post({
      calls: [
        { tool: 'get_accounts' },
        { tool: 'not_a_tool' }, // VALIDATION failure — batch continues
        { tool: 'get_pnl_trade_history' }, // unregistered — MCP error, batch continues
        { tool: 'get_accounts' },
      ],
    });
    assert.equal(status, 200);
    const batch = batchBody(body);
    assert.equal(batch.success, true);
    assert.equal(batch.results.length, 4);

    assert.equal(batch.results[0].success, true);
    assert.equal(batch.results[0].tool, 'get_accounts');
    assert.ok(Array.isArray(batch.results[0].parsed));

    assert.equal(batch.results[1].success, false);
    assert.equal(batch.results[1].category, 'VALIDATION');
    // Failure entries still self-describe — no index correlation needed.
    assert.equal(batch.results[1].tool, 'not_a_tool');
    assert.equal(batch.results[2].tool, 'get_pnl_trade_history');

    assert.equal(batch.results[2].success, false); // MCP-level error, not a batch abort

    assert.equal(batch.results[3].success, true); // tail still ran

    // The whole batch executed over one connect — not one per call.
    assert.equal(transportCount, 1);
  });

  it('per-item arg-shape failure is isolated (VALIDATION item, siblings run)', async () => {
    const { status, body } = await post({
      calls: [
        { tool: 'get_accounts' },
        { tool: 'get_accounts', args: 'not-an-object' },
        { tool: 'get_accounts' },
      ],
    });
    assert.equal(status, 200);
    const batch = batchBody(body);
    assert.equal(batch.success, true);
    assert.equal(batch.results.length, 3);
    assert.equal(batch.results[0].success, true);
    assert.equal(batch.results[1].success, false);
    assert.equal(batch.results[1].category, 'VALIDATION');
    assert.equal(batch.results[1].tool, 'get_accounts');
    assert.match(batch.results[1].error ?? '', /JSON object/);
    assert.equal(batch.results[2].success, true);
  });

  it('audits each call, never args', async () => {
    auditLog.length = 0;
    await post({
      calls: [
        { tool: 'get_accounts', args: { SECRET_ARG: 'x' } },
        { tool: 'not_a_tool' },
      ],
    });
    assert.equal(auditLog.length, 2);
    assert.equal(auditLog[0].outcome, 'success');
    assert.equal(auditLog[1].outcome, 'failure');
    assert.ok(!JSON.stringify(auditLog).includes('SECRET_ARG'));
  });

  it('a session-connect failure returns a failure envelope, audits each call', async () => {
    const failures: RhApiAuditEntry[] = [];
    const handler = createRhApiHandler({
      verifyIdToken: async () => ({ uid: OWNER }),
      ownerUid: OWNER,
      repository: new InMemoryCredentialRepository(credential()),
      transportFactory: () => {
        throw new Error('transport exploded');
      },
      onAudit: (entry) => failures.push(entry),
    });
    const srv = http.createServer((req, res) => void handler(req, res));
    await new Promise<void>((resolve) => srv.listen(0, '127.0.0.1', resolve));
    const port = (srv.address() as AddressInfo).port;
    try {
      const { status, body } = await request(
        `http://127.0.0.1:${port}/api/rh/batch`,
        { method: 'POST', headers: bearer() },
        { calls: [{ tool: 'get_accounts' }, { tool: 'get_equity_positions' }] },
      );
      assert.equal(status, 200);
      const envelope = body as { success: boolean; category?: string };
      assert.equal(envelope.success, false);
      assert.equal(envelope.category, 'MCP');
      assert.equal(failures.length, 2);
      assert.ok(failures.every((f) => f.outcome === 'failure'));
    } finally {
      await new Promise<void>((r) => srv.close(() => r()));
    }
  });

  it('the batch deadline leaves undispatched calls as failures, not a host kill', async () => {
    const slowServer = new McpServer({ name: 'slow', version: '1.0.0' });
    slowServer.registerTool('get_accounts', {}, async () => {
      await new Promise((r) => setTimeout(r, 80));
      return { content: [{ type: 'text', text: JSON.stringify([]) }] };
    });
    const handler = createRhApiHandler({
      verifyIdToken: async () => ({ uid: OWNER }),
      ownerUid: OWNER,
      repository: new InMemoryCredentialRepository(credential()),
      transportFactory: () => {
        const [client, serverSide] = InMemoryTransport.createLinkedPair();
        void slowServer.connect(serverSide);
        return client;
      },
      batchBudgetMs: 40,
    });
    const srv = http.createServer((req, res) => void handler(req, res));
    await new Promise<void>((resolve) => srv.listen(0, '127.0.0.1', resolve));
    const port = (srv.address() as AddressInfo).port;
    try {
      const { status, body } = await request(
        `http://127.0.0.1:${port}/api/rh/batch`,
        { method: 'POST', headers: bearer() },
        {
          calls: [
            { tool: 'get_accounts' }, // dispatched before the deadline, ~80ms
            { tool: 'get_accounts' }, // budget exhausted → not dispatched
            { tool: 'get_accounts' },
          ],
        },
      );
      assert.equal(status, 200);
      const batch = batchBody(body);
      assert.equal(batch.success, true);
      assert.equal(batch.results.length, 3);
      // Item 0 dispatched but its timeout was clamped to the ~40ms
      // remaining budget — the 80ms call can't finish inside it.
      assert.equal(batch.results[0].success, false);
      assert.match(batch.results[0].error ?? '', /timed out/);
      assert.equal(batch.results[1].success, false);
      assert.match(batch.results[1].error ?? '', /budget/i);
      assert.equal(batch.results[1].tool, 'get_accounts');
      assert.equal(batch.results[2].success, false);
    } finally {
      await new Promise<void>((r) => srv.close(() => r()));
      await slowServer.close();
    }
  });

  it('a per-call MCP timeout fails that item only — the session survives', async () => {
    const flakyServer = new McpServer({ name: 'flaky', version: '1.0.0' });
    let callCount = 0;
    flakyServer.registerTool('get_accounts', {}, async () => {
      callCount += 1;
      if (callCount === 1) {
        await new Promise((r) => setTimeout(r, 80));
      }
      return { content: [{ type: 'text', text: JSON.stringify([]) }] };
    });
    const handler = createRhApiHandler({
      verifyIdToken: async () => ({ uid: OWNER }),
      ownerUid: OWNER,
      repository: new InMemoryCredentialRepository(credential()),
      transportFactory: () => {
        const [client, serverSide] = InMemoryTransport.createLinkedPair();
        void flakyServer.connect(serverSide);
        return client;
      },
      callTimeoutMs: 30,
    });
    const srv = http.createServer((req, res) => void handler(req, res));
    await new Promise<void>((resolve) => srv.listen(0, '127.0.0.1', resolve));
    const port = (srv.address() as AddressInfo).port;
    try {
      const { status, body } = await request(
        `http://127.0.0.1:${port}/api/rh/batch`,
        { method: 'POST', headers: bearer() },
        { calls: [{ tool: 'get_accounts' }, { tool: 'get_accounts' }] },
      );
      assert.equal(status, 200);
      const batch = batchBody(body);
      assert.equal(batch.results[0].success, false);
      assert.match(batch.results[0].error ?? '', /timed out/);
      // The timed-out call didn't poison the shared session.
      assert.equal(batch.results[1].success, true);
      assert.equal(callCount, 2);
    } finally {
      await new Promise<void>((r) => srv.close(() => r()));
      await flakyServer.close();
    }
  });

  it('401 without a token — auth runs before dispatch', async () => {
    const { status } = await request(`${baseUrl}/api/rh/batch`, { method: 'POST' }, { calls: [] });
    assert.equal(status, 401);
  });
});
