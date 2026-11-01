/**
 * Route-level tests for options-contract-proxy.ts —
 * callPartnerContractAvailabilityV1 (task #1336).
 *
 * Seam: the proxy function itself, with globalThis.fetch stubbed — the
 * first fetch call is the IAM generateIdToken exchange (answered with a
 * mock token), the second is the partnerContractAvailabilityV1 upstream
 * call. Mirrors the spread-proxy.test.ts harness.
 */

import assert from 'node:assert/strict';
import { describe, it, beforeEach, afterEach } from 'node:test';

import { callPartnerContractAvailabilityV1 } from '../../functions/src/options-contract-proxy.ts';
import type { ContractAvailabilityResponse } from '../../shared/options-contract-contracts.ts';

const ENTRY = {
  contractId: 'QQQ260619C00475000',
  expiration: '2026-06-19',
  strike: 475,
  type: 'call',
  firstObserved: '2026-01-05',
  lastObserved: '2026-06-19',
};

const RESPONSE: ContractAvailabilityResponse = {
  ok: true,
  symbol: 'QQQ',
  count: 1,
  truncated: false,
  contracts: [ENTRY],
  corpusDates: ['2026-06-19'],
  corpusDateCount: 1,
};

describe('callPartnerContractAvailabilityV1', () => {
  let originalFetch: typeof globalThis.fetch;
  let fetchCalls: { url: string; options: RequestInit }[];

  beforeEach(() => {
    fetchCalls = [];
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  function mockFetch(upstream: Response) {
    return async (url: string | URL | Request, options?: RequestInit) => {
      const u = String(url);
      fetchCalls.push({ url: u, options: options ?? {} });
      if (u.includes('generateIdToken')) {
        return new Response(JSON.stringify({ token: 'mock-token' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      return upstream;
    };
  }

  function okResponse(body: unknown = RESPONSE) {
    return new Response(JSON.stringify(body), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  function upstreamUrl(): string {
    const call = fetchCalls.find((c) => !c.url.includes('generateIdToken'));
    assert.ok(call, 'expected an upstream call');
    return call.url;
  }

  it('serializes every request field verbatim, expirations comma-joined', async () => {
    globalThis.fetch = mockFetch(okResponse());

    await callPartnerContractAvailabilityV1({
      symbol: 'QQQ',
      expirationGte: '2026-01-01',
      expirationLte: '2026-12-31',
      expirations: ['2026-06-19', '2026-07-17'],
      strikeGte: 400,
      strikeLte: 500,
      strikeStep: 5,
      type: 'C',
      firstObservedGte: '2025-01-01',
      firstObservedLte: '2026-12-31',
    });

    const url = new URL(upstreamUrl());
    const p = url.searchParams;
    assert.equal(p.get('symbol'), 'QQQ');
    assert.equal(p.get('expirationGte'), '2026-01-01');
    assert.equal(p.get('expirationLte'), '2026-12-31');
    assert.equal(p.get('expirations'), '2026-06-19,2026-07-17');
    assert.equal(p.get('strikeGte'), '400');
    assert.equal(p.get('strikeLte'), '500');
    assert.equal(p.get('strikeStep'), '5');
    assert.equal(p.get('type'), 'C');
    assert.equal(p.get('firstObservedGte'), '2025-01-01');
    assert.equal(p.get('firstObservedLte'), '2026-12-31');
    assert.ok(url.pathname.endsWith('partnerContractAvailabilityV1'));
  });

  it('omits unset params from the query string entirely', async () => {
    globalThis.fetch = mockFetch(okResponse());

    await callPartnerContractAvailabilityV1({ symbol: 'QQQ' });

    const url = new URL(upstreamUrl());
    assert.equal(url.search, '?symbol=QQQ');
  });

  it('requests the ID token with the base-host audience (SA requirement)', async () => {
    globalThis.fetch = mockFetch(okResponse());

    await callPartnerContractAvailabilityV1({ symbol: 'QQQ' });

    const iamCall = fetchCalls.find((c) => c.url.includes('generateIdToken'));
    assert.ok(iamCall, 'expected an IAM token call');
    const body = JSON.parse(String(iamCall.options.body)) as { audience: string };
    // SA's availability function checks `aud` against the base host — a
    // function-URL audience gets a 403 'audience mismatch' upstream.
    assert.equal(
      body.audience,
      'https://us-central1-alpha-vantage-proxy-api.cloudfunctions.net',
    );
  });

  it('sends the OIDC Bearer header to the upstream', async () => {
    globalThis.fetch = mockFetch(okResponse());

    await callPartnerContractAvailabilityV1({ symbol: 'QQQ' });

    const call = fetchCalls.find((c) => !c.url.includes('generateIdToken'));
    const headers = call?.options.headers as Record<string, string>;
    assert.equal(headers.Authorization, 'Bearer mock-token');
  });

  it('returns the upstream body verbatim — contracts untouched', async () => {
    globalThis.fetch = mockFetch(okResponse());

    const result = await callPartnerContractAvailabilityV1({ symbol: 'QQQ' });
    assert.deepEqual(result, RESPONSE);
  });

  it('passes through a valid empty result (ok:true, contracts:[])', async () => {
    globalThis.fetch = mockFetch(
      okResponse({ ok: true, symbol: 'QQQ', count: 0, truncated: false, contracts: [] }),
    );

    const result = await callPartnerContractAvailabilityV1({ symbol: 'QQQ' });
    assert.equal(result.ok, true);
    assert.equal(result.contracts.length, 0);
  });

  it('throws PartnerHttpError with status + partner code on upstream failure', async () => {
    globalThis.fetch = mockFetch(
      new Response(JSON.stringify({ ok: false, code: 'OPTIONS_NOT_ENABLED', error: 'nope' }), {
        status: 404,
      }),
    );

    await assert.rejects(
      () => callPartnerContractAvailabilityV1({ symbol: 'QQQ' }),
      (err: Error & { status?: number; partnerCode?: string }) => {
        assert.equal(err.name, 'PartnerHttpError');
        assert.equal(err.status, 404);
        assert.equal(err.partnerCode, 'OPTIONS_NOT_ENABLED');
        return true;
      },
    );
  });

  it('throws on a 200 with malformed JSON', async () => {
    globalThis.fetch = mockFetch(
      new Response('not json', { status: 200, headers: { 'Content-Type': 'text/plain' } }),
    );

    await assert.rejects(() => callPartnerContractAvailabilityV1({ symbol: 'QQQ' }));
  });

  it('rejects a missing symbol with BAD_REQUEST before any fetch', async () => {
    globalThis.fetch = mockFetch(okResponse());

    await assert.rejects(
      () => callPartnerContractAvailabilityV1({ symbol: '  ' }),
      (err: Error & { status?: number; partnerCode?: string }) => {
        assert.equal(err.name, 'PartnerHttpError');
        assert.equal(err.status, 400);
        assert.equal(err.partnerCode, 'BAD_REQUEST');
        return true;
      },
    );
    assert.equal(fetchCalls.length, 0, 'no IAM or upstream call on validation failure');
  });

  it('rejects an inverted expiration range with BAD_REQUEST before any fetch', async () => {
    globalThis.fetch = mockFetch(okResponse());

    await assert.rejects(
      () =>
        callPartnerContractAvailabilityV1({
          symbol: 'QQQ',
          expirationGte: '2026-12-31',
          expirationLte: '2026-01-01',
        }),
      (err: Error & { status?: number }) => {
        assert.equal(err.name, 'PartnerHttpError');
        assert.equal(err.status, 400);
        return true;
      },
    );
    assert.equal(fetchCalls.length, 0);
  });

  it('rejects an inverted strike range with BAD_REQUEST before any fetch', async () => {
    globalThis.fetch = mockFetch(okResponse());

    await assert.rejects(
      () =>
        callPartnerContractAvailabilityV1({
          symbol: 'QQQ',
          strikeGte: 500,
          strikeLte: 400,
        }),
      (err: Error & { status?: number }) => {
        assert.equal(err.name, 'PartnerHttpError');
        assert.equal(err.status, 400);
        return true;
      },
    );
    assert.equal(fetchCalls.length, 0);
  });

  it('rejects an inverted firstObserved range with BAD_REQUEST before any fetch', async () => {
    globalThis.fetch = mockFetch(okResponse());

    await assert.rejects(
      () =>
        callPartnerContractAvailabilityV1({
          symbol: 'QQQ',
          firstObservedGte: '2026-12-31',
          firstObservedLte: '2026-01-01',
        }),
      (err: Error & { status?: number }) => {
        assert.equal(err.name, 'PartnerHttpError');
        assert.equal(err.status, 400);
        return true;
      },
    );
    assert.equal(fetchCalls.length, 0);
  });

  it('serializes a zero strike bound verbatim and omits an empty expirations list', async () => {
    globalThis.fetch = mockFetch(okResponse());

    await callPartnerContractAvailabilityV1({
      symbol: 'QQQ',
      strikeGte: 0,
      expirations: [],
    });

    const url = new URL(upstreamUrl());
    assert.equal(url.searchParams.get('strikeGte'), '0', 'zero is a real bound, not unset');
    assert.equal(url.searchParams.get('expirations'), null, 'empty list must not reach the wire');
  });

  it('ignores a non-array expirations value rather than crashing', async () => {
    globalThis.fetch = mockFetch(okResponse());

    // Malformed caller input — a bare string must not reach .join().
    const result = await callPartnerContractAvailabilityV1({
      symbol: 'QQQ',
      expirations: '2026-06-19' as unknown as string[],
    });
    assert.equal(result.ok, true);
    const url = new URL(upstreamUrl());
    assert.equal(url.searchParams.get('expirations'), null);
  });

  it('forwards an explicit expirations list alongside a range — SA defines precedence', async () => {
    globalThis.fetch = mockFetch(okResponse());

    await callPartnerContractAvailabilityV1({
      symbol: 'QQQ',
      expirationGte: '2026-01-01',
      expirationLte: '2026-12-31',
      expirations: ['2026-06-19'],
    });

    const url = new URL(upstreamUrl());
    assert.equal(url.searchParams.get('expirations'), '2026-06-19');
    assert.equal(url.searchParams.get('expirationGte'), '2026-01-01');
  });
});
