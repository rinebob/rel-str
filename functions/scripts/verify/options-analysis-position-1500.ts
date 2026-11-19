/**
 * Verify — #1500 Analyzer: position net series + records.
 *
 * DRY stage (default, no credentials): drives `runReplayAnalysis` with
 * `AnalysisWorkerDeps` fakes through the REAL narrowing boundary,
 * per-leg fetch fanout, net-series builder, and record layer —
 * multi-leg marks, settlement freezing, nearest-living dte exits,
 * stock legs, leg-failure → error, v1→v2 parity.
 *
 * LIVE stage (`--live`, needs ADC + GOOGLE_CLOUD_PROJECT=rel-str +
 * IPv4 preload): reads a REAL v2 list doc (verify-1499-* evidence),
 * writes a truncated copy to st-options-contract-lists, then invokes
 * `runReplayAnalysis` with `prodAnalysisDeps` — real SA series fetches
 * per option leg + real Firestore result writes. The Cloud Tasks hop
 * is proven by #1370's verify; this stage verifies the analyzer's
 * data path end-to-end.
 *
 * Live docs left in place as evidence (verify-1500-* ids are
 * greppable; optionsAnalysisStart can re-drive them).
 */

import { getFirestore } from 'firebase-admin/firestore';
import {
  ST_OPTIONS_ANALYSIS_RESULTS_ROOT,
  ST_OPTIONS_CONTRACT_LISTS_ROOT,
} from '@st/collections';
import type {
  ContractListPositionRow,
  OptionsContractListDoc,
  OptionsContractListDocV1,
  PickDocCoordinate,
  PositionOptionLeg,
} from '@options-replay/contracts';
import { OptionType } from '@options/common';
import { TradeSide } from '@common';
import type {
  AnalysisResultDoc,
  AnalysisTradeRecord,
} from '@options-analysis/contracts';
import type { PartnerHistoricalOptionsContractV2Response } from '@options-contract/contracts';
import { EXIT_REGISTRY_VERSION, EXIT_STRATEGIES } from '@options-analysis/registry';
import {
  runReplayAnalysis,
  prodAnalysisDeps,
  type AnalysisWorkerDeps,
} from '../../src/options-analysis/worker';

const LIVE = process.argv.includes('--live');
let passed = 0;
let failed = 0;

