/**
 * @topic #137 — Strategy Manager (task #1713)
 *
 * Per-tick shadow exit-eval: every successfully-marked OPEN option position
 * with a manage-instance link is evaluated against all 6 EXIT_STRATEGIES on
 * the tick's fresh order-exit-price mark. First-fire state (firstFiredAt +
 * firstFiredMark) accumulates into st-options-analysis-results/{instanceId}_{exitId}
 * via merge writes — sticky across ticks and restarts, never clobbered by the
 * 2 PM scan (which carries the fields forward). Analytics-only: no close
 * writes ever happen here.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { runShadowEvalTick } from '../../../functions/src/options-strategy-engine/passes/shadow-eval-pass';
import type {
  ShadowEvalDeps,
  ShadowEvalPositionInput,
} from '../../../functions/src/options-strategy-engine/passes/shadow-eval-pass';
import { OptionType, OptionQuoteSource } from '../../../shared/options-common';
import { TradeSide } from '../../../shared/common';
import {
  PaperTradingKind,
  PaperTradeSource,
  PaperTradeStatus,
} from '../../../shared/paper-trading-contracts';
import type {
  PaperTrade,
  PaperTradeLeg,
} from '../../../shared/paper-trading-contracts';
import type {
  AnalysisResultDoc,
  AnalysisTradeRecord,
} from '../../../shared/options-analysis-contracts';
import { EXIT_STRATEGIES, EXIT_REGISTRY_VERSION } from '../../../shared/options-analysis-registry';
import { stOptionsAnalysisResultDocId } from '../../../shared/st-collections';

// ── Fixtures ─────────────────────────────────────────────────────────────────

const INSTANCE_ID = 'SPY-CSP-30-50-N-20251110';
const MARKET_DATE = '2025-11-24';
const TICK_AT = '2025-11-24T18:20:00.000Z';

function makeOptionLeg(
  overrides: Partial<Extract<PaperTradeLeg, { kind: 'option' }>> = {},
): PaperTradeLeg {
  return {
    kind: 'option',
    id: 'PUT-600.00-2026-03-20',
    contractID: 'SPY260320P00600000',
    type: OptionType.PUT,
    side: TradeSide.SHORT,
    strike: 600,
    expiration: '2026-03-20', // ~116 days out — dte-21 never fires
    quantity: 1,
    multiplier: 100,
    entryMark: 2.0,
    lastMark: 2.0,
    openDate: '2025-11-20',
    ...overrides,
  };
}

function makeTrade(overrides: Partial<PaperTrade> = {}): PaperTrade {
  return {
    kind: PaperTradingKind.TRADE,
    id: `${INSTANCE_ID}-2025-11-20`,
    status: PaperTradeStatus.OPEN,
    source: PaperTradeSource.STRATEGY,
    symbol: 'SPY',
    expression: 'CSP',
    governingVariant: 'none',
    strategyInstanceId: INSTANCE_ID,
    order: { side: TradeSide.SHORT, type: 'MARKET', quantity: 1 },
    fills: [
      {
        fillId: 'entry-1',
        role: 'entry',
        date: '2025-11-20',
        price: 2.0,
        quantity: 1,
        quoteSource: OptionQuoteSource.RH_MCP,
      },
    ],
    legs: [makeOptionLeg()],
    marks: {},
    variantRuns: [],
    variantKeys: [],
    realizedPnl: 0,
    unrealizedPnl: 0,
    createdAt: '2025-11-20T00:00:00Z',
    updatedAt: '2025-11-20T00:00:00Z',
    ...overrides,
  };
}

/** In-memory analysis-doc store — the Firestore seam. */
function makeStore(seed: Record<string, AnalysisResultDoc> = {}) {
  const docs = new Map<string, AnalysisResultDoc>(Object.entries(seed));
  const deps: ShadowEvalDeps = {
    readResultDoc: async (docId) => docs.get(docId) ?? null,
    writeResultDoc: async (docId, doc) => {
      docs.set(docId, doc);
    },
    now: () => new Date(TICK_AT),
    marketDate: MARKET_DATE,
  };
  return { deps, docs };
}

