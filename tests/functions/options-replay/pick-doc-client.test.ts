/**
 * Unit tests for the SA pick-doc client (task #1279) — transport-injectable:
 * the fake transport captures PickDocShardRequest objects and returns fixture
 * year shards, so the request shape is asserted without touching the real
 * SA wire (TEST-BE seam 1). The production `partnerPickDocTransport` is
 * exercised separately below with globalThis.fetch stubbed — the first
 * fetch call is the IAM generateIdToken exchange, the second is the
 * partnerOptionsDeltaPicksV1 upstream call.
 */

import assert from 'node:assert/strict';
import { describe, it, beforeEach, afterEach } from 'node:test';

import { OptionType } from '../../../shared/options-common.ts';
import {
  PartnerHttpError,
  PARTNER_CODE_NOT_FOUND,
  PARTNER_CODE_OPTIONS_NOT_ENABLED,
} from '../../../functions/src/partner-infrastructure.ts';
import {
  fetchPickDoc,
  partnerPickDocTransport,
  pickDocCellId,
  pickDocDeltaPct,
  type PickDocShardRequest,
  type PickDocTransport,
} from '../../../functions/src/options-replay/pick-doc-client.ts';
import type { PickDocDay, PickDocument } from '../../../shared/options-replay-contracts.ts';

const PUT_45_20 = {
  type: OptionType.PUT,
  targetDelta: -0.2,
  expiry: { mode: 'nearestDte' as const, dte: 45 },
};

function makeDay(contractId: string): PickDocDay {
  return {
    underlyingClose: 603.21,
    contractId,
    expiration: '2026-05-15',
    dte: 44,
    strike: 565,
    delta: -0.204,
    iv: 0.198,
    mark: 8.42,
    bid: 8.3,
    ask: 8.54,
    volume: 412,
    openInterest: 5210,
  };
}

function makeShard(overrides: Partial<PickDocument> & { days: PickDocument['days'] }): PickDocument {
  return {
    symbol: 'QQQ',
    type: OptionType.PUT,
    targetDelta: -0.2,
    expiry: { mode: 'nearestDte', dte: 45 },
    gridVersion: 1,
    firstDate: '2026-01-02',
    lastDate: '2026-10-23',
    pickCount: 1,
    missCount: 0,
    ...overrides,
  };
}

/** Fake transport that records requests and answers per-year from a map. */
function fakeTransport(
  shards: Map<number, PickDocument | PartnerHttpError>,
): { transport: PickDocTransport; calls: PickDocShardRequest[] } {
  const calls: PickDocShardRequest[] = [];
  const transport: PickDocTransport = async (req) => {
    calls.push(req);
    const shard = shards.get(req.year);
    if (shard instanceof PartnerHttpError) throw shard;
    // SA's shard-miss contract: 404 + {code:'NOT_FOUND'} — bare 404s with no
    // code model infra misses and must NOT be produced here (#1401).
    if (!shard) throw new PartnerHttpError(`no shard for ${req.year}`, 404, PARTNER_CODE_NOT_FOUND);
    return shard;
  };
  return { transport, calls };
}

describe('pickDocDeltaPct + pickDocCellId', () => {
  it('derives grid deltaPct from the signed target delta', () => {
    assert.equal(pickDocDeltaPct(-0.2), 20);
    assert.equal(pickDocDeltaPct(0.3), 30);
    assert.equal(pickDocDeltaPct(-0.05), 5);
  });

  it('builds the SA cellId', () => {
    assert.equal(pickDocCellId('qqq', PUT_45_20), 'QQQ-put-20-45');
  });
});

