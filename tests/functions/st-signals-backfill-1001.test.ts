/**
 * @topic #984 — ST Firestore Reorg
 *
 * Unit tests for the st-signals backfill aggregator (task #1001): folding
 * legacy `signal-history` (CONFIRMED) + `run-ids` (INTERIM/re-discovery)
 * docs into one canonical occurrence aggregate per
 * {symbol, barDate, signalType}.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  aggregateOccurrences,
  droppedSignalTypes,
  payloadForExisting,
  payloadForNew,
  updateForExisting,
  RawHistoryDoc,
  RawRunDoc,
} from '../../functions/scripts/backfill-st-signals-1001';
import { StSignalDirection, StSignalEntry } from '../../functions/src/st-cloud-function/signals';
import { TradeSide } from '../../shared/common';

const entry = (over: Partial<StSignalEntry> = {}): StSignalEntry => ({
  signalType: 'D_ST_TREND_RIDER_V1_LONG',
  timeframe: 'D',
  direction: StSignalDirection.LONG,
  status: 'INTERIM',
  barDate: '2026-10-14',
  marketDate: '2026-10-14',
  indicators: { rs: 12.3 },
  ...over,
});

const runDoc = (runId: string, over: Partial<RawRunDoc> = {}): RawRunDoc => ({
  runId,
  marketDate: '2026-10-14',
  startedAt: '2026-10-14T16:00:00Z',
  entries: { D_ST_TREND_RIDER_V1_LONG: entry() },
  ...over,
});

const histDoc = (over: Partial<RawHistoryDoc> = {}): RawHistoryDoc => ({
  barDate: '2026-10-14',
  entries: { D_ST_TREND_RIDER_V1_LONG: { ...entry(), status: 'CONFIRMED', sourceRunId: 'run-nightly' } },
  ...over,
});

describe('aggregateOccurrences (#1001)', () => {
  it('mints a CONFIRMED aggregate from signal-history alone', () => {
    const { occurrences, malformed } = aggregateOccurrences('ADPT', [histDoc()], []);
    const agg = occurrences.get('ADPT_2026-10-14_D_ST_TREND_RIDER_V1_LONG')!;
    assert.ok(agg);
    assert.equal(agg.status, 'CONFIRMED');
    assert.equal(agg.direction, TradeSide.LONG);
    assert.equal(agg.sourceRunId, 'run-nightly', 'history sourceRunId is the provenance');
    assert.equal(agg.marketDate, '2026-10-14');
    assert.deepEqual(agg.runIds, ['run-nightly']);
    assert.equal(malformed.length, 0);
  });

  it('intraday INTERIM + nightly CONFIRMED collapse to one CONFIRMED occurrence with both runIds', () => {
    const { occurrences } = aggregateOccurrences(
      'ADPT',
      [histDoc()],
      [runDoc('run-1', { startedAt: '2026-10-14T15:00:00Z' }), runDoc('run-nightly', { startedAt: '2026-10-15T01:00:00Z' })],
    );
    const agg = occurrences.get('ADPT_2026-10-14_D_ST_TREND_RIDER_V1_LONG')!;
    assert.equal(agg.status, 'CONFIRMED', 'history presence upgrades');
    assert.deepEqual(agg.runIds, ['run-1', 'run-nightly'], 'every detecting run is unioned');
    assert.equal(agg.sourceRunId, 'run-1', 'earliest startedAt run is the first-detection provenance');
    assert.equal(agg.createdAtIso, '2026-10-14T15:00:00Z');
  });

  it('run-ids-only occurrence stays INTERIM', () => {
    const { occurrences } = aggregateOccurrences('ADPT', [], [runDoc('run-1'), runDoc('run-2', { startedAt: '2026-10-14T18:00:00Z' })]);
    const agg = occurrences.get('ADPT_2026-10-14_D_ST_TREND_RIDER_V1_LONG')!;
    assert.equal(agg.status, 'INTERIM');
    assert.equal(agg.sourceRunId, 'run-1');
    assert.deepEqual(agg.runIds, ['run-1', 'run-2']);
  });

  it('a run-ids entry already CONFIRMED (barStatus 1) aggregates CONFIRMED without history', () => {
    const { occurrences } = aggregateOccurrences('ADPT', [], [runDoc('run-1', {
      entries: { D_ST_TREND_RIDER_V1_LONG: entry({ status: 'CONFIRMED' }) },
    })]);
    assert.equal(occurrences.get('ADPT_2026-10-14_D_ST_TREND_RIDER_V1_LONG')!.status, 'CONFIRMED');
  });

  it('per-signalType fan-out and per-barDate identity hold', () => {
    const { occurrences } = aggregateOccurrences('ADPT', [], [runDoc('run-1', {
      entries: {
        D_ST_TREND_RIDER_V1_LONG: entry(),
        D_ST_TREND_RIDER_V1_SHORT: entry({ signalType: 'D_ST_TREND_RIDER_V1_SHORT', direction: StSignalDirection.SHORT }),
        W_ST_TREND_RIDER_V1_LONG: entry({ signalType: 'W_ST_TREND_RIDER_V1_LONG', timeframe: 'W', barDate: '2026-10-13' }),
      },
    })]);
    assert.equal(occurrences.size, 3);
    assert.ok(occurrences.has('ADPT_2026-10-14_D_ST_TREND_RIDER_V1_SHORT'));
    assert.ok(occurrences.has('ADPT_2026-10-13_W_ST_TREND_RIDER_V1_LONG'));
  });

  it('history payload wins over run-ids payload for indicators/direction', () => {
    const { occurrences } = aggregateOccurrences(
      'ADPT',
      [histDoc({ entries: { D_ST_TREND_RIDER_V1_LONG: { ...entry({ indicators: { rs: 99.9 } }), status: 'CONFIRMED', sourceRunId: 'run-nightly' } } })],
      [runDoc('run-1')],
    );
    assert.deepEqual(occurrences.get('ADPT_2026-10-14_D_ST_TREND_RIDER_V1_LONG')!.indicators, { rs: 99.9 });
  });

  it('history entry.barDate wins over the doc id (weekly re-dating divergence)', () => {
    // Older generated weekly docs: doc id = week-open, entry.barDate =
    // re-dated fire-day. The #1000 writer mints ids from entry.barDate,
    // so the backfill must use it or it writes a doc the dual-write
    // path would never find.
    const { occurrences } = aggregateOccurrences('ADPT', [histDoc({
      barDate: '2026-10-12',
      entries: { W_ST_TREND_RIDER_V1_LONG: { ...entry({ signalType: 'W_ST_TREND_RIDER_V1_LONG', timeframe: 'W', barDate: '2026-10-14' }), status: 'CONFIRMED', sourceRunId: 'run-nightly' } },
    })], []);
    assert.ok(occurrences.has('ADPT_2026-10-14_W_ST_TREND_RIDER_V1_LONG'), 'id minted from entry.barDate');
    assert.ok(!occurrences.has('ADPT_2026-10-12_W_ST_TREND_RIDER_V1_LONG'));
  });

  it('every history entry\'s sourceRunId reaches runIds even when one bucket wins the payload', () => {
    // Two generated weekly docs (doc id = week-open) re-date to the same
    // entry.barDate — one bucket, last-wins payload, but each nightly
    // run that canonicalized the signal belongs in provenance.
    const { occurrences } = aggregateOccurrences('ADPT', [
      histDoc({
        barDate: '2026-10-12',
        entries: { W_ST_TREND_RIDER_V1_LONG: { ...entry({ signalType: 'W_ST_TREND_RIDER_V1_LONG', timeframe: 'W', barDate: '2026-10-14' }), status: 'CONFIRMED', sourceRunId: 'run-nightly-a' } },
      }),
      histDoc({
        barDate: '2026-10-13',
        entries: { W_ST_TREND_RIDER_V1_LONG: { ...entry({ signalType: 'W_ST_TREND_RIDER_V1_LONG', timeframe: 'W', barDate: '2026-10-14' }), status: 'CONFIRMED', sourceRunId: 'run-nightly-b' } },
      }),
    ], []);
    const agg = occurrences.get('ADPT_2026-10-14_W_ST_TREND_RIDER_V1_LONG')!;
    assert.deepEqual(agg.runIds, ['run-nightly-a', 'run-nightly-b']);
  });

  it('recorded history sourceRunId wins when no run carries startedAt', () => {
    const { occurrences } = aggregateOccurrences('ADPT', [histDoc()], [
      runDoc('run-z', { startedAt: undefined }),
      runDoc('run-a', { startedAt: undefined }),
    ]);
    const agg = occurrences.get('ADPT_2026-10-14_D_ST_TREND_RIDER_V1_LONG')!;
    assert.equal(agg.sourceRunId, 'run-nightly', 'recorded nightly run beats an alphabetical pick');
    assert.deepEqual(agg.runIds, ['run-a', 'run-nightly', 'run-z']);
  });

  it('an earlier CONFIRMED history entry still confirms when a later doc carries INTERIM', () => {
    // Weekly re-dating: two history docs map to one bucket; payload is
    // last-wins but confirmation is any-wins.
    const { occurrences } = aggregateOccurrences('ADPT', [
      histDoc({
        barDate: '2026-10-12',
        entries: { W_ST_TREND_RIDER_V1_LONG: { ...entry({ signalType: 'W_ST_TREND_RIDER_V1_LONG', timeframe: 'W', barDate: '2026-10-14', status: 'CONFIRMED' }), sourceRunId: 'run-nightly-a' } },
      }),
      histDoc({
        barDate: '2026-10-13',
        entries: { W_ST_TREND_RIDER_V1_LONG: { ...entry({ signalType: 'W_ST_TREND_RIDER_V1_LONG', timeframe: 'W', barDate: '2026-10-14', status: 'INTERIM' }), sourceRunId: 'run-nightly-b' } },
      }),
    ], []);
    const agg = occurrences.get('ADPT_2026-10-14_W_ST_TREND_RIDER_V1_LONG')!;
    assert.equal(agg.status, 'CONFIRMED', 'earlier CONFIRMED survives a trailing INTERIM re-detection');
    assert.deepEqual(agg.runIds, ['run-nightly-a', 'run-nightly-b']);
  });

  it('an INTERIM history entry does NOT confirm the occurrence (weekly re-detection on an open bar)', () => {
    // writeSignalHistoryDoc writes every nightly entry with no status
    // filter — a W signal re-detected mid-week lands in signal-history
    // INTERIM. Presence alone must not force CONFIRMED.
    const { occurrences } = aggregateOccurrences('ADPT', [histDoc({
      entries: { W_ST_TREND_RIDER_V1_LONG: { ...entry({ signalType: 'W_ST_TREND_RIDER_V1_LONG', timeframe: 'W', status: 'INTERIM' }), sourceRunId: 'run-nightly' } },
    })], []);
    const agg = occurrences.get('ADPT_2026-10-14_W_ST_TREND_RIDER_V1_LONG')!;
    assert.equal(agg.status, 'INTERIM');
    assert.equal(agg.sourceRunId, 'run-nightly');
  });

  it('an unnormalizable direction is malformed, not written as null', () => {
    const { occurrences, malformed } = aggregateOccurrences('ADPT', [], [
      runDoc('run-1', { entries: { D_ST_TREND_RIDER_V1_LONG: entry({ direction: 'BUY' as StSignalEntry['direction'] }) } }),
    ]);
    assert.equal(occurrences.size, 0);
    assert.equal(malformed.length, 1);
    assert.match(malformed[0], /direction/);
  });

  it('a history-only bucket with no sourceRunId is malformed (zero detecting runs)', () => {
    const { occurrences, malformed } = aggregateOccurrences('ADPT', [histDoc({
      entries: { D_ST_TREND_RIDER_V1_LONG: { ...entry(), status: 'CONFIRMED', sourceRunId: undefined } },
    })], []);
    assert.equal(occurrences.size, 0);
    assert.equal(malformed.length, 1);
    assert.match(malformed[0], /no detecting run/);
  });

  it('non-string doc fields are coerced, not thrown or written verbatim', () => {
    const { occurrences } = aggregateOccurrences('ADPT', [], [runDoc('run-1', {
      marketDate: { toMillis: () => 0 } as unknown as string,
      startedAt: 12345 as unknown as string,
    })]);
    const agg = occurrences.get('ADPT_2026-10-14_D_ST_TREND_RIDER_V1_LONG')!;
    assert.equal(agg.sourceRunId, 'run-1', 'untimed run still supplies provenance by fallback');
    assert.equal(agg.marketDate, '2026-10-14', 'falls back through entry.marketDate');
  });

  it('droppedSignalTypes flags non-entry-shaped signal values', () => {
    const dropped = droppedSignalTypes({
      'signals.D_OK': entry(),
      'signals.D_JUNK': { direction: 'long' }, // no barDate → not entry-shaped
      signals: { W_NESTED_BAD: 'not-an-object' },
      marketDate: '2026-10-14',
    });
    assert.deepEqual(dropped.sort(), ['D_JUNK', 'W_NESTED_BAD']);
  });

  it('malformed id segments are reported, not thrown', () => {
    const { occurrences, malformed } = aggregateOccurrences('ADPT', [], [runDoc('run-1', {
      entries: { BAD: entry({ signalType: 'BAD', barDate: 'garbageXXX' }) },
    })]);
    assert.equal(occurrences.size, 0);
    assert.equal(malformed.length, 1);
    assert.match(malformed[0], /BAD/);
  });

  it('runIds sort deterministically; marketDate falls back to entry then barDate', () => {
    const { occurrences } = aggregateOccurrences('ADPT', [], [
      runDoc('run-b', { marketDate: undefined, startedAt: '2026-10-14T18:00:00Z', entries: { D_ST_TREND_RIDER_V1_LONG: entry({ marketDate: '2026-10-14' }) } }),
      runDoc('run-a', { marketDate: undefined, startedAt: '2026-10-14T15:00:00Z', entries: { D_ST_TREND_RIDER_V1_LONG: entry({ marketDate: '2026-10-14' }) } }),
    ]);
    const agg = occurrences.get('ADPT_2026-10-14_D_ST_TREND_RIDER_V1_LONG')!;
    assert.deepEqual(agg.runIds, ['run-a', 'run-b']);
    assert.equal(agg.sourceRunId, 'run-a');
    assert.equal(agg.marketDate, '2026-10-14');
  });
});

describe('write payloads (#1001)', () => {
  const agg = aggregateOccurrences('ADPT', [histDoc()], [runDoc('run-1', { startedAt: '2026-10-14T15:00:00Z' })]).occurrences.get('ADPT_2026-10-14_D_ST_TREND_RIDER_V1_LONG')!;

  it('new-doc payload carries the full canonical shape', () => {
    const p = payloadForNew(agg);
    assert.equal(p.symbol, 'ADPT');
    assert.equal(p.signalType, 'D_ST_TREND_RIDER_V1_LONG');
    assert.equal(p.barDate, '2026-10-14');
    assert.equal(p.marketDate, '2026-10-14');
    assert.equal(p.direction, 'long');
    assert.equal(p.status, 'CONFIRMED');
    assert.deepEqual(p.ticketIds, []);
    assert.deepEqual(p.positionGroupIds, []);
    assert.equal(agg.createdAtIso, '2026-10-14T15:00:00Z');
    assert.equal(p.sourceRunId, 'run-1');
    assert.deepEqual(p.runIds, ['run-1', 'run-nightly']);
  });

  it('existing-doc payload never downgrades CONFIRMED and never touches provenance', () => {
    const confirmed = payloadForExisting(agg);
    assert.deepEqual(Object.keys(confirmed), ['status'], 'only the status upgrade is emitted');
    assert.equal(confirmed.status, 'CONFIRMED');

    const interimAgg = aggregateOccurrences('ADPT', [], [runDoc('run-1')]).occurrences.get('ADPT_2026-10-14_D_ST_TREND_RIDER_V1_LONG')!;
    const interim = payloadForExisting(interimAgg);
    assert.deepEqual(Object.keys(interim), [], 'INTERIM aggregate writes nothing status-wise');
  });

  it('updateForExisting: no-change / runIds-only / upgrade-only / upgrade-with-no-new-runs', () => {
    // The upgrade-with-empty-newRuns branch is the one that crashed the
    // live script: arrayUnion() throws on zero elements, so the caller
    // must see newRuns === [] and omit the field entirely.
    const prior = { runIds: ['run-1', 'run-nightly'], status: 'INTERIM' };
    assert.deepEqual(updateForExisting(agg, prior), { newRuns: [], upgrades: true });

    const noChange = updateForExisting(agg, { runIds: ['run-1', 'run-nightly'], status: 'CONFIRMED' });
    assert.equal(noChange, null, 'already-CONFIRMED doc with all runIds → no write');

    const runIdsOnly = updateForExisting(agg, { runIds: ['run-1'], status: 'CONFIRMED' });
    assert.deepEqual(runIdsOnly, { newRuns: ['run-nightly'], upgrades: false });

    const interimAgg = aggregateOccurrences('ADPT', [], [runDoc('run-1')]).occurrences.get('ADPT_2026-10-14_D_ST_TREND_RIDER_V1_LONG')!;
    const noUpgrade = updateForExisting(interimAgg, { runIds: [], status: 'INTERIM' });
    assert.deepEqual(noUpgrade, { newRuns: ['run-1'], upgrades: false }, 'INTERIM never upgrades');
  });
});
