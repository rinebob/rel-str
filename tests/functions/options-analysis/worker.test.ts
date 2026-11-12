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
  ContractListNoSelectionRow,
  ContractListPickRow,
  OptionsContractListDoc,
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

function pickRow(over: Partial<ContractListPickRow> = {}): ContractListPickRow {
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

function markerRow(entryDate: string): ContractListNoSelectionRow {
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
  doc?: OptionsContractListDoc;
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

const listDoc = (rows: OptionsContractListDoc['rows'], status = 'success'): OptionsContractListDoc => ({
  runId: 'run-1',
  symbol: 'QQQ',
  templateId: 'csp-45-20',
  status: status as OptionsContractListDoc['status'],
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
    const { deps, written } = makeDeps({
      doc: listDoc(rows),
      seriesById: { C1: seriesResp([obs('2026-02-19', '2.0'), obs(EXPIRY, '1.0')]) },
      closes: { [EXPIRY]: 520 },
    });
    await runReplayAnalysis(PAYLOAD, deps, false);
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