describe('fetchPickDoc — request shape', () => {
  it('builds one shard request per year with grid-derived params', async () => {
    const { transport, calls } = fakeTransport(
      new Map([[2026, makeShard({ days: { '2026-01-05': makeDay('QQQ260515P00565000') } })]]),
    );
    await fetchPickDoc(
      { symbol: 'qqq', coordinate: PUT_45_20, startDate: '2026-01-05', endDate: '2026-03-31' },
      transport,
    );
    assert.equal(calls.length, 1);
    assert.deepEqual(calls[0], { symbol: 'QQQ', type: 'put', deltaPct: 20, dte: 45, year: 2026 });
  });

  it('fetches one shard per calendar year across a year boundary', async () => {
    const shards = new Map<number, PickDocument>([
      [2024, makeShard({ firstDate: '2024-06-03', lastDate: '2024-12-31', pickCount: 1, days: { '2024-06-03': makeDay('QQQ240719P00500000') } })],
      [2025, makeShard({ firstDate: '2025-01-02', lastDate: '2025-12-31', pickCount: 1, days: { '2025-01-06': makeDay('QQQ250516P00510000') } })],
      [2026, makeShard({ firstDate: '2026-01-02', lastDate: '2026-03-31', pickCount: 1, days: { '2026-01-05': makeDay('QQQ260515P00565000') } })],
    ]);
    const { transport, calls } = fakeTransport(shards);
    const doc = await fetchPickDoc(
      { symbol: 'QQQ', coordinate: PUT_45_20, startDate: '2024-06-01', endDate: '2026-03-31' },
      transport,
    );
    assert.deepEqual(calls.map((c) => c.year), [2024, 2025, 2026]);
    assert.equal(doc.firstDate, '2024-06-03');
    assert.equal(doc.lastDate, '2026-03-31');
    assert.equal(doc.pickCount, 3);
    assert.deepEqual(Object.keys(doc.days).sort(), ['2024-06-03', '2025-01-06', '2026-01-05']);
  });

  it('defaults endDate to the current year', async () => {
    const thisYear = new Date().getFullYear();
    const { transport, calls } = fakeTransport(
      new Map([[thisYear, makeShard({ days: { '2026-01-05': makeDay('QQQ260515P00565000') } })]]),
    );
    // 404s for intermediate years are skipped — only thisYear serves a shard.
    const doc = await fetchPickDoc(
      { symbol: 'QQQ', coordinate: PUT_45_20, startDate: `${thisYear - 2}-06-01` },
      transport,
    );
    assert.deepEqual(calls.map((c) => c.year), [thisYear - 2, thisYear - 1, thisYear]);
    assert.equal(doc.lastDate, '2026-10-23');
  });
});

