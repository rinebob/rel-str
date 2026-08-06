/**
 * Unit tests for fetchWithRetry — GET (backward compat) and POST support.
 */

import assert from 'node:assert/strict';
import { describe, it, beforeEach, afterEach } from 'node:test';

import { fetchWithRetry } from '../../functions/src/partner-infrastructure.ts';

const TEST_URL = 'https://example.test/api';
const TEST_HEADERS = { Authorization: 'Bearer token' };

interface FetchCall {
  url: string;
  options: RequestInit;
}

function mockResponse(status: number, body: unknown = 'ok'): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('fetchWithRetry — GET (backward compatible)', () => {
  let fetchCalls: FetchCall[];
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    fetchCalls = [];
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('defaults to GET when no options passed', async () => {
    globalThis.fetch = async (url: string | URL | Request, options?: RequestInit) => {
      fetchCalls.push({ url: String(url), options: options ?? {} });
      return mockResponse(200);
    };

    const resp = await fetchWithRetry(TEST_URL, TEST_HEADERS);
    assert.equal(resp.status, 200);
    assert.equal(fetchCalls.length, 1);
    assert.equal(fetchCalls[0].options.method, 'GET');
    assert.equal(fetchCalls[0].options.body, undefined);
  });

  it('accepts numeric third arg as maxAttempts (old signature)', async () => {
    let calls = 0;
    globalThis.fetch = async () => {
      calls++;
      return mockResponse(500);
    };

    const resp = await fetchWithRetry(TEST_URL, TEST_HEADERS, 2);
    assert.equal(resp.status, 500);
    assert.equal(calls, 2);
  });

  it('passes headers through to fetch', async () => {
    globalThis.fetch = async (url: string | URL | Request, options?: RequestInit) => {
      fetchCalls.push({ url: String(url), options: options ?? {} });
      return mockResponse(200);
    };

    await fetchWithRetry(TEST_URL, TEST_HEADERS);
    assert.deepEqual(fetchCalls[0].options.headers, TEST_HEADERS);
  });
});

describe('fetchWithRetry — POST support', () => {
  let fetchCalls: FetchCall[];
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    fetchCalls = [];
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('sends POST with body when method and body specified', async () => {
    globalThis.fetch = async (url: string | URL | Request, options?: RequestInit) => {
      fetchCalls.push({ url: String(url), options: options ?? {} });
      return mockResponse(200);
    };

    const body = JSON.stringify({ symbol: 'QQQ' });
    const resp = await fetchWithRetry(TEST_URL, TEST_HEADERS, { method: 'POST', body });
    assert.equal(resp.status, 200);
    assert.equal(fetchCalls.length, 1);
    assert.equal(fetchCalls[0].options.method, 'POST');
    assert.equal(fetchCalls[0].options.body, body);
  });

  it('sends POST with Content-Type header from headers object', async () => {
    globalThis.fetch = async (url: string | URL | Request, options?: RequestInit) => {
      fetchCalls.push({ url: String(url), options: options ?? {} });
      return mockResponse(200);
    };

    const headers = { ...TEST_HEADERS, 'Content-Type': 'application/json' };
    await fetchWithRetry(TEST_URL, headers, { method: 'POST', body: '{}' });
    assert.deepEqual(fetchCalls[0].options.headers, headers);
  });

  it('accepts maxAttempts in options object (new signature)', async () => {
    let calls = 0;
    globalThis.fetch = async () => {
      calls++;
      return mockResponse(500);
    };

    const resp = await fetchWithRetry(TEST_URL, TEST_HEADERS, { maxAttempts: 2 });
    assert.equal(resp.status, 500);
    assert.equal(calls, 2);
  });

  it('retries on 429 for POST requests', async () => {
    let calls = 0;
    globalThis.fetch = async () => {
      calls++;
      if (calls === 1) return mockResponse(429);
      return mockResponse(200);
    };

    const resp = await fetchWithRetry(TEST_URL, TEST_HEADERS, {
      method: 'POST',
      body: '{}',
      maxAttempts: 3,
    });
    assert.equal(resp.status, 200);
    assert.equal(calls, 2);
  });

  it('does not retry on 404 for POST requests', async () => {
    let calls = 0;
    globalThis.fetch = async () => {
      calls++;
      return mockResponse(404);
    };

    const resp = await fetchWithRetry(TEST_URL, TEST_HEADERS, {
      method: 'POST',
      body: '{}',
      maxAttempts: 3,
    });
    assert.equal(resp.status, 404);
    assert.equal(calls, 1);
  });
});
