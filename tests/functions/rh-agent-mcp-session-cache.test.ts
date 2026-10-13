// Session cache tests (#808) — warm MCP session reuse across requests on a
// single rhApi instance: token-matched reuse, reconnect-once on session
// failure, token-rotation rebuild, and concurrent callTool multiplexing over
// one StreamableHTTP transport (JSON-RPC id correlation).
import assert from 'node:assert/strict';
import http from 'node:http';
import { describe, it, before, after } from 'node:test';
import type { AddressInfo } from 'node:net';
import { InMemoryTransport } from '../../functions/node_modules/@modelcontextprotocol/sdk/dist/esm/inMemory.js';
import { McpServer } from '../../functions/node_modules/@modelcontextprotocol/sdk/dist/esm/server/mcp.js';
import type { Transport } from '../../functions/node_modules/@modelcontextprotocol/sdk/dist/esm/shared/transport.js';
import { createRhApiHandler } from '../../functions/src/rh-agent-mcp/cloud-api/rh-api';
import { RobinhoodMcpSessionCache } from '../../functions/src/rh-agent-mcp/cloud-api/rh-session-cache';
import { connectLocalRobinhoodMcpSession } from '../../functions/src/rh-agent-mcp/auth/robinhood-mcp-connection';
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

function credential(accessToken = 'synthetic-access-token'): RobinhoodCredentialBundle {
  return {
    schemaVersion: 1,
    revision: 1,
    tokens: {
      access_token: accessToken,
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
  error?: string;
  category?: string;
}
interface BatchBody {
  success: boolean;
  results?: BatchItem[];
  error?: string;
  category?: string;
}
function batchBody(body: unknown): BatchBody {
  assert.equal(typeof body, 'object');
  return body as BatchBody;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

describe('rhApi session cache (#808)', () => {
  let server: http.Server;
  let mcpServer: McpServer;
  let baseUrl: string;
  let transportCount: number;
  let serverTransports: Transport[];
  let repository: InMemoryCredentialRepository;
  // Server-side concurrency probe — records the peak number of tool handlers
  // in flight simultaneously on the shared MCP connection. Only armed during
  // the multiplexing test; other tests take the fast path.
  let inFlight: number;
  let maxInFlight: number;
  let probeArmed: boolean;
  let inFlightGate: (() => void) | undefined;

  before(async () => {
    transportCount = 0;
    serverTransports = [];
    inFlight = 0;
    maxInFlight = 0;
    probeArmed = false;
    inFlightGate = undefined;
    mcpServer = new McpServer({ name: 'synthetic-server', version: '1.0.0' });
    mcpServer.registerTool('get_accounts', {}, async () => {
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      try {
        if (probeArmed) {
          // Hold long enough for a concurrent sibling to overlap; the second
          // arrival releases the first's gate so both finish promptly.
          await Promise.race([
            new Promise<void>((resolve) => {
              if (inFlight >= 2) {
                inFlightGate?.();
                return resolve();
              }
              inFlightGate = resolve;
            }),
            delay(2_000),
          ]);
        }
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify([{ account_number: '1234567890', type: 'margin' }]),
            },
          ],
        };
      } finally {
        inFlight -= 1;
      }
    });

    repository = new InMemoryCredentialRepository(credential());
    const sessionCache = new RobinhoodMcpSessionCache({
      repository,
      transportFactory: () => {
        transportCount += 1;
        const [client, serverSide] = InMemoryTransport.createLinkedPair();
        serverTransports.push(serverSide);
        void mcpServer.connect(serverSide);
        return client;
      },
    });
    const handler = createRhApiHandler({
      verifyIdToken: async () => ({ uid: OWNER }),
      ownerUid: OWNER,
      repository,
      sessionCache,
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

  const postBatch = (payload?: unknown) =>
    request(`${baseUrl}/api/rh/batch`, { method: 'POST', headers: bearer() }, payload);
  const postTool = (tool: string, payload?: unknown) =>
    request(`${baseUrl}/api/rh/tools/${tool}`, { method: 'POST', headers: bearer() }, payload);

  it('two sequential requests reuse ONE MCP connection', async () => {
    transportCount = 0;
    const first = await postBatch({ calls: [{ tool: 'get_accounts' }] });
    assert.equal(first.status, 200);
    assert.equal(batchBody(first.body).results?.[0]?.success, true);

    const second = await postBatch({ calls: [{ tool: 'get_accounts' }] });
    assert.equal(second.status, 200);
    assert.equal(batchBody(second.body).results?.[0]?.success, true);

    // One connect across two requests — the cache reused the warm session.
    assert.equal(transportCount, 1);
  });

  it('single tool calls ride the cached session too', async () => {
    transportCount = 0;
    const first = await postTool('get_accounts', {});
    const second = await postTool('get_accounts', {});
    assert.equal(first.status, 200);
    assert.equal(second.status, 200);
    assert.equal(transportCount, 0); // session from the previous test still warm
  });

  it('dead session reconnects once and retries the call', async () => {
    transportCount = 0;
    // Kill the server side of the cached session's transport — the next
    // callTool throws 'Not connected' (session-level), triggering recover.
    assert.ok(serverTransports.length > 0);
    await serverTransports[serverTransports.length - 1].close();

    const { status, body } = await postBatch({ calls: [{ tool: 'get_accounts' }] });
    assert.equal(status, 200);
    const batch = batchBody(body);
    assert.equal(batch.success, true);
    assert.equal(batch.results?.[0]?.success, true); // retried on the fresh session
    assert.equal(transportCount, 1); // exactly ONE reconnect
  });

  it('retries at most once — a still-dead second session returns failure', async () => {
    // Isolated handler whose connect seam severs the transport right after
    // connect resolves — every session is born dead, so the retry also fails.
    let connectCount = 0;
    const repo = new InMemoryCredentialRepository(credential());
    const deadServer = new McpServer({ name: 'synthetic-dead', version: '1.0.0' });
    deadServer.registerTool('get_accounts', {}, async () => ({
      content: [{ type: 'text', text: '[]' }],
    }));
    const deadTransports: Transport[] = [];
    const cache = new RobinhoodMcpSessionCache({
      repository: repo,
      connect: async (opts) => {
        connectCount += 1;
        opts = {
          ...opts,
          transportFactory: () => {
            const [client, serverSide] = InMemoryTransport.createLinkedPair();
            deadTransports.push(serverSide);
            void deadServer.connect(serverSide);
            return client;
          },
        };
        const conn = await connectLocalRobinhoodMcpSession(opts);
        // Connected client, severed transport — the next callTool throws
        // 'Not connected' deterministically (no timing race).
        await deadTransports[deadTransports.length - 1].close();
        return conn;
      },
    });
    const handler = createRhApiHandler({
      verifyIdToken: async () => ({ uid: OWNER }),
      ownerUid: OWNER,
      repository: repo,
      sessionCache: cache,
    });
    const isolated = http.createServer((req, res) => void handler(req, res));
    await new Promise<void>((resolve) => isolated.listen(0, '127.0.0.1', resolve));
    try {
      const port = (isolated.address() as AddressInfo).port;
      const res = await request(`http://127.0.0.1:${port}/api/rh/batch`, {
        method: 'POST',
        headers: bearer(),
      }, { calls: [{ tool: 'get_accounts' }] });
      assert.equal(res.status, 200);
      const batch = batchBody(res.body);
      assert.equal(batch.success, true);
      assert.equal(batch.results?.[0]?.success, false);
      assert.equal(batch.results?.[0]?.category, 'MCP');
      // Exactly two connects: initial acquire + the ONE recover. No storm.
      assert.equal(connectCount, 2);
    } finally {
      await new Promise<void>((resolve, reject) =>
        isolated.close((e) => (e ? reject(e) : resolve())),
      );
      await deadServer.close();
    }
  });

  it('concurrent recovers on the same dead session share ONE rebuild', async () => {
    transportCount = 0;
    // Kill the cached session's transport, then race two requests: both
    // fail on the dead connection and both call recover() — the first
    // rotates, the second must adopt the peer rebuild, not double-connect.
    assert.ok(serverTransports.length > 0);
    await serverTransports[serverTransports.length - 1].close();

    const [a, b] = await Promise.all([
      postBatch({ calls: [{ tool: 'get_accounts' }] }),
      postBatch({ calls: [{ tool: 'get_accounts' }] }),
    ]);
    assert.equal(a.status, 200);
    assert.equal(b.status, 200);
    assert.equal(batchBody(a.body).results?.[0]?.success, true);
    assert.equal(batchBody(b.body).results?.[0]?.success, true);
    assert.equal(transportCount, 1); // single-flight — not one connect per request
  });

  it('token rotation invalidates the cached session', async () => {
    transportCount = 0;
    // Rotate the stored credential — the next request must see the mismatch
    // and rebuild the session rather than reuse the stale-token connection.
    const rotated = credential('rotated-access-token');
    await repository.store(rotated, repository.current()!.revision);

    const { status, body } = await postBatch({ calls: [{ tool: 'get_accounts' }] });
    assert.equal(status, 200);
    assert.equal(batchBody(body).results?.[0]?.success, true);
    assert.equal(transportCount, 1); // one fresh connect for the new token

    // A subsequent request reuses the NEW session — no rebuild churn.
    const second = await postBatch({ calls: [{ tool: 'get_accounts' }] });
    assert.equal(second.status, 200);
    assert.equal(transportCount, 1);
  });

  it('concurrent callTool multiplexes over one session (no serialization)', async () => {
    transportCount = 0;
    inFlightGate = undefined;
    maxInFlight = 0;
    probeArmed = true;
    const [a, b] = await Promise.all([
      postTool('get_accounts', {}),
      postTool('get_accounts', {}),
    ]);
    probeArmed = false;
    assert.equal(a.status, 200);
    assert.equal(b.status, 200);
    // Both handlers overlapped on the server — the SDK multiplexes concurrent
    // callTool requests on one Client/transport (JSON-RPC id correlation).
    assert.equal(maxInFlight, 2);
    // Cold-start single-flight: concurrent acquires share one connect... but
    // the session was already warm here — either way only one transport total.
    assert.equal(transportCount, 0);
  });

  it('tool-level McpError does NOT tear down the session (healthy-session proof)', async () => {
    transportCount = 0;
    // A registered tool that throws — the SDK responds with a JSON-RPC
    // error, which rejects callTool as McpError: the transport is fine.
    mcpServer.registerTool('get_pnl_trade_history', {}, async () => {
      throw new Error('tool exploded');
    });
    const { status, body } = await postBatch({
      calls: [{ tool: 'get_accounts' }, { tool: 'get_pnl_trade_history' }],
    });
    assert.equal(status, 200);
    const batch = batchBody(body);
    assert.equal(batch.results?.[0]?.success, true); // session healthy all along
    const failed = batch.results?.[1];
    assert.equal(failed?.success, false);
    assert.equal((failed as Record<string, unknown>)?.sessionFailure, undefined);
    assert.equal(transportCount, 0); // zero rebuilds — session stayed cached
  });

  it('wedged session rotates after consecutive timeouts (no call retry)', async () => {
    // Isolated handler whose get_accounts hangs forever — every call hits
    // callTimeoutMs. Three consecutive timeouts must rotate the session
    // (liveness repair) even though no individual call is retried.
    let connectCount = 0;
    const repo = new InMemoryCredentialRepository(credential());
    const hanging = new McpServer({ name: 'synthetic-hang', version: '1.0.0' });
    hanging.registerTool('get_accounts', {}, () => new Promise(() => {}));
    const cache = new RobinhoodMcpSessionCache({
      repository: repo,
      transportFactory: () => {
        connectCount += 1;
        const [client, serverSide] = InMemoryTransport.createLinkedPair();
        void hanging.connect(serverSide);
        return client;
      },
    });
    const handler = createRhApiHandler({
      verifyIdToken: async () => ({ uid: OWNER }),
      ownerUid: OWNER,
      repository: repo,
      sessionCache: cache,
      callTimeoutMs: 50, // fast timeouts for the test
    });
    const isolated = http.createServer((req, res) => void handler(req, res));
    await new Promise<void>((resolve) => isolated.listen(0, '127.0.0.1', resolve));
    try {
      const port = (isolated.address() as AddressInfo).port;
      const tool = () => request(`http://127.0.0.1:${port}/api/rh/tools/get_accounts`, {
        method: 'POST',
        headers: bearer(),
      }, {});
      const results = [await tool(), await tool(), await tool()];
      for (const res of results) {
        assert.equal(res.status, 200);
        assert.equal((res.body as BatchItem).success, false); // timed out, never retried
      }
      // The 4th call rides the rotated session — one extra connect, not per-call.
      const fourth = await tool();
      assert.equal(fourth.status, 200);
      assert.equal(connectCount, 2);
    } finally {
      await new Promise<void>((resolve, reject) =>
        isolated.close((e) => (e ? reject(e) : resolve())),
      );
      await hanging.close();
    }
  });

  it('hung connect does not wedge the cache — pending clears at the bound', async () => {
    // A connect() that never resolves must not leave `pending` unsettled:
    // every later acquire would join the dead promise and time out until
    // the instance restarts. The first call fails at the connect bound;
    // the SECOND call must get its own fresh attempt and succeed.
    let connectCount = 0;
    const repo = new InMemoryCredentialRepository(credential());
    const srv = new McpServer({ name: 'synthetic-ok', version: '1.0.0' });
    srv.registerTool('get_accounts', {}, async () => ({
      content: [{ type: 'text', text: '[]' }],
    }));
    const cache = new RobinhoodMcpSessionCache({
      repository: repo,
      connectTimeoutMs: 60, // fast bound for the test
      connect: async (opts) => {
        connectCount += 1;
        if (connectCount === 1) {
          return new Promise(() => {}); // hangs forever — the wedge
        }
        return connectLocalRobinhoodMcpSession({
          ...opts,
          transportFactory: () => {
            const [client, serverSide] = InMemoryTransport.createLinkedPair();
            void srv.connect(serverSide);
            return client;
          },
        });
      },
    });
    const handler = createRhApiHandler({
      verifyIdToken: async () => ({ uid: OWNER }),
      ownerUid: OWNER,
      repository: repo,
      sessionCache: cache,
    });
    const isolated = http.createServer((req, res) => void handler(req, res));
    await new Promise<void>((resolve) => isolated.listen(0, '127.0.0.1', resolve));
    try {
      const port = (isolated.address() as AddressInfo).port;
      const tool = () => request(`http://127.0.0.1:${port}/api/rh/tools/get_accounts`, {
        method: 'POST',
        headers: bearer(),
      }, {});
      const first = await tool();
      assert.equal(first.status, 200);
      assert.equal((first.body as BatchItem).success, false); // connect bound fired
      // Cache unwedged: the second call drives a fresh connect and succeeds.
      const second = await tool();
      assert.equal(second.status, 200);
      assert.equal((second.body as BatchItem).success, true);
      assert.equal(connectCount, 2);
    } finally {
      await new Promise<void>((resolve, reject) =>
        isolated.close((e) => (e ? reject(e) : resolve())),
      );
      await srv.close();
    }
  });

  it('missing credential surfaces the connect-level failure envelope', async () => {
    const emptyRepo = new InMemoryCredentialRepository(null);
    const cache = new RobinhoodMcpSessionCache({ repository: emptyRepo });
    const handler = createRhApiHandler({
      verifyIdToken: async () => ({ uid: OWNER }),
      ownerUid: OWNER,
      repository: emptyRepo,
      sessionCache: cache,
    });
    const isolated = http.createServer((req, res) => void handler(req, res));
    await new Promise<void>((resolve) => isolated.listen(0, '127.0.0.1', resolve));
    try {
      const port = (isolated.address() as AddressInfo).port;
      const res = await request(`http://127.0.0.1:${port}/api/rh/batch`, {
        method: 'POST',
        headers: bearer(),
      }, { calls: [{ tool: 'get_accounts' }] });
      assert.equal(res.status, 200);
      const batch = batchBody(res.body);
      assert.equal(batch.success, false);
      assert.equal(batch.category, 'AUTH');
      assert.match(batch.error ?? '', /No stored Robinhood credential/);
    } finally {
      await new Promise<void>((resolve, reject) =>
        isolated.close((e) => (e ? reject(e) : resolve())),
      );
    }
  });
});
