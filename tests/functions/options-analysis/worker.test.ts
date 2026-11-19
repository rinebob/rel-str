/**
 * Deps-seam tests for `runReplayAnalysis` — the optionsReplayAnalysis
 * worker core (Topic #1238, Thread #1266, task #1372). No network, no
 * Firestore — stubbed getListDoc / fetchSeries / loadUnderlyingClose /
 * writeResultDoc.
 *
 * Covers TEST-BE §Worker:
 * - marker rows excluded; repeated contractIds → independent records
 * - per-contract fetch failure → 'error' record under EVERY exitId,
 *   doc still 'success', aggregates exclude it
 * - status re-check: non-success / missing rows → retryable throw;
 *   final attempt → no writes (never clobber good docs)
 * - truncated series → 'open' (future expiry, real excursions) or
 *   'error' (past expiry); missing underlying close → 'error' records
 * - expired outcome fields (expiredItm / intrinsic / assignmentDistancePct)
 * - calendar-days daysHeld (Fri→Mon = 3, not dayIndex 1); same-day = 0
 * - idempotent rerun → same doc ids overwritten
 * - final-attempt write failure → 'failed' docs for all exits
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  runReplayAnalysis,
  toScanBars,
  type AnalysisWorkerDeps,
} from '../../../functions/src/options-analysis/worker';
import type {
  ContractListNoSelectionRowV1,
  ContractListPickRowV1,
  ContractListPositionRow,
  OptionsContractListDoc,
  OptionsContractListDocV1,
  PickDocCoordinate,
  PickDocMeta,
  PositionLeg,
  PositionOptionLeg,
} from '@options-replay/contracts';
import type { AnalysisResultDoc, AnalysisTradeRecord } from '@options-analysis/contracts';
import type {
  HistoricalOptionsContractV2Observation,
  PartnerHistoricalOptionsContractV2Response,
} from '@options-contract/contracts';
import { OptionType } from '@options/common';
import { TradeSide } from '@common';
import { EXIT_REGISTRY_VERSION, EXIT_STRATEGIES } from '@options-analysis/registry';

// ==========================
// Fixtures
// ==========================

const PAYLOAD = {
  contractListDocId: 'run-1_QQQ',
  runId: 'run-1',
  symbol: 'QQQ',
  templateId: 'csp-45-20',
  registryVersion: EXIT_REGISTRY_VERSION,
};

const EXPIRY = '2026-02-20';

function pickRow(over: Partial<ContractListPickRowV1> = {}): ContractListPickRowV1 {
  return {
    kind: 'pick',
    entryDate: '2026-01-05',
    contractId: 'QQQ260220P00500000',
    expiration: EXPIRY,
    dte: 46,
    strike: 500,
    delta: -0.2,
    iv: 0.2,
    mark: 2.0,
    bid: 1.9,
    ask: 2.1,
    volume: 100,
    openInterest: 500,
    underlyingClose: 520,
    side: TradeSide.SHORT,
    repeatsPrevious: false,
    ...over,
  };
}

function markerRow(entryDate: string): ContractListNoSelectionRowV1 {
  return { kind: 'no-selection', entryDate, reason: 'miss' };
}

function obs(
  date: string,
  mark: string,
  greeks: { delta?: string; implied_volatility?: string } = {},
): HistoricalOptionsContractV2Observation {
  return { date, mark, ...greeks };
}

function seriesResp(
  series: HistoricalOptionsContractV2Observation[],
  over: Partial<PartnerHistoricalOptionsContractV2Response> = {},
): PartnerHistoricalOptionsContractV2Response {
  return {
    ok: true,
    symbol: 'QQQ',
    contractID: 'QQQ260220P00500000',
    expiration: EXPIRY,
    type: 'put',
    strike: '500',
    startDate: '2026-01-05',
    endDate: EXPIRY,
    series,
    ...over,
  };
}

interface Written {
  docId: string;
  doc: AnalysisResultDoc;
}

interface DepsInit {
  doc?: OptionsContractListDocV1 | OptionsContractListDoc;
  seriesById?: Record<string, PartnerHistoricalOptionsContractV2Response | Error>;
  closes?: Record<string, number>;
  /** Throw on 'success' doc writes — 'failed' writes still capture. */
  writeError?: Error;
  /** Analysis "today" — pinned so the open/error split never depends on
   *  the wall clock; default sits past EXPIRY (truncated series → error). */
  today?: string;
}

type FetchInput = Parameters<AnalysisWorkerDeps['fetchSeries']>[0];

function makeDeps(init: DepsInit): {
  deps: AnalysisWorkerDeps;
  written: Written[];
  fetchCalls: FetchInput[];
} {
  const written: Written[] = [];
  const fetchCalls: FetchInput[] = [];
  return {
    written,
    fetchCalls,
    deps: {
      getListDoc: async () => init.doc,
      fetchSeries: async (input) => {
        fetchCalls.push(input);
        const r = init.seriesById?.[input.contractID];
        if (r instanceof Error) throw r;
        if (!r) throw new Error(`no fixture for ${input.contractID}`);
        return r;
      },
      loadUnderlyingClose: async () => new Map(Object.entries(init.closes ?? {})),
      getToday: () => init.today ?? '2026-02-25',
      writeResultDocs: async (entries) => {
        if (init.writeError && entries.some((e) => e.doc.status === 'success')) {
          throw init.writeError;
        }
        written.push(...entries);
      },
    },
  };
}

const listDoc = (rows: OptionsContractListDocV1['rows'], status = 'success'): OptionsContractListDocV1 => ({
  runId: 'run-1',
  symbol: 'QQQ',
  templateId: 'csp-45-20',
  status: status as OptionsContractListDocV1['status'],
  rows,
  pickDocMeta: {
    coordinate: { type: OptionType.PUT, targetDelta: -0.2, expiry: { mode: 'nearestDte', dte: 45 } },
    gridVersion: 1,
    pickCount: 1,
    missCount: 0,
    firstDate: '2026-01-05',
    lastDate: EXPIRY,
  },
  generatedAt: '2026-01-05T00:00:00Z',
});

const resultFor = (w: Written[], exitId: string) =>
  w.find((x) => x.docId === `run-1_QQQ_${exitId}`)?.doc;

const recordsFor = (w: Written[], exitId: string): AnalysisTradeRecord[] =>
  resultFor(w, exitId)?.trades ?? [];

// ==========================
// v2 position-row fixtures (#1500)
// ==========================

const PUT_COORD: PickDocCoordinate = {
  type: OptionType.PUT,
  targetDelta: -0.2,
  expiry: { mode: 'nearestDte', dte: 45 },
};