describe('fetchPickDoc — error semantics', () => {
  it('skips a missing year shard and merges the rest', async () => {
    const shards = new Map<number, PickDocument | PartnerHttpError>([
      [2025, new PartnerHttpError('not found', 404, PARTNER_CODE_NOT_FOUND)],
      [2026, makeShard({ firstDate: '2026-01-02', lastDate: '2026-03-31', days: { '2026-01-05': makeDay('QQQ260515P00565000') } })],
    ]);
    const { transport } = fakeTransport(shards);
    const doc = await fetchPickDoc(
      { symbol: 'QQQ', coordinate: PUT_45_20, startDate: '2025-01-05', endDate: '2026-03-31' },
      transport,
    );
    assert.deepEqual(Object.keys(doc.days), ['2026-01-05']);
  });

  it('throws a coordinate-named error when no year shard exists at all', async () => {
    const { transport } = fakeTransport(new Map());
    await assert.rejects(
      () =>
        fetchPickDoc(
          { symbol: 'QQQ', coordinate: PUT_45_20, startDate: '2026-01-05', endDate: '2026-03-31' },
          transport,
        ),
      (e: unknown) => {
        assert.ok(e instanceof PartnerHttpError);
        assert.match(e.message, /QQQ-put-20-45/);
        // Carries NOT_FOUND — the absence came from the partner's own code,
        // so the worker classifies it permanent (no pointless retry).
        assert.equal(e.partnerCode, PARTNER_CODE_NOT_FOUND);
        return true;
      },
    );
  });

  it('rejects a malformed startDate as a 400, not a missing-doc 404', async () => {
    const { transport } = fakeTransport(new Map());
    await assert.rejects(
      () =>
        fetchPickDoc(
          { symbol: 'QQQ', coordinate: PUT_45_20, startDate: 'not-a-date', endDate: '2026-03-31' },
          transport,
        ),
      (e: unknown) => {
        assert.ok(e instanceof PartnerHttpError);
        assert.equal(e.status, 400);
        assert.match(e.message, /QQQ-put-20-45/);
        return true;
      },
    );
  });

  it('propagates OPTIONS_NOT_ENABLED (symbol-level 404) — not a coverage gap', async () => {
    // A symbol outside the options-enabled universe must fail the fetch
    // honestly, not be skipped like a missing year shard.
    const { transport, calls } = fakeTransport(
      new Map([[2026, new PartnerHttpError('symbol not enabled', 404, PARTNER_CODE_OPTIONS_NOT_ENABLED)]]),
    );
    await assert.rejects(
      () =>
        fetchPickDoc(
          { symbol: 'ZZZZ', coordinate: PUT_45_20, startDate: '2026-01-05', endDate: '2026-03-31' },
          transport,
        ),
      (e: unknown) => {
        assert.ok(e instanceof PartnerHttpError);
        assert.equal(e.partnerCode, PARTNER_CODE_OPTIONS_NOT_ENABLED);
        return true;
      },
    );
    assert.equal(calls.length, 1); // fails on the first shard — no sweep
  });

  it('aborts mid-sweep on OPTIONS_NOT_ENABLED — partial coverage never ships', async () => {
    const { transport, calls } = fakeTransport(
      new Map<number, PickDocument | PartnerHttpError>([
        [2025, makeShard({ days: { '2025-06-03': makeDay('QQQ250718P00500000') } })],
        [2026, new PartnerHttpError('symbol not enabled', 404, PARTNER_CODE_OPTIONS_NOT_ENABLED)],
      ]),
    );
    await assert.rejects(
      () =>
        fetchPickDoc(
          { symbol: 'QQQ', coordinate: PUT_45_20, startDate: '2025-01-05', endDate: '2026-03-31' },
          transport,
        ),
      (e: unknown) => {
        assert.ok(e instanceof PartnerHttpError);
        assert.equal(e.partnerCode, PARTNER_CODE_OPTIONS_NOT_ENABLED);
        return true;
      },
    );
    assert.equal(calls.length, 2); // fetched 2025, aborted at 2026
  });

  it('propagates a bare 404 with no partnerCode — infra 404s are not coverage gaps (#1401)', async () => {
    // A Google-infra 404 (endpoint missing, wrong URL, pre-deploy window)
    // carries no partnerCode. Skipping it mislabels a transport/config
    // failure as a data-availability failure — it must surface as the
    // fetch failure it is.
    const { transport, calls } = fakeTransport(
      new Map([[2026, new PartnerHttpError('The requested URL was not found on this server', 404)]]),
    );
    await assert.rejects(
      () =>
        fetchPickDoc(
          { symbol: 'QQQ', coordinate: PUT_45_20, startDate: '2026-01-05', endDate: '2026-03-31' },
          transport,
        ),
      (e: unknown) => {
        assert.ok(e instanceof PartnerHttpError);
        assert.equal(e.status, 404);
        // The upstream error itself, not the 'no year shard found' wrapper.
        assert.match(e.message, /not found on this server/i);
        return true;
      },
    );
    assert.equal(calls.length, 1); // aborts on the first shard — no sweep
  });

  it('aborts mid-sweep on a bare 404 — earlier shard success cannot mask it (#1401)', async () => {
    const { transport, calls } = fakeTransport(
      new Map<number, PickDocument | PartnerHttpError>([
        [2025, makeShard({ days: { '2025-06-03': makeDay('QQQ250718P00500000') } })],
        [2026, new PartnerHttpError('infra 404 — endpoint missing', 404)],
      ]),
    );
    await assert.rejects(
      () =>
        fetchPickDoc(
          { symbol: 'QQQ', coordinate: PUT_45_20, startDate: '2025-01-05', endDate: '2026-03-31' },
          transport,
        ),
      (e: unknown) => {
        assert.ok(e instanceof PartnerHttpError);
        assert.match(e.message, /infra 404/);
        return true;
      },
    );
    assert.equal(calls.length, 2); // fetched 2025, aborted at 2026
  });

  it('skips a NOT_FOUND gap then still propagates a later bare 404 (#1401)', async () => {
    // 2025 is a genuine coverage gap (coded miss — skipped); 2026 is an
    // infra miss — the skip must not latch: the bare 404 still propagates.
    const { transport, calls } = fakeTransport(
      new Map([[2026, new PartnerHttpError('infra 404 — endpoint missing', 404)]]),
    );
    await assert.rejects(
      () =>
        fetchPickDoc(
          { symbol: 'QQQ', coordinate: PUT_45_20, startDate: '2025-01-05', endDate: '2026-03-31' },
          transport,
        ),
      (e: unknown) => {
        assert.ok(e instanceof PartnerHttpError);
        assert.match(e.message, /infra 404/);
        return true;
      },
    );
    assert.equal(calls.length, 2); // 2025 skipped as a gap, 2026 propagated
  });

  it('propagates non-404 failures (off-grid 400 surfaces immediately)', async () => {
    const { transport } = fakeTransport(
      new Map([[2026, new PartnerHttpError('off-grid delta', 400)]]),
    );
    await assert.rejects(
      () =>
        fetchPickDoc(
          { symbol: 'QQQ', coordinate: PUT_45_20, startDate: '2026-01-05', endDate: '2026-03-31' },
          transport,
        ),
      (e: unknown) => {
        assert.ok(e instanceof PartnerHttpError);
        assert.equal(e.status, 400);
        return true;
      },
    );
  });

  it('rejects an inverted window (startYear > endYear) as a 400', async () => {
    const { transport, calls } = fakeTransport(new Map());
    await assert.rejects(
      () =>
        fetchPickDoc(
          { symbol: 'QQQ', coordinate: PUT_45_20, startDate: '2027-01-05', endDate: '2026-03-31' },
          transport,
        ),
      (e: unknown) => {
        assert.ok(e instanceof PartnerHttpError);
        assert.equal(e.status, 400);
        return true;
      },
    );
    assert.equal(calls.length, 0);
  });

  it('rejects a 5-digit year as malformed — Number(slice) leniency must not pass', async () => {
    const { transport } = fakeTransport(new Map());
    await assert.rejects(
      () =>
        fetchPickDoc(
          { symbol: 'QQQ', coordinate: PUT_45_20, startDate: '20266-01-01', endDate: '2027-01-01' },
          transport,
        ),
      (e: unknown) => {
        assert.ok(e instanceof PartnerHttpError);
        assert.equal(e.status, 400);
        return true;
      },
    );
  });
});

