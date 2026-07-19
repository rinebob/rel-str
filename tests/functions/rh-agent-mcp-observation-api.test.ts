import assert from 'node:assert/strict';
import http from 'node:http';
import { describe, it, before, after } from 'node:test';
import type { AddressInfo } from 'node:net';
import { createRobinhoodObservationApi } from '../../functions/src/rh-agent-mcp/local-api/robinhood-observation-api';

interface ResponseResult {
  status: number;
  text: string;
  body: unknown;
}

function request(
  url: string,
  options: http.RequestOptions = {},
  payload?: unknown,
): Promise<ResponseResult> {
  return new Promise((resolve, reject) => {
    const req = http.request(
      url,
      {
        method: options.method ?? 'GET',
        headers: {
          'content-type': 'application/json',
          ...options.headers,
        },
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
            // leave body as raw text if JSON parse fails
          }
          resolve({ status: res.statusCode ?? 0, text, body });
        });
      },
    );
    req.on('error', reject);
    if (payload !== undefined) {
      req.write(
        typeof payload === 'string' ? payload : JSON.stringify(payload),
      );
    }
    req.end();
  });
}

describe('Robinhood observation API', () => {
  let server: http.Server;
  let baseUrl: string;

  before(async () => {
    server = createRobinhoodObservationApi();
    await new Promise<void>((resolve) => {
      server.listen(0, '127.0.0.1', () => {
        const address = server.address() as AddressInfo;
        baseUrl = `http://127.0.0.1:${address.port}`;
        resolve();
      });
    });
  });

  after(async () => {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  });

  it('returns 404 for unknown paths', async () => {
    const { status, body } = await request(`${baseUrl}/api/rh/unknown`);
    assert.equal(status, 404);
    assert.equal((body as { error: string }).error, 'Not found');
  });

  it('returns 404 for POST with no tool name', async () => {
    const { status } = await request(`${baseUrl}/api/rh/tools/`, {
      method: 'POST',
    });
    assert.equal(status, 404);
  });

  it('lists observation tools on GET /api/rh/tools', async () => {
    const { status, body } = await request(`${baseUrl}/api/rh/tools`);
    const typed = body as { success: boolean; tools: unknown[] };
    assert.equal(status, 200);
    assert.equal(typed.success, true);
    assert.ok(Array.isArray(typed.tools));
    assert.ok(typed.tools.length > 0);
  });

  it('returns 400 for invalid JSON body', async () => {
    const { status, body } = await request(
      `${baseUrl}/api/rh/tools/get_accounts`,
      { method: 'POST' },
      'not-json',
    );
    assert.equal(status, 400);
    assert.equal((body as { error: string }).error, 'Invalid JSON body');
  });

  it('returns 400 when body toolName does not match path', async () => {
    const { status, body } = await request(
      `${baseUrl}/api/rh/tools/get_accounts`,
      { method: 'POST' },
      { toolName: 'get_portfolio' },
    );
    assert.equal(status, 400);
    assert.ok(
      (body as { error: string }).error.includes(
        'toolName in body must match toolName in path',
      ),
    );
  });

  it('returns 400 when extraRedactFields is not a string array', async () => {
    const { status, body } = await request(
      `${baseUrl}/api/rh/tools/get_accounts`,
      { method: 'POST' },
      { extraRedactFields: 'account_number' },
    );
    assert.equal(status, 400);
    assert.ok(
      (body as { error: string }).error.includes(
        'extraRedactFields must be an array of strings',
      ),
    );
  });

  it('returns a structured failure for disallowed tools', async () => {
    const { status, body } = await request(
      `${baseUrl}/api/rh/tools/place_equity_order`,
      { method: 'POST' },
      {},
    );
    const typed = body as {
      success: boolean;
      error: string;
      category: string;
    };
    assert.equal(status, 200);
    assert.equal(typed.success, false);
    assert.equal(typed.category, 'VALIDATION');
    assert.ok(typed.error.includes('not in the observation allowlist'));
  });

  it('returns a structured failure when credentials are unavailable', async () => {
    const { status, body } = await request(
      `${baseUrl}/api/rh/tools/get_accounts`,
      { method: 'POST' },
      {},
    );
    const typed = body as {
      success: boolean;
      error: string;
      category: string;
    };
    assert.equal(status, 200);
    assert.equal(typed.success, false);
    assert.equal(typeof typed.error, 'string');
    assert.equal(typeof typed.category, 'string');
  });
});