/** Resolved option leg — mirrors pickRow's entry-day fields + the
 *  coordinate/side the replay worker stamps. */
function optLeg(over: Partial<PositionOptionLeg> = {}): PositionOptionLeg {
  return {
    kind: 'option',
    side: TradeSide.SHORT,
    coordinate: PUT_COORD,
    contractId: 'QQQ260220P00500000',
    expiration: EXPIRY,
    dte: 46,
    strike: 500,
    delta: -0.2,
    iv: 0.2,
    mark: 2.0,
    bid: 1.9,
    ask: 2.1,
    volume: 100,
    openInterest: 500,
    underlyingClose: 520,
    ...over,
  };
}

function positionRow(
  legs: readonly [PositionLeg, ...PositionLeg[]],
  over: Partial<ContractListPositionRow> = {},
): ContractListPositionRow {
  return { kind: 'position', entryDate: '2026-01-05', legs, repeatsPrevious: false, ...over };
}

function legMeta(over: Partial<PickDocMeta> = {}): PickDocMeta {
  return {
    coordinate: PUT_COORD,
    gridVersion: 1,
    pickCount: 1,
    missCount: 0,
    firstDate: '2026-01-05',
    lastDate: EXPIRY,
    ...over,
  };
}

const v2ListDoc = (rows: OptionsContractListDoc['rows'], legMetas = [legMeta()]): OptionsContractListDoc => ({
  runId: 'run-1',
  symbol: 'QQQ',
  templateId: 'pcs-45-20-5',
  status: 'success',
  schemaVersion: 2,
  rows,
  legMetas,
  generatedAt: '2026-01-05T00:00:00Z',
});

// ==========================
// toScanBars normalization
// ==========================

describe('toScanBars', () => {
  it('parses marks, drops non-numeric, bounds + sorts the window', () => {
    const bars = toScanBars(
      [
        { date: '2026-01-08', mark: '1.0' },
        { date: '2026-01-04', mark: '3.0' }, // before entry — dropped
        { date: '2026-01-06', mark: '' }, // blank mark — dropped
        { date: '2026-01-07', mark: 'abc' }, // non-numeric — dropped
        { date: '2026-01-05', mark: '2.0' },
        { date: '2026-02-25', mark: '0.1' }, // past expiry — dropped
      ],
      '2026-01-05',
      EXPIRY,
    );
    assert.deepEqual(bars, [
      { date: '2026-01-05', mark: 2.0 },
      { date: '2026-01-08', mark: 1.0 },
    ]);
  });
});

// ==========================
// Status re-check (IMPL-BE §3 hard requirement)
// ==========================

describe('status re-check', () => {
  it('missing doc → retryable throw, zero writes', async () => {
    const { deps, written } = makeDeps({ doc: undefined });
    await assert.rejects(runReplayAnalysis(PAYLOAD, deps, false), /reset/);
    assert.equal(written.length, 0);
  });

  it('missing doc on FINAL attempt → returns quietly, zero writes', async () => {
    const { deps, written } = makeDeps({ doc: undefined });
    await runReplayAnalysis(PAYLOAD, deps, true);
    assert.equal(written.length, 0);
  });

  it('non-success doc statuses → retryable throw, zero writes', async () => {
    for (const status of ['pending', 'running', 'failed'] as const) {
      const { deps, written } = makeDeps({ doc: listDoc([pickRow()], status) });
      await assert.rejects(runReplayAnalysis(PAYLOAD, deps, false), /reset/);
      assert.equal(written.length, 0, `status ${status} wrote docs`);
    }
  });

  it('rows missing (reset-in-progress) → retryable throw', async () => {
    const doc = listDoc([], 'success');
    // @ts-expect-error — simulate a reset that deleted rows
    delete doc.rows;
    const { deps, written } = makeDeps({ doc });
    await assert.rejects(runReplayAnalysis(PAYLOAD, deps, false));
    assert.equal(written.length, 0);
  });

});

// ==========================
// v2 position rows (#1500)
// ==========================

