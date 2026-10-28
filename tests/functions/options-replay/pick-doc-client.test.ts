/**
 * Unit tests for the SA pick-doc client (task #1279) — transport-injectable:
 * the fake transport captures PickDocShardRequest objects and returns fixture
 * year shards, so the request shape is asserted without touching the real
 * SA wire (endpoint pending av-proxy-api#225 — TEST-BE seam 1).
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { OptionType } from '../../../shared/options-common.ts';
import { PartnerHttpError } from '../../../functions/src/partner-infrastructure.ts';
import {
  fetchPickDoc,
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
    if (!shard) throw new PartnerHttpError(`no shard for ${req.year}`, 404);
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
      [2025, new PartnerHttpError('not found', 404)],
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
});
