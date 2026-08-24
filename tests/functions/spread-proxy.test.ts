/**
 * Unit tests for spread-proxy.ts — callPartnerSpreadTimeSeries.
 */

import assert from 'node:assert/strict';
import { describe, it, beforeEach, afterEach } from 'node:test';

import { callPartnerSpreadTimeSeries } from '../../functions/src/spread-proxy.ts';
import { SpreadType, DebitOrCredit } from '../../shared/spread-contracts.ts';
import type { SpreadDefinition, SpreadTimeSeriesResponse } from '../../shared/spread-contracts.ts';
import { OptionType } from '../../shared/options-common.ts';

const TEST_DEFINITION: SpreadDefinition = {
  spreadType: SpreadType.VERTICAL,
  symbol: 'QQQ',
  legs: [
    { optionType: OptionType.CALL, strike: 450, expiration: '2024-07-19', direction: 'long' },
    { optionType: OptionType.CALL, strike: 455, expiration: '2024-07-19', direction: 'short' },
  ],
  startDate: '2024-01-01',
  endDate: '2024-07-19',
};

const TEST_RESPONSE: SpreadTimeSeriesResponse = {
  ok: true,
  symbol: 'QQQ',
  spreadType: SpreadType.VERTICAL,
  debitOrCredit: DebitOrCredit.DEBIT,
  legs: [
    { contractID: 'QQQ240719C00450000', optionType: OptionType.CALL, strike: 450, expiration: '2024-07-19', direction: 'long' },
    { contractID: 'QQQ240719C00455000', optionType: OptionType.CALL, strike: 455, expiration: '2024-07-19', direction: 'short' },
  ],
  series: [{ date: '2024-01-01', price: 2.5 }],
  gaps: [],
  startDate: '2024-01-01',
  endDate: '2024-07-19',
};

describe('callPartnerSpreadTimeSeries', () => {
  let originalFetch: typeof globalThis.fetch;
  let fetchCalls: { url: string; options: RequestInit }[];

  beforeEach(() => {
    fetchCalls = [];
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  // Mock that returns a token for IAM calls and the test response for spread API calls
  function mockFetch(spreadResponse: Response) {
    return async (url: string | URL | Request, options?: RequestInit) => {
      const u = String(url);
      fetchCalls.push({ url: u, options: options ?? {} });
      // IAM token generation call
      if (u.includes('generateIdToken')) {
        return new Response(JSON.stringify({ token: 'mock-token' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      // Spread API call
      return spreadResponse;
    };
  }

  it('sends POST with JSON body and auth headers', async () => {
    globalThis.fetch = mockFetch(new Response(JSON.stringify(TEST_RESPONSE), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }));

    const result = await callPartnerSpreadTimeSeries(TEST_DEFINITION);
    // First call = IAM token, second call = spread API
    assert.equal(fetchCalls.length, 2);
    const spreadCall = fetchCalls[1];
    assert.equal(spreadCall.options.method, 'POST');
    assert.deepEqual(spreadCall.options.headers, {
      Authorization: 'Bearer mock-token',
      'Content-Type': 'application/json',
    });
    const body = spreadCall.options.body as string;
    assert.equal(JSON.parse(body).symbol, 'QQQ');
    assert.equal(result.symbol, 'QQQ');
    assert.equal(result.series.length, 1);
  });

  it('throws PartnerHttpError on non-OK response from SA', async () => {
    globalThis.fetch = mockFetch(new Response('Bad Request', { status: 400 }));

    await assert.rejects(
      () => callPartnerSpreadTimeSeries(TEST_DEFINITION),
      (err: Error & { status?: number }) => {
        assert.equal(err.name, 'PartnerHttpError');
        assert.equal(err.status, 400);
        return true;
      },
    );
  });

  it('returns parsed SpreadTimeSeriesResponse on success', async () => {
    globalThis.fetch = mockFetch(new Response(JSON.stringify(TEST_RESPONSE), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }));

    const result = await callPartnerSpreadTimeSeries(TEST_DEFINITION);
    assert.equal(result.spreadType, SpreadType.VERTICAL);
    assert.equal(result.debitOrCredit, DebitOrCredit.DEBIT);
    assert.equal(result.legs.length, 2);
    assert.equal(result.gaps.length, 0);
  });
});