describe('v2 position rows', () => {
  const SHORT_ID = 'QQQ260220P00500000';
  const LONG_ID = 'QQQ260220P00490000';

  /** Two-leg put credit spread — short 500P @2.0 + long 490P @0.5, both
   *  expiring EXPIRY. Net entry cost-to-close = 2.0 − 0.5 = 1.5. */
  function pcsRow(): ContractListPositionRow {
    return positionRow([
      optLeg({ side: TradeSide.SHORT, contractId: SHORT_ID, strike: 500, mark: 2.0, delta: -0.2, iv: 0.2 }),
      optLeg({
        side: TradeSide.LONG,
        contractId: LONG_ID,
        strike: 490,
        mark: 0.5,
        delta: -0.05,
        iv: 0.22,
      }),
    ]);
  }

  const seriesFor = (contractID: string, mark: string, extra: { type?: 'call' | 'put' } = {}) =>
    seriesResp(
      [
        obs('2026-01-05', mark),
        obs('2026-01-06', mark),
        obs(EXPIRY, '0'),
      ],
      { contractID, ...extra },
    );

  it('two-leg position → per-leg fetches, net entryMark, joined contractId', async () => {
    const { deps, written, fetchCalls } = makeDeps({
      doc: v2ListDoc([pcsRow()], [legMeta(), legMeta()]),
      seriesById: {
        [SHORT_ID]: seriesFor(SHORT_ID, '2.0'),
        [LONG_ID]: seriesFor(LONG_ID, '0.5'),
      },
      closes: { [EXPIRY]: 520 }, // both puts OTM → intrinsic 0
    });
    await runReplayAnalysis(PAYLOAD, deps, false);
    assert.deepEqual(
      fetchCalls.map((c) => c.contractID).sort(),
      [LONG_ID, SHORT_ID],
    );
    const rec = recordsFor(written, 'expiry')[0];
    assert.equal(rec.outcome, 'expired');
    assert.equal(rec.entryMark, 1.5); // short 2.0 − long 0.5
    assert.equal(rec.contractId, `${SHORT_ID}+${LONG_ID}`);
    assert.ok(Math.abs((rec.entryDelta ?? NaN) - -0.15) < 1e-9);
    assert.ok(Math.abs((rec.entryIv ?? NaN) - -0.02) < 1e-9);
    if (rec.outcome === 'expired') {
      assert.equal(rec.expiredItm, false);
      assert.equal(rec.intrinsicAtExpiry, 0);
      assert.equal(rec.terminalMark, 0);
    }
    assert.equal(resultFor(written, 'expiry')?.status, 'success');
  });

  it('1-leg v2 position reproduces the v1 record for the same pick (narrowing parity)', async () => {
    const sharedSeries = seriesResp([obs('2026-01-05', '2.0'), obs(EXPIRY, '0')]);
    const closes = { [EXPIRY]: 495 }; // ITM put → intrinsic 5
    const v1 = makeDeps({
      doc: listDoc([pickRow()]),
      seriesById: { [SHORT_ID]: sharedSeries },
      closes,
    });
    const v2 = makeDeps({
      doc: v2ListDoc([positionRow([optLeg()])]),
      seriesById: { [SHORT_ID]: sharedSeries },
      closes,
    });
    await runReplayAnalysis(PAYLOAD, v1.deps, false);
    await runReplayAnalysis(PAYLOAD, v2.deps, false);
    for (const rule of EXIT_STRATEGIES) {
      assert.deepEqual(
        recordsFor(v2.written, rule.exitId),
        recordsFor(v1.written, rule.exitId),
        `${rule.exitId} records diverged between v1 and narrowed-v2`,
      );
    }
  });

  it('leg-series fetch failure → error record under every exitId (whole position)', async () => {
    const { deps, written } = makeDeps({
      doc: v2ListDoc([pcsRow()], [legMeta(), legMeta()]),
      seriesById: {
        [SHORT_ID]: seriesFor(SHORT_ID, '2.0'),
        [LONG_ID]: new Error('SA timeout'),
      },
    });
    await runReplayAnalysis(PAYLOAD, deps, false);
    for (const rule of EXIT_STRATEGIES) {
      const recs = recordsFor(written, rule.exitId);
      assert.equal(recs.length, 1);
      assert.equal(recs[0].outcome, 'error');
      assert.match((recs[0] as { error: string }).error, /leg 1.*SA timeout/i);
      assert.equal(recs[0].entryMark, 1.5); // entry fields still real
    }
    assert.equal(resultFor(written, 'expiry')?.status, 'success');
  });

  it('no-selection rows carry zero records — success docs still write', async () => {
    const { deps, written, fetchCalls } = makeDeps({
      doc: v2ListDoc([
        {
          kind: 'no-selection',
          entryDate: '2026-01-05',
          reason: 'miss',
          legMisses: [{ legIndex: 0, coordinate: PUT_COORD, reason: 'miss' }],
        },
      ]),
    });
    await runReplayAnalysis(PAYLOAD, deps, false);
    assert.equal(fetchCalls.length, 0);
    for (const rule of EXIT_STRATEGIES) {
      assert.equal(recordsFor(written, rule.exitId).length, 0);
      assert.equal(resultFor(written, rule.exitId)?.status, 'success');
    }
  });

  it('stock leg: no option fetch for it; marks come from underlyingClose', async () => {
    // Covered call — short call + long stock.
    const covered = positionRow([
      optLeg({
        side: TradeSide.SHORT,
        contractId: SHORT_ID,
        coordinate: { ...PUT_COORD, type: OptionType.CALL },
      }),
      { kind: 'stock', side: TradeSide.LONG, underlyingClose: 520 },
    ]);
    const { deps, written, fetchCalls } = makeDeps({
      doc: v2ListDoc([covered], [legMeta()]),
      seriesById: {
        [SHORT_ID]: seriesResp(
          [obs('2026-01-05', '2.0'), obs(EXPIRY, '0.1')],
          { contractID: SHORT_ID, type: 'call' },
        ),
      },
      closes: { '2026-01-05': 520, [EXPIRY]: 521 },
    });
    await runReplayAnalysis(PAYLOAD, deps, false);
    assert.equal(fetchCalls.length, 1);
    const rec = recordsFor(written, 'expiry')[0];
    // Cost-to-close entry = +2.0 (short call) − 520 (long stock) = −518
    // → debit posture flips the record onto liquidation value (+518).
    assert.equal(rec.entryMark, 518);
    assert.equal(rec.entryIv, undefined); // stock carries no iv
    // Settlement CTC = call intrinsic 21 − stock 521 = −500 → flipped
    // +500: the package settled with value → expiredItm true.
    if (rec.outcome === 'expired') {
      assert.ok(Math.abs(rec.intrinsicAtExpiry - 500) < 1e-9);
      assert.equal(rec.expiredItm, true);
    }
  });

  it('net-debit position flips onto liquidation value — premium-decay rule reads as the loss exit', async () => {
    // Debit call spread — long 500C @3.0 + short 510C @1.0 (net debit 2.0).
    // Value decays to 0.15 → target-90 (mark ≤ 10% of entry) fires as a
    // ~93%-lost stop — day-0 garbage-fires if the series isn't flipped.
    const LONGC = 'QQQ260220C00500000';
    const SHORTC = 'QQQ260220C00510000';
    const debitRow = positionRow([
      optLeg({
        side: TradeSide.LONG,
        contractId: LONGC,
        coordinate: { ...PUT_COORD, type: OptionType.CALL },
        strike: 500,
        mark: 3.0,
        delta: 0.5,
        iv: 0.3,
      }),
      optLeg({
        side: TradeSide.SHORT,
        contractId: SHORTC,
        coordinate: { ...PUT_COORD, type: OptionType.CALL },
        strike: 510,
        mark: 1.0,
        delta: 0.2,
        iv: 0.28,
      }),
    ]);
    const { deps, written } = makeDeps({
      doc: v2ListDoc([debitRow], [legMeta(), legMeta()]),
      seriesById: {
        [LONGC]: seriesResp(
          [obs('2026-01-05', '3.0'), obs('2026-01-08', '0.8'), obs(EXPIRY, '0')],
          { contractID: LONGC, type: 'call' },
        ),
        [SHORTC]: seriesResp(
          [obs('2026-01-05', '1.0'), obs('2026-01-08', '0.65'), obs(EXPIRY, '0')],
          { contractID: SHORTC, type: 'call' },
        ),
      },
      closes: { [EXPIRY]: 505 },
    });
    await runReplayAnalysis(PAYLOAD, deps, false);
    // Posture-normalized fields: entry value +2.0, position delta +0.3.
    const exitRec = recordsFor(written, 'target-90')[0];
    assert.equal(exitRec.outcome, 'exit');
    assert.equal(exitRec.entryMark, 2.0);
    assert.equal(exitRec.contractId, `${LONGC}+${SHORTC}`);
    assert.ok(Math.abs((exitRec.entryDelta ?? NaN) - 0.3) < 1e-9);
    if (exitRec.outcome === 'exit') {
      assert.equal(exitRec.exitDate, '2026-01-08'); // value 0.8 − 0.65 = 0.15 ≤ 0.2
      assert.ok(Math.abs(exitRec.exitPrice - 0.15) < 1e-9);
    }
  });

  it('long put expiring ITM → expiredItm true, intrinsic in posture space', async () => {
    // 1-leg LONG — v1 never produced one, but the seeded long variants
    // (lc/lp) do: the record must read like an ITM long expiry, not a
    // silently negated short.
    const lpRow = positionRow([
      optLeg({
        side: TradeSide.LONG,
        contractId: SHORT_ID,
        strike: 500,
        mark: 3.0,
        delta: -0.5,
        iv: 0.3,
      }),
    ]);
    const { deps, written } = makeDeps({
      doc: v2ListDoc([lpRow], [legMeta()]),
      seriesById: {
        [SHORT_ID]: seriesResp(
          [obs('2026-01-05', '3.0'), obs(EXPIRY, '5.0')],
          { contractID: SHORT_ID },
        ),
      },
      closes: { [EXPIRY]: 495 }, // ITM put → intrinsic 5
    });
    await runReplayAnalysis(PAYLOAD, deps, false);
    const rec = recordsFor(written, 'expiry')[0];
    assert.equal(rec.entryMark, 3.0); // flipped from −3 CTC
    assert.ok(Math.abs((rec.entryDelta ?? NaN) - -0.5) < 1e-9); // long put delta
    assert.equal(rec.outcome, 'expired');
    if (rec.outcome === 'expired') {
      assert.equal(rec.expiredItm, true);
      assert.equal(rec.intrinsicAtExpiry, 5);
      assert.equal(rec.terminalMark, 5);
    }
  });

  it('stock-only position → error under every exitId (no option leg to price)', async () => {
    const stockRow = positionRow([
      { kind: 'stock', side: TradeSide.LONG, underlyingClose: 520 },
    ]);
    const { deps, written, fetchCalls } = makeDeps({
      doc: v2ListDoc([stockRow]),
      closes: { '2026-01-05': 520, [EXPIRY]: 521 },
    });
    await runReplayAnalysis(PAYLOAD, deps, false);
    assert.equal(fetchCalls.length, 0);
    for (const rule of EXIT_STRATEGIES) {
      const recs = recordsFor(written, rule.exitId);
      assert.equal(recs.length, 1);
      assert.equal(recs[0].outcome, 'error');
      assert.match((recs[0] as { error: string }).error, /no option leg/i);
    }
  });

  it('unusable upstream type on a multi-leg position → error under every exitId', async () => {
    const { deps, written } = makeDeps({
      doc: v2ListDoc([pcsRow()], [legMeta(), legMeta()]),
      seriesById: {
        [SHORT_ID]: seriesResp(
          [obs('2026-01-05', '2.0'), obs(EXPIRY, '0')],
          { contractID: SHORT_ID, type: 'stock' as 'put' }, // corrupt wire type
        ),
        [LONG_ID]: seriesFor(LONG_ID, '0.5'),
      },
      closes: { [EXPIRY]: 520 },
    });
    await runReplayAnalysis(PAYLOAD, deps, false);
    const rec = recordsFor(written, 'expiry')[0];
    assert.equal(rec.outcome, 'error');
    assert.match((rec as { error: string }).error, /leg 0.*type.*unusable/i);
  });

  it('stock leg with no entry-day close → position head-truncation error', async () => {
    const covered = positionRow([
      optLeg({ side: TradeSide.SHORT, contractId: SHORT_ID }),
      { kind: 'stock', side: TradeSide.LONG, underlyingClose: 520 },
    ]);
    const { deps, written } = makeDeps({
      doc: v2ListDoc([covered], [legMeta()]),
      seriesById: {
        [SHORT_ID]: seriesFor(SHORT_ID, '2.0'),
      },
      closes: { '2026-01-06': 520, [EXPIRY]: 521 }, // 01-05 close missing
    });
    await runReplayAnalysis(PAYLOAD, deps, false);
    const rec = recordsFor(written, 'expiry')[0];
    assert.equal(rec.outcome, 'error');
    assert.match((rec as { error: string }).error, /pick-day bar .* missing/i);
  });

  it('a failed position emits errors while a healthy sibling produces real records', async () => {
    const BAD_ID = 'QQQ260220P00480000';
    const badRow = positionRow([
      optLeg({ side: TradeSide.SHORT, contractId: BAD_ID, strike: 480, mark: 1.0 }),
    ]);
    const { deps, written } = makeDeps({
      doc: v2ListDoc([pcsRow(), badRow], [legMeta(), legMeta()]),
      seriesById: {
        [SHORT_ID]: seriesFor(SHORT_ID, '2.0'),
        [LONG_ID]: seriesFor(LONG_ID, '0.5'),
        [BAD_ID]: new Error('SA 500'),
      },
      closes: { [EXPIRY]: 520 },
    });
    await runReplayAnalysis(PAYLOAD, deps, false);
    for (const rule of EXIT_STRATEGIES) {
      const recs = recordsFor(written, rule.exitId);
      assert.equal(recs.length, 2, rule.exitId);
      assert.notEqual(recs[0].outcome, 'error', `${rule.exitId} healthy row`);
      assert.equal(recs[1].outcome, 'error', `${rule.exitId} failed row`);
      assert.match((recs[1] as { error: string }).error, /SA 500/);
    }
  });

  it('two positions sharing a contractId fetch the contract series once', async () => {
    const { deps, written, fetchCalls } = makeDeps({
      doc: v2ListDoc(
        [
          positionRow([optLeg({ side: TradeSide.SHORT, contractId: SHORT_ID })]),
          positionRow([optLeg({ side: TradeSide.SHORT, contractId: SHORT_ID })], {
            entryDate: '2026-01-06',
          }),
        ],
        [legMeta()],
      ),
      seriesById: {
        [SHORT_ID]: seriesResp(
          [obs('2026-01-05', '2.0'), obs('2026-01-06', '1.9'), obs(EXPIRY, '0')],
          { contractID: SHORT_ID },
        ),
      },
      closes: { [EXPIRY]: 520 },
    });
    await runReplayAnalysis(PAYLOAD, deps, false);
    // One fetch at the earliest entry window; each row slices its own
    // [entryDate, expiry] out of the shared series.
    assert.deepEqual(fetchCalls, [
      { symbol: 'QQQ', contractID: SHORT_ID, startDate: '2026-01-05', endDate: EXPIRY },
    ]);
    const recs = recordsFor(written, 'expiry');
    assert.equal(recs.length, 2); // one record per position row
  });

  it('expired leg freezes at settlement while a living leg carries the position to last expiry', async () => {
    // Short 500P expires 2026-01-30 ITM (close 495 → intrinsic 5, frozen).
    // Long 490P lives to EXPIRY (2026-02-20), OTM at close 495 → intrinsic 0.
    const SHORT_EXP = '2026-01-30';
    const calRow = positionRow([
      optLeg({ side: TradeSide.SHORT, contractId: SHORT_ID, expiration: SHORT_EXP, strike: 500, mark: 2.0 }),
      optLeg({ side: TradeSide.LONG, contractId: LONG_ID, expiration: EXPIRY, strike: 490, mark: 0.5 }),
    ]);
    const { deps, written, fetchCalls } = makeDeps({
      doc: v2ListDoc([calRow], [legMeta(), legMeta()]),
      seriesById: {
        [SHORT_ID]: seriesResp(
          [obs('2026-01-05', '2.0'), obs('2026-01-28', '3.2'), obs(SHORT_EXP, '4.9')],
          { contractID: SHORT_ID, expiration: SHORT_EXP, endDate: SHORT_EXP },
        ),
        [LONG_ID]: seriesResp(
          [obs('2026-01-05', '0.5'), obs('2026-01-28', '0.9'), obs('2026-02-04', '0.4'), obs(EXPIRY, '0')],
          { contractID: LONG_ID, expiration: EXPIRY, endDate: EXPIRY },
        ),
      },
      closes: { [SHORT_EXP]: 495, [EXPIRY]: 495 },
      today: '2026-03-01',
    });
    await runReplayAnalysis(PAYLOAD, deps, false);
    assert.equal(fetchCalls.length, 2);
    const rec = recordsFor(written, 'expiry')[0];
    assert.equal(rec.outcome, 'expired');
    if (rec.outcome === 'expired') {
      // Net intrinsic = (+1)(5) + (−1)(0) = 5 → settled with liability.
      assert.equal(rec.intrinsicAtExpiry, 5);
      assert.equal(rec.expiredItm, true);
      assert.equal(rec.terminalMark, 5);
      assert.equal(rec.daysHeld, 46); // 01-05 → 02-20
    }
    // Excursion spans the frozen window: net mark on 02-04 = 5 − 0.4 = 4.6
    assert.ok(rec.mae.value >= 4.6, `mae ${rec.mae.value}`);
  });

  it('dte-time exit compares remaining days against the NEAREST living leg', async () => {
    // Short leg expires 01-30 (25 DTE at entry); long leg expires 02-20.
    // dte-21 fires at 01-09 (21 days before 01-30) — vs the max-expiry
    // reading it would fire at 01-30 (21 before 02-20).
    const SHORT_EXP = '2026-01-30';
    const calRow = positionRow([
      optLeg({ side: TradeSide.SHORT, contractId: SHORT_ID, expiration: SHORT_EXP, mark: 2.0 }),
      optLeg({ side: TradeSide.LONG, contractId: LONG_ID, expiration: EXPIRY, mark: 0.5 }),
    ]);
    const flat = (id: string, mark: string, exp: string) =>
      seriesResp(
        [
          obs('2026-01-05', mark),
          obs('2026-01-06', mark),
          obs('2026-01-07', mark),
          obs('2026-01-08', mark),
          obs('2026-01-09', mark),
          obs(exp, mark),
        ],
        { contractID: id, expiration: exp, endDate: exp },
      );
    const { deps, written } = makeDeps({
      doc: v2ListDoc([calRow], [legMeta(), legMeta()]),
      seriesById: {
        [SHORT_ID]: flat(SHORT_ID, '2.0', SHORT_EXP),
        [LONG_ID]: flat(LONG_ID, '0.5', EXPIRY),
      },
      closes: { [SHORT_EXP]: 520, [EXPIRY]: 520 },
      today: '2026-03-01',
    });
    await runReplayAnalysis(PAYLOAD, deps, false);
    const rec = recordsFor(written, 'dte-21')[0];
    assert.equal(rec.outcome, 'exit');
    if (rec.outcome === 'exit') {
      assert.equal(rec.exitDate, '2026-01-09'); // 21 days before the SHORT leg's 01-30 expiry
    }
  });

  it('net series ending short of a FUTURE max expiry → open (live position, real excursion)', async () => {
    const { deps, written } = makeDeps({
      doc: v2ListDoc([pcsRow()], [legMeta(), legMeta()]),
      seriesById: {
        [SHORT_ID]: seriesResp([obs('2026-01-05', '2.0'), obs('2026-01-12', '1.6')], {
          contractID: SHORT_ID,
        }),
        [LONG_ID]: seriesResp([obs('2026-01-05', '0.5'), obs('2026-01-12', '0.45')], {
          contractID: LONG_ID,
        }),
      },
      today: '2026-01-20', // expiry (02-20) still in the future
    });
    await runReplayAnalysis(PAYLOAD, deps, false);
    const rec = recordsFor(written, 'expiry')[0];
    assert.equal(rec.outcome, 'open');
    if (rec.outcome === 'open') {
      assert.equal(rec.lastBarDate, '2026-01-12');
      assert.ok(Math.abs((rec.terminalMark ?? NaN) - 1.15) < 1e-9); // 1.6 − 0.45
      assert.equal(rec.daysHeld, 7);
    }
  });

  it('head-truncated leg series → error (pick-day bar missing on that leg)', async () => {
    const { deps, written } = makeDeps({
      doc: v2ListDoc([pcsRow()], [legMeta(), legMeta()]),
      seriesById: {
        [SHORT_ID]: seriesResp([obs('2026-01-05', '2.0'), obs(EXPIRY, '0')], {
          contractID: SHORT_ID,
        }),
        // Long leg's corpus starts a week late — no entry-day bar.
        [LONG_ID]: seriesResp([obs('2026-01-12', '0.4'), obs(EXPIRY, '0')], {
          contractID: LONG_ID,
        }),
      },
      closes: { [EXPIRY]: 520 },
    });
    await runReplayAnalysis(PAYLOAD, deps, false);
    const rec = recordsFor(written, 'expiry')[0];
    assert.equal(rec.outcome, 'error');
    assert.match((rec as { error: string }).error, /leg 1.*pick-day bar/i);
  });

  it('missing underlying close at an early leg expiry → error (settlement cannot be fabricated)', async () => {
    const SHORT_EXP = '2026-01-30';
    const calRow = positionRow([
      optLeg({ side: TradeSide.SHORT, contractId: SHORT_ID, expiration: SHORT_EXP }),
      optLeg({ side: TradeSide.LONG, contractId: LONG_ID, expiration: EXPIRY }),
    ]);
    const { deps, written } = makeDeps({
      doc: v2ListDoc([calRow], [legMeta(), legMeta()]),
      seriesById: {
        [SHORT_ID]: seriesResp([obs('2026-01-05', '2.0'), obs(SHORT_EXP, '1.0')], {
          contractID: SHORT_ID,
          expiration: SHORT_EXP,
          endDate: SHORT_EXP,
        }),
        [LONG_ID]: seriesResp([obs('2026-01-05', '0.5'), obs(EXPIRY, '0')], {
          contractID: LONG_ID,
          expiration: EXPIRY,
          endDate: EXPIRY,
        }),
      },
      closes: { [EXPIRY]: 520 }, // 01-30 close missing
    });
    await runReplayAnalysis(PAYLOAD, deps, false);
    const rec = recordsFor(written, 'expiry')[0];
    assert.equal(rec.outcome, 'error');
    assert.match((rec as { error: string }).error, /underlying close/i);
  });
});