const input = (trade: PaperTrade, mark: number): ShadowEvalPositionInput => ({
  trade,
  mark,
});

const recordOf = (
  docs: Map<string, AnalysisResultDoc>,
  exitId: string,
  positionId: string,
): AnalysisTradeRecord | undefined =>
  docs
    .get(stOptionsAnalysisResultDocId(INSTANCE_ID, exitId))
    ?.trades.find((t) => t.contractId === positionId);

// ── runShadowEvalTick ────────────────────────────────────────────────────────

describe('runShadowEvalTick', () => {
  it('evaluates all 6 registry rules per marked position — one doc per (instance, exitId)', async () => {
    const { deps, docs } = makeStore();
    const summary = await runShadowEvalTick([input(makeTrade(), 1.5)], deps);

    assert.equal(docs.size, EXIT_STRATEGIES.length);
    for (const rule of EXIT_STRATEGIES) {
      const doc = docs.get(stOptionsAnalysisResultDocId(INSTANCE_ID, rule.exitId));
      assert.ok(doc, `missing doc for ${rule.exitId}`);
      assert.equal(doc.contractListDocId, INSTANCE_ID);
      assert.equal(doc.runId, INSTANCE_ID);
      assert.equal(doc.symbol, 'SPY');
      assert.equal(doc.exitId, rule.exitId);
      assert.equal(doc.registryVersion, EXIT_REGISTRY_VERSION);
      assert.equal(doc.status, 'success');
      assert.equal(doc.trades.length, 1);
      assert.equal(doc.trades[0].exitId, rule.exitId);
      assert.equal(doc.trades[0].entryMark, 2.0);
    }
    assert.equal(summary.positions, 1);
    assert.equal(summary.evaluated, EXIT_STRATEGIES.length);
    assert.equal(summary.docsWritten, EXIT_STRATEGIES.length);
  });

  it('stamps firstFiredAt + firstFiredMark and exits when a rule fires', async () => {
    const { deps, docs } = makeStore();
    // mark 0.15 ≤ 0.20 = 2.0×(1−0.9) → target-90 fires; ≤1.0 → price-100 too
    const summary = await runShadowEvalTick([input(makeTrade(), 0.15)], deps);

    const rec = recordOf(docs, 'target-90', makeTrade().id);
    assert.equal(rec?.outcome, 'exit');
    if (rec?.outcome === 'exit') {
      assert.equal(rec.exitDate, MARKET_DATE);
      assert.equal(rec.exitPrice, 0.15);
      assert.equal(rec.terminalMark, 0.15);
    }
    assert.equal(rec?.firstFiredAt, TICK_AT);
    assert.equal(rec?.firstFiredMark, 0.15);
    assert.equal(rec?.daysHeld, 4); // 11-20 → 11-24
    assert.equal(summary.fires, 3); // target-90 + price-100 + price-50 all cross at 0.15
  });

  it('first-fire is sticky — a later tick never moves firstFiredAt/firstFiredMark or exit fields', async () => {
    const store = makeStore();
    const trade = makeTrade();
    await runShadowEvalTick([input(trade, 0.15)], store.deps);

    const later: ShadowEvalDeps = { ...store.deps, now: () => new Date('2025-11-24T19:00:00.000Z') };
    await runShadowEvalTick([input(trade, 0.10)], later);

    const rec = recordOf(store.docs, 'target-90', trade.id);
    assert.equal(rec?.outcome, 'exit');
    assert.equal(rec?.firstFiredAt, TICK_AT);
    assert.equal(rec?.firstFiredMark, 0.15);
    if (rec?.outcome === 'exit') {
      assert.equal(rec.exitPrice, 0.15); // frozen at first fire
    }
  });

  it('same-tick re-run is idempotent — identical docs', async () => {
    const store = makeStore();
    const trade = makeTrade();
    await runShadowEvalTick([input(trade, 0.15)], store.deps);
    const first = JSON.stringify(store.docs.get(stOptionsAnalysisResultDocId(INSTANCE_ID, 'target-90')));
    await runShadowEvalTick([input(trade, 0.15)], store.deps);
    const second = JSON.stringify(store.docs.get(stOptionsAnalysisResultDocId(INSTANCE_ID, 'target-90')));
    assert.equal(second, first);
  });

  it('not-fired rules write open records that refresh each tick', async () => {
    const { deps, docs } = makeStore();
    const trade = makeTrade();
    await runShadowEvalTick([input(trade, 1.5)], deps); // nothing fires

    let rec = recordOf(docs, 'target-90', trade.id);
    assert.equal(rec?.outcome, 'open');
    if (rec?.outcome === 'open') {
      assert.equal(rec.lastBarDate, MARKET_DATE);
    }
    assert.equal(rec?.terminalMark, 1.5);
    assert.equal(rec?.firstFiredAt, undefined);

    // Next tick at a worse mark — open record refreshes + folds excursion
    const later: ShadowEvalDeps = { ...deps, now: () => new Date('2025-11-24T19:00:00.000Z') };
    await runShadowEvalTick([input(trade, 2.5)], later);
    rec = recordOf(docs, 'target-90', trade.id);
    assert.equal(rec?.outcome, 'open');
    assert.equal(rec?.terminalMark, 2.5);
    assert.equal(rec?.mae.value, 2.5); // worst cost-to-close so far
    assert.equal(rec?.mfe.value, 1.5); // best — folded across ticks
  });

  it('a prior exit record is terminal — the tick never resurrects it to open', async () => {
    const docId = stOptionsAnalysisResultDocId(INSTANCE_ID, 'target-90');
    const prior: AnalysisResultDoc = {
      contractListDocId: INSTANCE_ID,
      runId: INSTANCE_ID,
      symbol: 'SPY',
      templateId: 'csp',
      exitId: 'target-90',
      registryVersion: EXIT_REGISTRY_VERSION,
      status: 'success',
      generatedAt: '2025-11-23T21:00:00.000Z',
      trades: [
        {
          runId: INSTANCE_ID,
          symbol: 'SPY',
          templateId: 'csp',
          contractListDocId: INSTANCE_ID,
          exitId: 'target-90',
          pickDate: '2025-11-20',
          contractId: makeTrade().id,
          entryMark: 2.0,
          outcome: 'exit',
          exitDate: '2025-11-23',
          exitPrice: 0.4,
          terminalMark: 0.4,
          daysHeld: 3,
          mae: { value: 2.0, date: '2025-11-20' },
          mfe: { value: 0.4, date: '2025-11-23' },
        },
      ],
      aggregate: {
        exitId: 'target-90',
        contractCount: 1,
        exitedCount: 1,
        expiredCount: 0,
        openCount: 0,
        errorCount: 0,
      },
    };
    const { deps, docs } = makeStore({ [docId]: prior });
    // mark recovered above the threshold — but the exit already happened
    const summary = await runShadowEvalTick([input(makeTrade(), 1.5)], deps);

    const rec = recordOf(docs, 'target-90', makeTrade().id);
    assert.equal(rec?.outcome, 'exit');
    if (rec?.outcome === 'exit') assert.equal(rec.exitPrice, 0.4);
    assert.equal(summary.fires, 0);
  });

  it('a re-cross after the scan rewrote outcome to open keeps the ORIGINAL first-fire', async () => {
    // Scenario: tick fired 11-23 intraday → EOD scan rebuilt 'open' (daily
    // series never crossed) but carried firstFired* forward → next tick
    // crossing must resolve at the original fire, not stamp a second one.
    const docId = stOptionsAnalysisResultDocId(INSTANCE_ID, 'target-90');
    const prior: AnalysisResultDoc = {
      contractListDocId: INSTANCE_ID,
      runId: INSTANCE_ID,
      symbol: 'SPY',
      templateId: 'csp',
      exitId: 'target-90',
      registryVersion: EXIT_REGISTRY_VERSION,
      status: 'success',
      generatedAt: '2025-11-23T21:30:00.000Z',
      trades: [
        {
          runId: INSTANCE_ID,
          symbol: 'SPY',
          templateId: 'csp',
          contractListDocId: INSTANCE_ID,
          exitId: 'target-90',
          pickDate: '2025-11-20',
          contractId: makeTrade().id,
          entryMark: 2.0,
          outcome: 'open',
          lastBarDate: '2025-11-23',
          terminalMark: 0.4,
          daysHeld: 3,
          mae: { value: 2.0, date: '2025-11-20' },
          mfe: { value: 0.15, date: '2025-11-23' },
          firstFiredAt: '2025-11-23T18:20:00.000Z',
          firstFiredMark: 0.15,
        },
      ],
      aggregate: {
        exitId: 'target-90',
        contractCount: 1,
        exitedCount: 0,
        expiredCount: 0,
        openCount: 1,
        errorCount: 0,
      },
    };
    const { deps, docs } = makeStore({ [docId]: prior });
    const summary = await runShadowEvalTick([input(makeTrade(), 0.10)], deps);

    const rec = recordOf(docs, 'target-90', makeTrade().id);
    assert.equal(rec?.outcome, 'exit');
    assert.equal(rec?.firstFiredAt, '2025-11-23T18:20:00.000Z'); // original
    assert.equal(rec?.firstFiredMark, 0.15);
    if (rec?.outcome === 'exit') {
      assert.equal(rec.exitDate, '2025-11-23'); // the real fire date
      assert.equal(rec.exitPrice, 0.15);
      assert.equal(rec.terminalMark, 0.15); // resolves at the fire mark, not the re-cross mark
      assert.equal(rec.daysHeld, 3);
    }
    // mark 0.10 also crosses price-100 + price-50 fresh — those count;
    // target-90's re-cross must not add a second "first" fire.
    assert.equal(summary.fires, 2);
  });

  it('skips positions with share legs — counted, no writes (scan parity)', async () => {
    const { deps, docs } = makeStore();
    const coveredCall = makeTrade({
      legs: [
        makeOptionLeg({ type: OptionType.CALL }),
        { kind: 'share', id: 'SHARE-SPY', side: TradeSide.LONG, quantity: 100 } as PaperTradeLeg,
      ],
    });
    const summary = await runShadowEvalTick([input(coveredCall, 0.15)], deps);

    assert.equal(docs.size, 0);
    assert.equal(summary.positions, 0);
    assert.equal(summary.skippedNonOption, 1);
  });

  it('a tick landing past expiration carries the prior record — writes none for a new position', async () => {
    const expiring = makeTrade({
      legs: [makeOptionLeg({ expiration: '2025-11-22' })], // < MARKET_DATE 11-24
    });
    const { deps: freshDeps, docs: freshDocs } = makeStore();
    await runShadowEvalTick([input(expiring, 0.10)], freshDeps);
    assert.equal(recordOf(freshDocs, 'target-90', expiring.id), undefined);

    // With a prior 'open' record the prior survives verbatim — no
    // lastBarDate past expiry is stamped.
    const docId = stOptionsAnalysisResultDocId(INSTANCE_ID, 'target-90');
    const priorRec: AnalysisTradeRecord = {
      runId: INSTANCE_ID,
      symbol: 'SPY',
      templateId: 'csp',
      contractListDocId: INSTANCE_ID,
      exitId: 'target-90',
      pickDate: '2025-11-20',
      contractId: expiring.id,
      entryMark: 2.0,
      outcome: 'open',
      lastBarDate: '2025-11-21',
      terminalMark: 0.8,
      daysHeld: 1,
      mae: { value: 2.0, date: '2025-11-20' },
      mfe: { value: 0.8, date: '2025-11-21' },
    };
    const prior: AnalysisResultDoc = {
      contractListDocId: INSTANCE_ID,
      runId: INSTANCE_ID,
      symbol: 'SPY',
      templateId: 'csp',
      exitId: 'target-90',
      registryVersion: EXIT_REGISTRY_VERSION,
      status: 'success',
      generatedAt: '2025-11-21T21:00:00.000Z',
      trades: [priorRec],
      aggregate: {
        exitId: 'target-90',
        contractCount: 1,
        exitedCount: 0,
        expiredCount: 0,
        openCount: 1,
        errorCount: 0,
      },
    };
    const { deps, docs } = makeStore({ [docId]: prior });
    await runShadowEvalTick([input(expiring, 0.10)], deps);

    const rec = recordOf(docs, 'target-90', expiring.id);
    assert.equal(rec?.outcome, 'open');
    if (rec?.outcome === 'open') assert.equal(rec.lastBarDate, '2025-11-21'); // unchanged
  });

  it('legs without entryMark write error records', async () => {
    const trade = makeTrade({ legs: [makeOptionLeg({ entryMark: undefined })] });
    const { deps, docs } = makeStore();
    await runShadowEvalTick([input(trade, 0.15)], deps);

    const rec = recordOf(docs, 'target-90', trade.id);
    assert.equal(rec?.outcome, 'error');
    if (rec?.outcome === 'error') assert.match(rec.error, /missing entry mark/);
  });

  it('skips positions with no strategyInstanceId — counted, no writes', async () => {
    const { deps, docs } = makeStore();
    const legacy = makeTrade({ strategyInstanceId: undefined });
    const summary = await runShadowEvalTick([input(legacy, 0.15)], deps);

    assert.equal(docs.size, 0);
    assert.equal(summary.positions, 0);
    assert.equal(summary.skippedNoInstance, 1);
  });

  it('multi-expiry positions write error records (scan parity)', async () => {
    const trade = makeTrade({
      legs: [
        makeOptionLeg(),
        makeOptionLeg({
          id: 'PUT-500.00-2026-06-19',
          contractID: 'SPY260619P00500000',
          side: TradeSide.LONG,
          strike: 500,
          expiration: '2026-06-19',
        }),
      ],
    });
    const { deps, docs } = makeStore();
    await runShadowEvalTick([input(trade, 0.15)], deps);

    const rec = recordOf(docs, 'target-90', trade.id);
    assert.equal(rec?.outcome, 'error');
    if (rec?.outcome === 'error') {
      assert.match(rec.error, /multi-expiry/);
    }
  });

  it('positions already in the doc but unmarked this tick carry forward', async () => {
    const otherId = 'other-position';
    const docId = stOptionsAnalysisResultDocId(INSTANCE_ID, 'target-90');
    const prior: AnalysisResultDoc = {
      contractListDocId: INSTANCE_ID,
      runId: INSTANCE_ID,
      symbol: 'SPY',
      templateId: 'csp',
      exitId: 'target-90',
      registryVersion: EXIT_REGISTRY_VERSION,
      status: 'success',
      generatedAt: '2025-11-23T21:00:00.000Z',
      trades: [
        {
          runId: INSTANCE_ID,
          symbol: 'SPY',
          templateId: 'csp',
          contractListDocId: INSTANCE_ID,
          exitId: 'target-90',
          pickDate: '2025-11-19',
          contractId: otherId,
          entryMark: 1.0,
          outcome: 'open',
          lastBarDate: '2025-11-23',
          terminalMark: 0.8,
          daysHeld: 4,
          mae: { value: 1.0, date: '2025-11-19' },
          mfe: { value: 0.8, date: '2025-11-23' },
        },
      ],
      aggregate: {
        exitId: 'target-90',
        contractCount: 1,
        exitedCount: 0,
        expiredCount: 0,
        openCount: 1,
        errorCount: 0,
      },
    };
    const { deps, docs } = makeStore({ [docId]: prior });
    await runShadowEvalTick([input(makeTrade(), 1.5)], deps);

    const doc = docs.get(docId);
    assert.equal(doc?.trades.length, 2);
    const other = doc?.trades.find((t) => t.contractId === otherId);
    assert.equal(other?.outcome, 'open');
    assert.equal(other?.terminalMark, 0.8); // untouched
  });

  it('dte-time fires on the calendar, not the mark', async () => {
    const nearExpiry = makeTrade({
      legs: [makeOptionLeg({ expiration: '2025-12-10' })], // 16 days out ≤ 21
    });
    const { deps, docs } = makeStore();
    await runShadowEvalTick([input(nearExpiry, 1.5)], deps);

    const rec = recordOf(docs, 'dte-21', nearExpiry.id);
    assert.equal(rec?.outcome, 'exit');
    assert.equal(rec?.firstFiredAt, TICK_AT);
  });

  it('LONG orders read entryMark in posture-normalized space (positive debit)', async () => {
    const debit = makeTrade({
      order: { side: TradeSide.LONG, type: 'MARKET', quantity: 1 },
      legs: [
        makeOptionLeg({ side: TradeSide.LONG, strike: 600, entryMark: 2.4 }),
        makeOptionLeg({
          id: 'PUT-500.00-2026-03-20',
          contractID: 'SPY260320P00500000',
          side: TradeSide.SHORT,
          strike: 500,
          entryMark: 0.9,
        }),
      ],
    });
    const { deps, docs } = makeStore();
    await runShadowEvalTick([input(debit, 1.3)], deps); // mark = sale proceeds

    const rec = recordOf(docs, 'stop-200', debit.id);
    // entryMark = |(−0.9 + 2.4)| = 1.5 debit paid — posture-normalized ≥ 0
    assert.equal(rec?.entryMark, 1.5);
    // stop threshold = 1.5×2 = 3.0 → mark 1.3 doesn't fire
    assert.equal(rec?.outcome, 'open');
  });

  it('a write failure on one doc does not abort other rule docs', async () => {
    const failingDocId = stOptionsAnalysisResultDocId(INSTANCE_ID, 'target-90');
    const { deps, docs } = makeStore();
    deps.writeResultDoc = async (docId, doc) => {
      if (docId === failingDocId) throw new Error('firestore down');
      docs.set(docId, doc);
    };

    const summary = await runShadowEvalTick([input(makeTrade(), 1.5)], deps);
    assert.equal(summary.errors.length, 1);
    assert.equal(docs.size, EXIT_STRATEGIES.length - 1);
  });

  it('expired records are terminal — never rewritten as open by a later tick', async () => {
    const docId = stOptionsAnalysisResultDocId(INSTANCE_ID, 'expiry');
    const prior: AnalysisResultDoc = {
      contractListDocId: INSTANCE_ID,
      runId: INSTANCE_ID,
      symbol: 'SPY',
      templateId: 'csp',
      exitId: 'expiry',
      registryVersion: EXIT_REGISTRY_VERSION,
      status: 'success',
      generatedAt: '2025-11-23T21:00:00.000Z',
      trades: [
        {
          runId: INSTANCE_ID,
          symbol: 'SPY',
          templateId: 'csp',
          contractListDocId: INSTANCE_ID,
          exitId: 'expiry',
          pickDate: '2025-11-20',
          contractId: makeTrade().id,
          entryMark: 2.0,
          outcome: 'expired',
          expiredItm: false,
          intrinsicAtExpiry: 0,
          assignmentDistancePct: 5.5,
          terminalMark: 0,
          daysHeld: 3,
          mae: { value: 2.0, date: '2025-11-20' },
          mfe: { value: 0.1, date: '2025-11-23' },
        },
      ],
      aggregate: {
        exitId: 'expiry',
        contractCount: 1,
        exitedCount: 0,
        expiredCount: 1,
        openCount: 0,
        errorCount: 0,
      },
    };
    const { deps, docs } = makeStore({ [docId]: prior });
    await runShadowEvalTick([input(makeTrade(), 1.5)], deps);

    const rec = recordOf(docs, 'expiry', makeTrade().id);
    assert.equal(rec?.outcome, 'expired');
    if (rec?.outcome === 'expired') assert.equal(rec.intrinsicAtExpiry, 0);
  });
});