function ok(name: string, cond: boolean, detail = ''): void {
  if (cond) {
    passed++;
    console.log(`  ok ${name}`);
  } else {
    failed++;
    console.log(`  FAIL ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

const approx = (a: number | undefined, b: number) =>
  a !== undefined && Math.abs(a - b) < 1e-6;

// ==========================
// DRY — fake deps through the real worker core
// ==========================

const COORD: PickDocCoordinate = {
  type: OptionType.PUT,
  targetDelta: -0.2,
  expiry: { mode: 'nearestDte', dte: 45 },
};
const EXPIRY = '2026-02-20';
const SHORT_ID = 'QQQ260220P00500000';
const LONG_ID = 'QQQ260220P00490000';

const leg = (over: Partial<PositionOptionLeg>): PositionOptionLeg => ({
  kind: 'option' as const,
  side: TradeSide.SHORT,
  coordinate: COORD,
  contractId: SHORT_ID,
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
});

const posRow = (legs: ContractListPositionRow['legs'], entryDate = '2026-01-05'): ContractListPositionRow => ({
  kind: 'position',
  entryDate,
  legs,
  repeatsPrevious: false,
});

const v2Doc = (rows: OptionsContractListDoc['rows']): OptionsContractListDoc => ({
  runId: 'verify',
  symbol: 'QQQ',
  templateId: 'pcs-45-20-5',
  status: 'success',
  schemaVersion: 2,
  rows,
  legMetas: [
    { coordinate: COORD, gridVersion: 1, pickCount: 1, missCount: 0, firstDate: '2026-01-05', lastDate: EXPIRY },
  ],
  generatedAt: '2026-01-05T00:00:00Z',
});

const v1Doc = (): OptionsContractListDocV1 => ({
  runId: 'verify',
  symbol: 'QQQ',
  templateId: 'csp-45-20',
  status: 'success',
  rows: [
    {
      kind: 'pick',
      entryDate: '2026-01-05',
      contractId: SHORT_ID,
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
    },
  ],
  pickDocMeta: {
    coordinate: COORD,
    gridVersion: 1,
    pickCount: 1,
    missCount: 0,
    firstDate: '2026-01-05',
    lastDate: EXPIRY,
  },
  generatedAt: '2026-01-05T00:00:00Z',
});

const resp = (
  contractID: string,
  marks: [string, string][],
  over: Partial<PartnerHistoricalOptionsContractV2Response> = {},
): PartnerHistoricalOptionsContractV2Response => ({
  ok: true,
  symbol: 'QQQ',
  contractID,
  expiration: EXPIRY,
  type: 'put',
  strike: '500',
  startDate: '2026-01-05',
  endDate: EXPIRY,
  series: marks.map(([date, mark]) => ({ date, mark })),
  ...over,
});

interface Env {
  deps: AnalysisWorkerDeps;
  written: { docId: string; doc: AnalysisResultDoc }[];
  fetchCalls: { contractID: string }[];
}

function env(init: {
  doc: OptionsContractListDocV1 | OptionsContractListDoc;
  series?: Record<string, PartnerHistoricalOptionsContractV2Response | Error>;
  closes?: Record<string, number>;
  today?: string;
}): Env {
  const written: Env['written'] = [];
  const fetchCalls: Env['fetchCalls'] = [];
  return {
    written,
    fetchCalls,
    deps: {
      getListDoc: async () => init.doc,
      fetchSeries: async (input) => {
        fetchCalls.push(input);
        const r = init.series?.[input.contractID];
        if (r instanceof Error) throw r;
        if (!r) throw new Error(`no fixture for ${input.contractID}`);
        return r;
      },
      loadUnderlyingClose: async () => new Map(Object.entries(init.closes ?? {})),
      getToday: () => init.today ?? '2026-03-01',
      writeResultDocs: async (entries) => { written.push(...entries); },
    },
  };
}

const payload = {
  contractListDocId: 'verify_QQQ',
  runId: 'verify',
  symbol: 'QQQ',
  templateId: 'pcs-45-20-5',
  registryVersion: EXIT_REGISTRY_VERSION,
};

const trades = (w: Env['written'], exitId: string): AnalysisTradeRecord[] =>
  w.find((x) => x.docId === `verify_QQQ_${exitId}`)?.doc.trades ?? [];

async function dry(): Promise<void> {
  console.log('DRY — fake deps through the real narrowing + net-series + records path');

  // 2-leg credit spread — net marks + joined contractId + all exits.
  {
    const e = env({
      doc: v2Doc([posRow([
        leg({ side: TradeSide.SHORT, contractId: SHORT_ID, strike: 500, mark: 2.0, delta: -0.2, iv: 0.2 }),
        leg({ side: TradeSide.LONG, contractId: LONG_ID, strike: 490, mark: 0.5, delta: -0.05, iv: 0.22 }),
      ])]),
      series: {
        [SHORT_ID]: resp(SHORT_ID, [['2026-01-05', '2.0'], ['2026-01-06', '1.8'], [EXPIRY, '0']]),
        [LONG_ID]: resp(LONG_ID, [['2026-01-05', '0.5'], ['2026-01-06', '0.45'], [EXPIRY, '0']]),
      },
      closes: { [EXPIRY]: 520 },
    });
    await runReplayAnalysis(payload, e.deps, false);
    ok('pcs: one fetch per option leg', e.fetchCalls.length === 2, `${e.fetchCalls.length}`);
    ok('pcs: one result doc per registered exit', e.written.length === EXIT_STRATEGIES.length);
    ok('pcs: all docs success', e.written.every((w) => w.doc.status === 'success'));
    const rec = trades(e.written, 'expiry')[0];
    ok('pcs: expired outcome at last expiry', rec?.outcome === 'expired');
    ok('pcs: net entryMark = short − long', approx(rec?.entryMark, 1.5), `${rec?.entryMark}`);
    ok('pcs: joined contractId', rec?.contractId === `${SHORT_ID}+${LONG_ID}`, `${rec?.contractId}`);
    ok('pcs: net entryDelta', approx(rec?.entryDelta, -0.15), `${rec?.entryDelta}`);
    ok('pcs: one trade per exit doc', e.written.every((w) => w.doc.trades.length === 1));
    const t90 = trades(e.written, 'target-90')[0];
    ok('pcs: target-90 fired on the net series', t90?.outcome === 'exit');
  }

  // v1 doc → same records as the equivalent 1-leg v2 doc (narrowing parity).
  {
    const series = { [SHORT_ID]: resp(SHORT_ID, [['2026-01-05', '2.0'], [EXPIRY, '0']]) };
    const closes = { [EXPIRY]: 495 };
    const e1 = env({ doc: v1Doc(), series, closes });
    const e2 = env({ doc: v2Doc([posRow([leg({})])]), series, closes });
    await runReplayAnalysis(payload, e1.deps, false);
    await runReplayAnalysis(payload, e2.deps, false);
    ok(
      'v1→v2: identical trades on every exit doc',
      EXIT_STRATEGIES.every(
        (r) =>
          JSON.stringify(trades(e1.written, r.exitId)) ===
          JSON.stringify(trades(e2.written, r.exitId)),
      ),
    );
    ok('v1→v2: all docs success', e1.written.every((w) => w.doc.status === 'success'));
  }

  // Calendar spread — frozen settlement + nearest-living dte exit.
  {
    const SHORT_EXP = '2026-01-30';
    const e = env({
      doc: v2Doc([posRow([
        leg({ side: TradeSide.SHORT, contractId: SHORT_ID, expiration: SHORT_EXP, mark: 2.0 }),
        leg({ side: TradeSide.LONG, contractId: LONG_ID, expiration: EXPIRY, strike: 490, mark: 0.5 }),
      ])]),
      series: {
        [SHORT_ID]: resp(SHORT_ID, [['2026-01-05', '2.0'], ['2026-01-09', '1.9'], [SHORT_EXP, '4.9']], { expiration: SHORT_EXP, endDate: SHORT_EXP }),
        [LONG_ID]: resp(LONG_ID, [['2026-01-05', '0.5'], ['2026-01-09', '0.48'], ['2026-02-04', '0.4'], [EXPIRY, '0']]),
      },
      closes: { [SHORT_EXP]: 495, [EXPIRY]: 495 },
    });
    await runReplayAnalysis(payload, e.deps, false);
    const dte = trades(e.written, 'dte-21')[0];
    ok('calendar: dte-21 fired vs the NEAREST living leg', dte?.outcome === 'exit' && dte.exitDate === '2026-01-09', `${dte?.outcome} ${dte?.outcome === 'exit' ? dte.exitDate : ''}`);
    const exp = trades(e.written, 'expiry')[0];
    ok('calendar: expired at LAST leg expiry', exp?.outcome === 'expired' && exp.daysHeld === 46, `${exp?.outcome}`);
    if (exp?.outcome === 'expired') {
      ok('calendar: net intrinsic = short 5 − long 0', approx(exp.intrinsicAtExpiry, 5), `${exp.intrinsicAtExpiry}`);
      ok('calendar: expiredItm on net liability', exp.expiredItm === true);
      ok('calendar: mae spans the frozen window (net 4.6 on 02-04)', exp.mae.value >= 4.6, `${exp.mae.value}`);
    }
  }

  // Stock leg — covered call marks off the close map.
  {
    const e = env({
      doc: v2Doc([posRow([
        leg({ side: TradeSide.SHORT, contractId: SHORT_ID, coordinate: { ...COORD, type: OptionType.CALL } }),
        { kind: 'stock', side: TradeSide.LONG, underlyingClose: 520 },
      ])]),
      series: { [SHORT_ID]: resp(SHORT_ID, [['2026-01-05', '2.0'], [EXPIRY, '0.1']], { type: 'call' }) },
      closes: { '2026-01-05': 520, [EXPIRY]: 521 },
    });
    await runReplayAnalysis(payload, e.deps, false);
    ok('cov: option leg fetched once, stock leg never fetched', e.fetchCalls.length === 1);
    const rec = trades(e.written, 'expiry')[0];
    // Debit posture (CTC −518) → the record flips onto liquidation
    // value: +518 entry, settlement flips to +500 → expiredItm.
    ok('cov: net entry flips to liquidation value +518', approx(rec?.entryMark, 518), `${rec?.entryMark}`);
    ok('cov: entryIv absent (stock carries none)', rec?.entryIv === undefined);
    if (rec?.outcome === 'expired') {
      ok('cov: net intrinsic flips to +500 (settled with value)', approx(rec.intrinsicAtExpiry, 500), `${rec.intrinsicAtExpiry}`);
      ok('cov: expiredItm true (package worth something)', rec.expiredItm === true);
    } else {
      ok('cov: expired outcome', false, `${rec?.outcome}`);
    }
  }

  // Leg failure → error records under every exit; entry fields still real.
  {
    const e = env({
      doc: v2Doc([posRow([
        leg({ side: TradeSide.SHORT, contractId: SHORT_ID }),
        leg({ side: TradeSide.LONG, contractId: LONG_ID, mark: 0.5 }),
      ])]),
      series: {
        [SHORT_ID]: resp(SHORT_ID, [['2026-01-05', '2.0'], [EXPIRY, '0']]),
        [LONG_ID]: new Error('SA 500'),
      },
    });
    await runReplayAnalysis(payload, e.deps, false);
    const errs = trades(e.written, 'expiry');
    ok('leg-fail: error record under every exit', errs.length === 1 && errs[0].outcome === 'error' && /leg 1/.test(errs[0].error));
    ok('leg-fail: real entryMark on the error record', approx(errs[0].entryMark, 1.5), `${errs[0].entryMark}`);
    ok('leg-fail: doc still success', e.written.every((w) => w.doc.status === 'success'));
  }

  // no-selection + missing settlement close.
  {
    const e = env({
      doc: v2Doc([
        { kind: 'no-selection', entryDate: '2026-01-05', reason: 'miss', legMisses: [{ legIndex: 0, coordinate: COORD, reason: 'miss' }] },
        posRow([
          leg({ side: TradeSide.SHORT, contractId: SHORT_ID, expiration: '2026-01-30' }),
          leg({ side: TradeSide.LONG, contractId: LONG_ID, expiration: EXPIRY }),
        ], '2026-01-06'),
      ]),
      series: {
        [SHORT_ID]: resp(SHORT_ID, [['2026-01-06', '2.0'], ['2026-01-30', '1.0']], { expiration: '2026-01-30', endDate: '2026-01-30' }),
        [LONG_ID]: resp(LONG_ID, [['2026-01-06', '0.5'], [EXPIRY, '0']]),
      },
      closes: { [EXPIRY]: 520 }, // 01-30 close missing → settlement unpriceable
    });
    await runReplayAnalysis(payload, e.deps, false);
    const recs = trades(e.written, 'expiry');
    ok('mixed: no-selection row contributes no record', recs.length === 1);
    ok('mixed: missing expiry close → error not fabrication', recs[0].outcome === 'error' && /underlying close/i.test(recs[0].error), `${recs[0].outcome}`);
  }
}

// ==========================
// LIVE — real v2 list doc + prodAnalysisDeps (real SA fetch + Firestore)
// ==========================

async function live(): Promise<void> {
  console.log('LIVE — real v2 list doc + prodAnalysisDeps (real SA series fetch + Firestore writes)');
  const db = getFirestore();
  const listCol = db.collection(ST_OPTIONS_CONTRACT_LISTS_ROOT);
  const resCol = db.collection(ST_OPTIONS_ANALYSIS_RESULTS_ROOT);

  // Source material: the newest verify-1499 multi-leg list doc — real
  // SPY position rows with real contractIds. (orderBy alone — a
  // where+orderBy on different fields would demand a composite index.)
  const snap = await listCol.orderBy('generatedAt', 'desc').limit(50).get();
  const src = snap.docs
    .map((d) => ({ id: d.id, ...d.data() }) as OptionsContractListDoc & { id: string })
    .find(
      (d) =>
        d.id.startsWith('verify-1499-') &&
        d.status === 'success' &&
        d.schemaVersion === 2 &&
        d.legMetas.length > 1,
    );
  ok('found a verify-1499 multi-leg list doc', !!src);
  if (!src) return;
  console.log(`  source doc ${src.id} — ${src.rows.length} rows, ${src.legMetas.length} leg metas`);

  const positions = src.rows.filter((r): r is ContractListPositionRow => r.kind === 'position').slice(0, 3);
  ok('source has ≥1 position row to truncate to', positions.length >= 1, `${positions.length}`);
  if (positions.length === 0) return;

  const docId = `verify-1500-${Date.now()}`;
  const seedDoc: OptionsContractListDoc = {
    runId: docId,
    symbol: src.symbol,
    templateId: src.templateId,
    status: 'success',
    schemaVersion: 2,
    rows: positions,
    legMetas: src.legMetas,
    generatedAt: new Date().toISOString(),
  };
  await listCol.doc(docId).set(seedDoc);
  ok(`seeded ${docId} (${positions.length} real position rows)`, true);

  await runReplayAnalysis(
    {
      contractListDocId: docId,
      runId: docId,
      symbol: src.symbol,
      templateId: src.templateId,
      registryVersion: EXIT_REGISTRY_VERSION,
    },
    prodAnalysisDeps,
    true,
  );

  const written = await resCol.where('contractListDocId', '==', docId).get();
  ok('one result doc per registered exit', written.size === EXIT_STRATEGIES.length, `${written.size}`);
  const docs = written.docs.map((d) => d.data() as AnalysisResultDoc);
  ok('all result docs success', docs.every((d) => d.status === 'success'), docs.map((d) => `${d.exitId}:${d.status}`).join(','));
  ok('every doc carries the seeded position count', docs.every((d) => d.aggregate.contractCount === positions.length));
  const allTrades = docs.flatMap((d) => d.trades);
  ok(
    'every trade is a real outcome',
    allTrades.length === positions.length * EXIT_STRATEGIES.length &&
      allTrades.every((t) => ['exit', 'expired', 'open', 'error'].includes(t.outcome)),
    `${allTrades.length}`,
  );
  const outcomes = new Set(allTrades.map((t) => t.outcome));
  ok('records carry real outcomes (not all-error)', [...outcomes].some((o) => o !== 'error'), [...outcomes].join(','));
  // Net-mark sanity on a 2-leg doc: entryMark ≈ short − long legs.
  const first = positions[0];
  const optLegs = first.legs.filter((l) => l.kind === 'option');
  if (optLegs.length === 2) {
    const expected =
      first.legs.reduce(
        (acc, l) =>
          acc + (l.side === TradeSide.SHORT ? 1 : -1) * (l.kind === 'option' ? l.mark : l.underlyingClose),
        0,
      );
    const rec = allTrades.find((t) => t.pickDate === first.entryDate);
    ok('net entryMark matches signed leg marks', approx(rec?.entryMark, expected), `${rec?.entryMark} vs ${expected}`);
    ok('joined contractId carries both legs', (rec?.contractId ?? '').includes('+') === (optLegs.length > 1), `${rec?.contractId}`);
  }
  console.log(`  outcomes: ${[...outcomes].join(', ')} — docs at st-options-analysis-results/${docId}_*`);
}

// ==========================

dry()
  .then(() => (LIVE ? live() : Promise.resolve()))
  .then(() => {
    console.log(`\n${passed} pass, ${failed} FAIL`);
    process.exit(failed ? 1 : 0);
  })
  .catch((e) => {
    console.error('verify crashed:', e);
    process.exit(1);
  });