// ==========================
// Rows → records
// ==========================

describe('record generation', () => {
  it('marker rows excluded; repeat contractId rows produce independent records', async () => {
    const rows = [
      markerRow('2026-01-05'),
      pickRow({ entryDate: '2026-02-19', contractId: 'C1' }),
      markerRow('2026-02-20'),
      pickRow({ entryDate: '2026-02-19', contractId: 'C1', repeatsPrevious: true }),
    ];
    const { deps, written, fetchCalls } = makeDeps({
      doc: listDoc(rows),
      seriesById: { C1: seriesResp([obs('2026-02-19', '2.0'), obs(EXPIRY, '1.0')]) },
      closes: { [EXPIRY]: 520 },
    });
    await runReplayAnalysis(PAYLOAD, deps, false);
    // Shared contract → ONE fetch; each row still gets its own record.
    assert.equal(fetchCalls.length, 1);
    // 6 exit docs, each with 2 records (one per pick row)
    assert.equal(written.length, EXIT_STRATEGIES.length);
    for (const r of EXIT_STRATEGIES) {
      const recs = recordsFor(written, r.exitId);
      assert.equal(recs.length, 2);
      assert.equal(resultFor(written, r.exitId)?.status, 'success');
      assert.equal(resultFor(written, r.exitId)?.aggregate.contractCount, 2);
    }
  });

  it('empty pick list (all markers) → success docs, empty trades, zero aggregates', async () => {
    const { deps, written } = makeDeps({
      doc: listDoc([markerRow('2026-01-05'), markerRow('2026-01-06')]),
    });
    await runReplayAnalysis(PAYLOAD, deps, false);
    assert.equal(written.length, EXIT_STRATEGIES.length);
    const doc = resultFor(written, 'target-90')!;
    assert.equal(doc.status, 'success');
    assert.deepEqual(doc.trades, []);
    assert.deepEqual(doc.aggregate, {
      exitId: 'target-90',
      contractCount: 0,
      exitedCount: 0,
      expiredCount: 0,
      openCount: 0,
      errorCount: 0,
    });
  });
});