describe('fetchPickDoc — merge metadata', () => {
  it('maxes gridVersion, takes the latest updatedAt, sums missCount', async () => {
    const shards = new Map<number, PickDocument>([
      [2025, makeShard({ gridVersion: 3, updatedAt: '2025-12-31T00:00:00Z', missCount: 4, firstDate: '2025-01-02', lastDate: '2025-12-31', days: { '2025-06-03': makeDay('QQQ250718P00500000') } })],
      [2026, makeShard({ gridVersion: 2, updatedAt: '2026-10-23T00:00:00Z', missCount: 7, firstDate: '2026-01-02', lastDate: '2026-03-31', days: { '2026-01-05': makeDay('QQQ260515P00565000') } })],
    ]);
    const { transport } = fakeTransport(shards);
    const doc = await fetchPickDoc(
      { symbol: 'QQQ', coordinate: PUT_45_20, startDate: '2025-01-05', endDate: '2026-03-31' },
      transport,
    );
    assert.equal(doc.gridVersion, 3);
    assert.equal(doc.updatedAt, '2026-10-23T00:00:00Z');
    assert.equal(doc.missCount, 11);
    assert.equal(doc.pickCount, 2);
  });
});

// ==========================
// partnerPickDocTransport — the wire contract (fetch stubbed)
// ==========================

