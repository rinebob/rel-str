import assert from 'node:assert/strict';
import http from 'node:http';
import { describe, it, before, after } from 'node:test';
import type { AddressInfo } from 'node:net';
import { InMemoryTransport } from '../../functions/node_modules/@modelcontextprotocol/sdk/dist/esm/inMemory.js';
import { McpServer } from '../../functions/node_modules/@modelcontextprotocol/sdk/dist/esm/server/mcp.js';
import {
  createRhApiHandler,
  type RhApiAuthRejectEntry,
} from '../../functions/src/rh-agent-mcp/cloud-api/rh-api';
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
const bearer = (token = 'good-token') => ({ authorization: `Bearer ${token}` });

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

type AuditEntry = RhApiAuditEntry;

describe('rhApi cloud request handler', () => {
  let server: http.Server;
  let baseUrl: string;
  let mcpServer: McpServer;
  let expressHandler: (req: http.IncomingMessage, res: http.ServerResponse) => Promise<void>;
  const auditLog: AuditEntry[] = [];
  const rejectLog: RhApiAuthRejectEntry[] = [];

  before(async () => {
    mcpServer = new McpServer({ name: 'synthetic-server', version: '1.0.0' });
    mcpServer.registerTool('get_accounts', {}, async () => ({
      content: [{ type: 'text', text: JSON.stringify([{ account_number: '1234567890', type: 'margin' }]) }],
    }));
    mcpServer.registerTool('place_equity_order', {}, async () => ({
      content: [{ type: 'text', text: JSON.stringify({ id: 'order-1' }) }],
    }));

    const handler = createRhApiHandler({
      verifyIdToken: async (token) => {
        if (token === 'good-token') return { uid: OWNER };
        if (token === 'other-user') return { uid: 'not-the-owner' };
        throw new Error('invalid token');
      },
      ownerUid: OWNER,
      repository: new InMemoryCredentialRepository(credential()),
      // Each execute opens a fresh session — a fresh linked pair per call,
      // matching how production creates a new transport per connect.
      transportFactory: () => {
        const [client, serverSide] = InMemoryTransport.createLinkedPair();
        void mcpServer.connect(serverSide);
        return client;
      },
      onAudit: (entry) => auditLog.push(entry),
      onAuditReject: (entry) => rejectLog.push(entry),
    });
    expressHandler = handler;

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

  it('401 when Authorization header is missing', async () => {
    const { status, body } = await request(`${baseUrl}/api/rh/tools`);
    assert.equal(status, 401);
    assert.equal((body as { success: boolean }).success, false);
  });

  it('401 when the token fails verification', async () => {
    const { status } = await request(`${baseUrl}/api/rh/tools`, {
      headers: bearer('bad-token'),
    });
    assert.equal(status, 401);
  });

  it('403 when the token is valid but not the owner', async () => {
    const { status } = await request(`${baseUrl}/api/rh/tools`, {
      headers: bearer('other-user'),
    });
    assert.equal(status, 403);
  });

  it('lists tools for the owner', async () => {
    const { status, body } = await request(`${baseUrl}/api/rh/tools`, {
      headers: bearer(),
    });
    const typed = body as { success: boolean; tools: unknown[] };
    assert.equal(status, 200);
    assert.equal(typed.success, true);
    assert.ok(typed.tools.length > 0);
  });

  it('executes a read tool through shared dispatch with the injected repository', async () => {
    const { status, body } = await request(
      `${baseUrl}/api/rh/tools/get_accounts`,
      { method: 'POST', headers: bearer() },
      {},
    );
    const typed = body as { success: boolean; parsed: unknown; redacted: unknown };
    assert.equal(status, 200);
    assert.equal(typed.success, true);
    assert.ok(Array.isArray(typed.parsed));
    const redacted = typed.redacted as Array<Record<string, unknown>>;
    assert.equal(redacted[0].account_number, '••••7890');
  });

  it('mutation tools pass the same auth path as reads', async () => {
    // Bad args → structured VALIDATION failure from shared dispatch (not an
    // auth/route rejection), proving the mutation reached the same executor.
    const { status, body } = await request(
      `${baseUrl}/api/rh/tools/place_equity_order`,
      { method: 'POST', headers: bearer() },
      {},
    );
    const typed = body as { success: boolean; category?: string };
    assert.equal(status, 200);
    assert.equal(typed.success, false);
    assert.equal(typed.category, 'VALIDATION');
  });

  it('401 on a mutation tool without a token — auth runs before dispatch', async () => {
    const { status } = await request(
      `${baseUrl}/api/rh/tools/place_equity_order`,
      { method: 'POST' },
      {},
    );
    assert.equal(status, 401);
  });

  it('reauth returns structured REAUTHORIZATION_REQUIRED, never interactive', async () => {
    const { status, body } = await request(
      `${baseUrl}/api/rh/auth/reauth`,
      { method: 'POST', headers: bearer() },
      {},
    );
    const typed = body as { success: boolean; state: string };
    assert.equal(status, 200);
    assert.equal(typed.success, false);
    assert.equal(typed.state, 'REAUTHORIZATION_REQUIRED');
  });

  it('400 on a JSON "null" body rather than a 500', async () => {
    const { status, body } = await request(
      `${baseUrl}/api/rh/tools/get_accounts`,
      { method: 'POST', headers: bearer() },
      'null',
    );
    assert.equal(status, 400);
    assert.equal((body as { success: boolean }).success, false);
  });

  it('404 for unknown paths (authed)', async () => {
    const { status } = await request(`${baseUrl}/api/rh/unknown`, {
      headers: bearer(),
    });
    assert.equal(status, 404);
  });

  it('audit hook fires per tool call with tool/category/outcome — never args', async () => {
    auditLog.length = 0;
    await request(
      `${baseUrl}/api/rh/tools/get_accounts`,
      { method: 'POST', headers: bearer() },
      { extraRedactFields: ['SECRET-REDACT-FIELD'] },
    );
    assert.equal(auditLog.length, 1);
    assert.equal(auditLog[0].tool, 'get_accounts');
    assert.equal(auditLog[0].category, 'Account & Performance');
    assert.equal(auditLog[0].outcome, 'success');
    assert.ok(!JSON.stringify(auditLog).includes('SECRET-REDACT-FIELD'));
  });

  it('auth rejections are audit-logged by reason — never token material', async () => {
    rejectLog.length = 0;
    await request(`${baseUrl}/api/rh/tools`);
    await request(`${baseUrl}/api/rh/tools`, { headers: bearer('bad-token') });
    await request(`${baseUrl}/api/rh/tools`, { headers: bearer('other-user') });
    assert.deepEqual(
      rejectLog.map((e) => e.reason),
      ['missing_token', 'invalid_token', 'non_owner'],
    );
    assert.equal(rejectLog[2].uid, 'not-the-owner');
    assert.ok(!JSON.stringify(rejectLog).includes('bad-token'));
    assert.ok(!JSON.stringify(rejectLog).includes('other-user'));
  });

  it('uses req.body when the framework pre-parsed it (express/onRequest) — no stream hang', async () => {
    // Simulate Functions Framework: body already parsed, stream drained.
    const expressish = http.createServer((req, res) => {
      (req as http.IncomingMessage & { body?: unknown }).body = {};
      void expressHandler(req, res);
    });
    await new Promise<void>((resolve) => {
      expressish.listen(0, '127.0.0.1', resolve);
    });
    const port = (expressish.address() as AddressInfo).port;
    try {
      // No wire body at all — if the handler tried to stream-read it, the
      // empty body would 400; using req.body must succeed.
      const { status, body } = await request(
        `http://127.0.0.1:${port}/api/rh/tools/get_accounts`,
        { method: 'POST', headers: bearer() },
      );
      assert.equal(status, 200);
      assert.equal((body as { success: boolean }).success, true);
    } finally {
      expressish.close();
    }
  });
});