// ==========================
// Per-contract failure → error records
// ==========================

describe('fetch failure degradation', () => {
  it('a failed fetch writes an error record under EVERY exitId; analysis still succeeds', async () => {
    const { deps, written } = makeDeps({
      doc: listDoc([pickRow({ contractId: 'C1' })]),
      seriesById: { C1: new Error('SA 429') },
    });
    await runReplayAnalysis(PAYLOAD, deps, false);
    assert.equal(written.length, EXIT_STRATEGIES.length);
    for (const r of EXIT_STRATEGIES) {
      const doc = resultFor(written, r.exitId)!;
      assert.equal(doc.status, 'success');
      assert.equal(doc.trades.length, 1);
      assert.equal(doc.trades[0].outcome, 'error');
      assert.equal(doc.aggregate.errorCount, 1);
      assert.equal(doc.aggregate.hitRatePct, undefined); // denominator 0
    }
  });

  it('fetches each pick with the pickDate→expiration window', async () => {
    const row = pickRow({ entryDate: '2026-02-19', contractId: 'C1', expiration: EXPIRY });
    const { deps, fetchCalls } = makeDeps({
      doc: listDoc([row]),
      seriesById: { C1: seriesResp([obs('2026-02-19', '2.0'), obs(EXPIRY, '1.0')]) },
      closes: { [EXPIRY]: 520 },
    });
    await runReplayAnalysis(PAYLOAD, deps, false);
    assert.deepEqual(fetchCalls, [
      { symbol: 'QQQ', contractID: 'C1', startDate: '2026-02-19', endDate: EXPIRY },
    ]);
  });
});