describe('partnerPickDocTransport — wire contract', () => {
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

  function jsonResponse(body: unknown, status = 200) {
    return new Response(JSON.stringify(body), {
      status,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  function upstreamCall() {
    const call = fetchCalls.find((c) => c.url.includes('partnerOptionsDeltaPicksV1'));
    assert.ok(call, 'expected an upstream call');
    return call;
  }

  const REQ: PickDocShardRequest = { symbol: 'QQQ', type: OptionType.PUT, deltaPct: 20, dte: 45, year: 2026 };

  it('GETs partnerOptionsDeltaPicksV1 with the documented param names', async () => {
    const shard = makeShard({ days: { '2026-01-05': makeDay('QQQ260515P00565000') } });
    globalThis.fetch = mockFetch(jsonResponse({ ok: true, ...shard }));

    await partnerPickDocTransport(REQ);

    const call = upstreamCall();
    assert.ok(call.url.includes('partnerOptionsDeltaPicksV1'), `url: ${call.url}`);
    for (const param of ['symbol=QQQ', 'type=put', 'delta=20', 'dte=45', 'year=2026']) {
      assert.ok(call.url.includes(param), `missing ${param} in ${call.url}`);
    }
    const auth = (call.options.headers as Record<string, string>)?.Authorization;
    assert.equal(auth, 'Bearer mock-token');
  });

  it('unwraps the {ok:true,…} envelope — returns the doc without ok', async () => {
    const shard = makeShard({ days: { '2026-01-05': makeDay('QQQ260515P00565000') } });
    globalThis.fetch = mockFetch(jsonResponse({ ok: true, ...shard }));

    const doc = await partnerPickDocTransport(REQ);

    assert.equal(doc.symbol, 'QQQ');
    assert.equal('ok' in doc, false);
    assert.deepEqual(Object.keys(doc.days), ['2026-01-05']);
  });

  it('rejects ok:false on a 200 as a 502 with the partner code', async () => {
    globalThis.fetch = mockFetch(
      jsonResponse({ ok: false, error: 'broken', code: 'INTERNAL_ERROR' }),
    );
    await assert.rejects(
      () => partnerPickDocTransport(REQ),
      (e: unknown) => {
        assert.ok(e instanceof PartnerHttpError);
        assert.equal(e.status, 502);
        assert.equal(e.partnerCode, 'INTERNAL_ERROR');
        return true;
      },
    );
  });

  it('rejects a 200 lacking ok:true — a malformed success is not a doc', async () => {
    const shard = makeShard({ days: { '2026-01-05': makeDay('QQQ260515P00565000') } });
    globalThis.fetch = mockFetch(jsonResponse(shard)); // no `ok` field
    await assert.rejects(
      () => partnerPickDocTransport(REQ),
      (e: unknown) => {
        assert.ok(e instanceof PartnerHttpError);
        assert.equal(e.status, 502);
        return true;
      },
    );
  });

  it('rejects invalid JSON on a 200 as a 502', async () => {
    globalThis.fetch = mockFetch(
      new Response('<html>oops</html>', { status: 200 }),
    );
    await assert.rejects(
      () => partnerPickDocTransport(REQ),
      (e: unknown) => {
        assert.ok(e instanceof PartnerHttpError);
        assert.equal(e.status, 502);
        return true;
      },
    );
  });

  it('extracts the partner code from an upstream 404 error body', async () => {
    globalThis.fetch = mockFetch(
      jsonResponse({ ok: false, error: 'symbol not enabled', code: PARTNER_CODE_OPTIONS_NOT_ENABLED }, 404),
    );
    await assert.rejects(
      () => partnerPickDocTransport(REQ),
      (e: unknown) => {
        assert.ok(e instanceof PartnerHttpError);
        assert.equal(e.status, 404);
        assert.equal(e.partnerCode, PARTNER_CODE_OPTIONS_NOT_ENABLED);
        return true;
      },
    );
  });
});