// ==========================
// Outcome mapping
// ==========================

describe('outcome mapping', () => {
  it('fired rule → exit record with calendar-days daysHeld (Fri→Mon = 3, not dayIndex 1)', async () => {
    // Pick Fri 2026-01-09; mark hits $1.00 on Mon 2026-01-12.
    const row = pickRow({ entryDate: '2026-01-09', contractId: 'C1' });
    const { deps, written } = makeDeps({
      doc: listDoc([row]),
      seriesById: {
        C1: seriesResp([obs('2026-01-09', '2.0'), obs('2026-01-12', '1.0')]),
      },
      closes: {},
    });
    await runReplayAnalysis(PAYLOAD, deps, false);
    const rec = recordsFor(written, 'price-100')[0];
    assert.equal(rec.outcome, 'exit');
    if (rec.outcome === 'exit') {
      assert.equal(rec.exitDate, '2026-01-12');
      assert.equal(rec.exitPrice, 1.0);
    }
    assert.equal(rec.daysHeld, 3); // calendar days — NOT dayIndex 1
  });

  it('same-day exit → daysHeld 0', async () => {
    const row = pickRow({ entryDate: '2026-01-05', contractId: 'C1' });
    const { deps, written } = makeDeps({
      doc: listDoc([row]),
      seriesById: { C1: seriesResp([obs('2026-01-05', '0.5')]) },
    });
    await runReplayAnalysis(PAYLOAD, deps, false);
    const rec = recordsFor(written, 'price-100')[0];
    assert.equal(rec.outcome, 'exit');
    assert.equal(rec.daysHeld, 0);
  });

  it('no-fire + series reaches expiry → expired record with ITM/intrinsic/distance fields', async () => {
    // Put strike 500, underlying closes 480 at expiry → ITM, intrinsic 20.
    const row = pickRow({ entryDate: '2026-02-19', contractId: 'C1', mark: 2.0 });
    const { deps, written } = makeDeps({
      doc: listDoc([row]),
      seriesById: {
        C1: seriesResp([obs('2026-02-19', '2.0'), obs(EXPIRY, '18.0')]),
      },
      closes: { [EXPIRY]: 480 },
    });
    await runReplayAnalysis(PAYLOAD, deps, false);
    const rec = recordsFor(written, 'expiry')[0];
    assert.equal(rec.outcome, 'expired');
    if (rec.outcome === 'expired') {
      assert.equal(rec.expiredItm, true); // put: 480 < 500
      assert.equal(rec.intrinsicAtExpiry, 20);
      assert.equal(rec.assignmentDistancePct, (20 / 480) * 100);
    }
    assert.equal(rec.daysHeld, 1); // 02-19 → 02-20
  });

  it('entry greeks ride every record; terminal mark/delta/iv resolve per outcome', async () => {
    // price-100 fires on the mid bar (mark 0.5 ≤ 1.0); expiry bar carries
    // distinct greeks so the two terminal sources can't alias.
    const row = pickRow({ entryDate: '2026-01-05', contractId: 'C1', delta: -0.21, iv: 0.213 });
    const { deps, written } = makeDeps({
      doc: listDoc([row]),
      seriesById: {
        C1: seriesResp([
          obs('2026-01-05', '2.0', { delta: '-0.21', implied_volatility: '0.213' }),
          obs('2026-01-08', '0.5', { delta: '-0.05', implied_volatility: '0.19' }),
          obs(EXPIRY, '0.1', { delta: '-0.02', implied_volatility: '0.15' }),
        ]),
      },
      closes: { [EXPIRY]: 520 }, // OTM put → intrinsic 0
    });
    await runReplayAnalysis(PAYLOAD, deps, false);

    const exitRec = recordsFor(written, 'price-100')[0];
    assert.equal(exitRec.entryDelta, -0.21);
    assert.equal(exitRec.entryIv, 0.213);
    assert.equal(exitRec.terminalMark, 0.5); // exit bar mark = exitPrice
    assert.equal(exitRec.terminalDelta, -0.05);
    assert.equal(exitRec.terminalIv, 0.19);

    const expRec = recordsFor(written, 'expiry')[0];
    assert.equal(expRec.terminalMark, 0); // settled intrinsic, not the bar's 0.1
    assert.equal(expRec.terminalDelta, -0.02); // greeks off the expiry bar
    assert.equal(expRec.terminalIv, 0.15);
  });

  it('open record terminal fields come off the last bar; error records still carry entry greeks', async () => {
    const row = pickRow({ entryDate: '2026-01-05', contractId: 'C1', delta: -0.21, iv: 0.213 });
    const { deps, written } = makeDeps({
      doc: listDoc([row]),
      seriesById: {
        C1: seriesResp([
          obs('2026-01-05', '2.0', { delta: '-0.21', implied_volatility: '0.213' }),
          obs('2026-01-08', '1.5', { delta: '-0.18', implied_volatility: '0.22' }),
        ]),
      },
      today: '2026-01-10', // expiry still ahead → open
    });
    await runReplayAnalysis(PAYLOAD, deps, false);

    const openRec = recordsFor(written, 'expiry')[0];
    assert.equal(openRec.outcome, 'open');
    assert.equal(openRec.terminalMark, 1.5);
    assert.equal(openRec.terminalDelta, -0.18);
    assert.equal(openRec.terminalIv, 0.22);

    // A fetch-failed pick: no terminal fields, but the pick-row greeks
    // are still known — write them on the error record too.
    const { deps: deps2, written: written2 } = makeDeps({
      doc: listDoc([pickRow({ entryDate: '2026-01-05', contractId: 'BROKEN', delta: -0.3, iv: 0.4 })]),
      seriesById: { BROKEN: new Error('fetch failed') },
    });
    await runReplayAnalysis(PAYLOAD, deps2, false);
    const errRec = recordsFor(written2, 'expiry')[0];
    assert.equal(errRec.outcome, 'error');
    assert.equal(errRec.entryDelta, -0.3);
    assert.equal(errRec.entryIv, 0.4);
    assert.equal(errRec.terminalMark, undefined);
  });

  it('no-fire + series ends before expiry → error record (truncated, never fabricated)', async () => {
    // Series ends 45 days out — no rule can fire (dte-21 included), so
    // every exitId gets an 'error' record, not an invented outcome.
    const row = pickRow({ entryDate: '2026-01-05', contractId: 'C1' });
    const { deps, written } = makeDeps({
      doc: listDoc([row]),
      seriesById: { C1: seriesResp([obs('2026-01-05', '2.0'), obs('2026-01-06', '1.5')]) },
      closes: { [EXPIRY]: 520 },
    });
    await runReplayAnalysis(PAYLOAD, deps, false);
    for (const r of EXIT_STRATEGIES) {
      const rec = recordsFor(written, r.exitId)[0];
      assert.equal(rec.outcome, 'error', `exitId ${r.exitId}`);
    }
  });

  it('reaches expiry but underlying close missing → error record', async () => {
    const row = pickRow({ entryDate: '2026-02-19', contractId: 'C1' });
    const { deps, written } = makeDeps({
      doc: listDoc([row]),
      seriesById: { C1: seriesResp([obs('2026-02-19', '2.0'), obs(EXPIRY, '1.0')]) },
      closes: {}, // no close for expiry date
    });
    await runReplayAnalysis(PAYLOAD, deps, false);
    const rec = recordsFor(written, 'expiry')[0];
    assert.equal(rec.outcome, 'error');
    if (rec.outcome === 'error') assert.match(rec.error, /underlying close/);
  });

  it('reaches expiry but upstream type unusable → error record, never guessed ITM', async () => {
    const row = pickRow({ entryDate: '2026-02-19', contractId: 'C1' });
    const resp = seriesResp([obs('2026-02-19', '2.0'), obs(EXPIRY, '1.0')]);
    delete (resp as { type?: unknown }).type; // wire-level omission
    const { deps, written } = makeDeps({
      doc: listDoc([row]),
      seriesById: { C1: resp },
      closes: { [EXPIRY]: 480 },
    });
    await runReplayAnalysis(PAYLOAD, deps, false);
    const rec = recordsFor(written, 'expiry')[0];
    assert.equal(rec.outcome, 'error');
    if (rec.outcome === 'error') assert.match(rec.error, /option type/);
  });

  it('series missing the pick-day bar → error record (head-truncated corpus)', async () => {
    const row = pickRow({ entryDate: '2026-02-19', contractId: 'C1' });
    const { deps, written } = makeDeps({
      doc: listDoc([row]),
      // Corpus hole at 02-19 — first bar is a day late.
      seriesById: { C1: seriesResp([obs('2026-02-20', '1.0')]) },
      closes: { [EXPIRY]: 520 },
    });
    await runReplayAnalysis(PAYLOAD, deps, false);
    const rec = recordsFor(written, 'expiry')[0];
    assert.equal(rec.outcome, 'error');
    if (rec.outcome === 'error') assert.match(rec.error, /pick-day bar/);
  });

  it('empty series → error record', async () => {
    const row = pickRow({ entryDate: '2026-02-19', contractId: 'C1' });
    const { deps, written } = makeDeps({
      doc: listDoc([row]),
      seriesById: { C1: seriesResp([]) },
    });
    await runReplayAnalysis(PAYLOAD, deps, false);
    const rec = recordsFor(written, 'expiry')[0];
    assert.equal(rec.outcome, 'error');
  });

  // #1431 — 'open' outcome: a series ending short of a FUTURE expiry is a
  // live position, not a truncated corpus.
  it('no-fire + series ends before a FUTURE expiry → open record (real excursion, lastBarDate)', async () => {
    const row = pickRow({ entryDate: '2026-01-05', contractId: 'C1', mark: 2.0 });
    const { deps, written } = makeDeps({
      doc: listDoc([row]),
      // 3 bars then the series stops at 01-07 — expiry 02-20 still ahead.
      // Marks 2.0→2.5→1.8 fire no rule but put both excursions off the
      // entry placeholder (mae 2.5, mfe 1.8).
      seriesById: {
        C1: seriesResp([
          obs('2026-01-05', '2.0'),
          obs('2026-01-06', '2.5'),
          obs('2026-01-07', '1.8'),
        ]),
      },
      today: '2026-01-10',
    });
    await runReplayAnalysis(PAYLOAD, deps, false);
    for (const r of EXIT_STRATEGIES) {
      const rec = recordsFor(written, r.exitId)[0];
      assert.equal(rec.outcome, 'open', `exitId ${r.exitId}`);
      if (rec.outcome === 'open') {
        assert.equal(rec.lastBarDate, '2026-01-07');
        assert.equal(rec.daysHeld, 2); // pickDate → lastBar, days held so far
      }
    }
    // The open record carries the rule's real excursion — mae = worst
    // mark (adverse for short premium = UP), mfe = best mark.
    const rec = recordsFor(written, 'expiry')[0];
    if (rec.outcome === 'open') {
      assert.equal(rec.mae.value, 2.5);
      assert.equal(rec.mfe.value, 1.8);
    }
    // Aggregates count open positions separately and exclude them from
    // the hit-rate denominator.
    const agg = resultFor(written, 'expiry')!.aggregate;
    assert.equal(agg.openCount, 1);
    assert.equal(agg.errorCount, 0);
    assert.equal(agg.hitRatePct, undefined); // denominator 0 — every record open
  });

  it('open records carry each rule\'s own scan excursion (per-rule variance)', async () => {
    const row = pickRow({ entryDate: '2026-01-05', contractId: 'C1', mark: 2.0 });
    const { deps, written } = makeDeps({
      doc: listDoc([row]),
      // Mark dips to 0.5 on 01-07 (fires price-100's exit) — expiry's
      // open record scans the same full window, so the excursion is
      // real per-rule data, not a placeholder.
      seriesById: {
        C1: seriesResp([
          obs('2026-01-05', '2.0'),
          obs('2026-01-06', '3.0'),
          obs('2026-01-07', '0.5'),
        ]),
      },
      today: '2026-01-10',
    });
    await runReplayAnalysis(PAYLOAD, deps, false);
    // price-100 fired on 01-07 → 'exit'; expiry's open record scanned the
    // same full window — MAE 3.0 (worst adverse mark for a SHORT position
    // is the high mark) whichever direction the evaluator tracks.
    const exitRec = recordsFor(written, 'price-100')[0];
    assert.equal(exitRec.outcome, 'exit');
    const openRec = recordsFor(written, 'expiry')[0];
    assert.equal(openRec.outcome, 'open');
    if (openRec.outcome === 'open') {
      assert.equal(openRec.mae.value, 3.0);
      assert.equal(openRec.mfe.value, 0.5);
    }
  });
});

// ==========================
// Idempotency + failure posture
// ==========================

describe('idempotency + failure posture', () => {
  it('rerun overwrites the same {listDocId}_{exitId} docs', async () => {
    const row = pickRow({ entryDate: '2026-02-19', contractId: 'C1' });
    const init = {
      doc: listDoc([row]),
      seriesById: { C1: seriesResp([obs('2026-02-19', '2.0'), obs(EXPIRY, '1.0')]) },
      closes: { [EXPIRY]: 520 },
    };
    const a = makeDeps(init);
    await runReplayAnalysis(PAYLOAD, a.deps, false);
    const b = makeDeps(init);
    await runReplayAnalysis(PAYLOAD, b.deps, false);
    assert.deepEqual(
      a.written.map((w) => w.docId).sort(),
      b.written.map((w) => w.docId).sort(),
    );
  });

  it('write failure → retryable throw mid-run; on final attempt failed docs for all exits', async () => {
    const row = pickRow({ entryDate: '2026-02-19', contractId: 'C1' });
    const init = {
      doc: listDoc([row]),
      seriesById: { C1: seriesResp([obs('2026-02-19', '2.0'), obs(EXPIRY, '1.0')]) },
      closes: { [EXPIRY]: 520 },
      writeError: new Error('firestore unavailable'),
    };
    // Non-final attempt: the success-write failure propagates → retry.
    const failing = makeDeps(init);
    await assert.rejects(runReplayAnalysis(PAYLOAD, failing.deps, false));
    // Final attempt: success write still throws, but the best-effort
    // 'failed' docs are written instead (the flag only throws on
    // status:'success').
    const final = makeDeps(init);
    await runReplayAnalysis(PAYLOAD, final.deps, true);
    for (const r of EXIT_STRATEGIES) {
      const doc = resultFor(final.written, r.exitId)!;
      assert.equal(doc.status, 'failed');
      assert.equal(doc.aggregate.contractCount, 0);
      assert.ok(doc.error);
    }
  });
});
