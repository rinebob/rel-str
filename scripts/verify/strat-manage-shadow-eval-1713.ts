/**
 * Verification: per-tick shadow exit-eval (task #1713).
 *
 * Exercises the REAL eval tick end-to-end with only I/O faked at the
 * declared seams (`readResultDoc`/`writeResultDoc` — an in-memory analysis-
 * doc store): instance grouping, all-6-rule evaluation on the tick mark
 * through the shared `evaluateExit`, firstFiredAt/firstFiredMark
 * accumulation + stickiness, terminal-outcome freezing, open-record
 * excursion folding, multi-expiry error records, no-instance skips, and
 * doc merge (no clobbering of the EOD scan's shape) — all through
 * production code. Also pins `runUnifiedMarkPass`'s {trade, mark} handoff
 * and the EOD scan's first-fire carry-forward.
 *
 * Importing the modules runs `firebase-admin-init` (parameterless
 * `initializeApp()` — no credentials needed; no Firestore call is made).
 *
 * Usage: npx tsx scripts/verify/strat-manage-shadow-eval-1713.ts
 *
 * Pass: every check prints OK and the script exits 0.
 * Fail: the offending check prints FAIL with detail; exit 1.
 */

import { runShadowEvalTick } from '../../functions/src/paper-trading/engine/passes/shadow-eval-pass';
import type { ShadowEvalDeps } from '../../functions/src/paper-trading/engine/passes/shadow-eval-pass';
import { runUnifiedMarkPass } from '../../functions/src/paper-trading/engine/options-strategy-pass-orchestrators';
import { runManageExitScan } from '../../functions/src/paper-trading/engine/passes/manage-exit-scan-pass';
import type { ManageOpenPosition } from '../../functions/src/paper-trading/engine/passes/manage-exit-scan-pass';
import type { MarkPassResult } from '../../functions/src/paper-trading/engine/passes/mark-pass';
import { OptionType, OptionQuoteSource } from '@options/common';
import { TradeSide } from '@common';
import {
  PaperTradingKind,
  PaperTradeSource,
  PaperTradeStatus,
} from '@paper-trading/contracts';
import type { PaperTrade, PaperTradeLeg } from '@paper-trading/contracts';
import type { AnalysisResultDoc } from '@options-analysis/contracts';
import {
  EXIT_STRATEGIES,
  EXIT_REGISTRY_VERSION,
} from '@options-analysis/registry';
import { stOptionsAnalysisResultDocId } from '@st/collections';
import { PositionStatus } from '../../functions/src/paper-trading/engine/types';
import type { PositionLeg } from '../../functions/src/paper-trading/engine/types';
import type { RunnableManageInstance } from '../../functions/src/paper-trading/engine/manage-instance-reader';

let failures = 0;
function check(name: string, actual: unknown, expected: unknown): void {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  console.log(`${ok ? 'OK  ' : 'FAIL'} ${name}: ${JSON.stringify(actual)}`);
  if (!ok) {
    console.log(`     expected: ${JSON.stringify(expected)}`);
    failures++;
  }
}

// ── Fixtures ────────────────────────────────────────────────────────────

const INSTANCE_ID = 'SPY-CSP-30-50-N-20251110';
const MARKET_DATE = '2025-11-24';
const TICK = '2025-11-24T18:20:00.000Z';

function optionLeg(
  overrides: Partial<Extract<PaperTradeLeg, { kind: 'option' }>> = {},
): PaperTradeLeg {
  return {
    kind: 'option',
    id: 'leg-1',
    contractID: 'SPY260320P00600000',
    type: OptionType.PUT,
    side: TradeSide.SHORT,
    strike: 600,
    expiration: '2026-03-20',
    quantity: 1,
    multiplier: 100,
    entryMark: 2.0,
    lastMark: 2.0,
    openDate: '2025-11-20',
    ...overrides,
  };
}

function trade(overrides: Partial<PaperTrade> = {}): PaperTrade {
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
    legs: [optionLeg()],
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

function store(seed: Record<string, AnalysisResultDoc> = {}) {
  const docs = new Map<string, AnalysisResultDoc>(Object.entries(seed));
  const deps: ShadowEvalDeps = {
    readResultDoc: async (id) => docs.get(id) ?? null,
    writeResultDoc: async (id, doc) => {
      docs.set(id, doc);
    },
    now: () => new Date(TICK),
    marketDate: MARKET_DATE,
  };
  return { deps, docs };
}

const doc = (docs: Map<string, AnalysisResultDoc>, exitId: string) =>
  docs.get(stOptionsAnalysisResultDocId(INSTANCE_ID, exitId));
const rec = (docs: Map<string, AnalysisResultDoc>, exitId: string, posId: string) =>
  doc(docs, exitId)?.trades.find((t) => t.contractId === posId);

// ── Checks ──────────────────────────────────────────────────────────────

async function main() {
  // 1. All 6 rules evaluated per marked position → one doc per exitId
  {
    const { deps, docs } = store();
    const s = await runShadowEvalTick([{ trade: trade(), mark: 1.5 }], deps);
    check('one doc per registry rule', docs.size, EXIT_STRATEGIES.length);
    const t90 = doc(docs, 'target-90');
    check('doc identity', t90 && [t90.contractListDocId, t90.runId, t90.symbol, t90.exitId, t90.registryVersion, t90.status],
      [INSTANCE_ID, INSTANCE_ID, 'SPY', 'target-90', EXIT_REGISTRY_VERSION, 'success']);
    check('record entryMark = order price (SHORT credit)', rec(docs, 'target-90', trade().id)?.entryMark, 2.0);
    check('record contractId = trade id', rec(docs, 'target-90', trade().id)?.contractId, trade().id);
    check('summary positions/evaluated/docsWritten', [s.positions, s.evaluated, s.docsWritten], [1, 6, 6]);
  }

  // 2. Fire → exit record + firstFiredAt/firstFiredMark; sticky on re-tick
  {
    const { deps, docs } = store();
    const t = trade();
    await runShadowEvalTick([{ trade: t, mark: 0.15 }], deps);
    const r1 = rec(docs, 'target-90', t.id);
    check('fired → exit', r1?.outcome, 'exit');
    check('firstFiredAt = tick ts', r1?.firstFiredAt, TICK);
    check('firstFiredMark', r1?.firstFiredMark, 0.15);
    check('exitDate = market date', r1?.outcome === 'exit' ? r1.exitDate : '', MARKET_DATE);
    check('exitPrice = fired mark', r1?.outcome === 'exit' ? r1.exitPrice : -1, 0.15);

    // Later tick at a different mark — first-fire is sticky
    await runShadowEvalTick([{ trade: t, mark: 0.1 }], {
      ...deps,
      now: () => new Date('2025-11-24T19:00:00Z'),
    });
    const r2 = rec(docs, 'target-90', t.id);
    check('sticky firstFiredAt', r2?.firstFiredAt, TICK);
    check('sticky firstFiredMark', r2?.firstFiredMark, 0.15);
    check('exitPrice frozen at first fire', r2?.outcome === 'exit' ? r2.exitPrice : -1, 0.15);
  }

  // 3. Same-tick idempotent re-run
  {
    const { deps, docs } = store();
    const t = trade();
    await runShadowEvalTick([{ trade: t, mark: 0.15 }], deps);
    const a = JSON.stringify(doc(docs, 'target-90'));
    await runShadowEvalTick([{ trade: t, mark: 0.15 }], deps);
    check('same-tick idempotent', JSON.stringify(doc(docs, 'target-90')) === a, true);
  }

  // 4. Open records refresh + excursion folds across ticks
  {
    const { deps, docs } = store();
    const t = trade();
    await runShadowEvalTick([{ trade: t, mark: 1.5 }], deps);
    await runShadowEvalTick([{ trade: t, mark: 2.5 }], deps);
    const r = rec(docs, 'target-90', t.id);
    check('still open', r?.outcome, 'open');
    check('terminalMark refreshed', r?.terminalMark, 2.5);
    check('mae folded worst', r?.mae.value, 2.5);
    check('mfe folded best', r?.mfe.value, 1.5);
    check('no firstFired on open', r?.firstFiredAt, undefined);
  }

  // 5. Terminal prior 'exit' stays frozen even as mark recovers
  {
    const docId = stOptionsAnalysisResultDocId(INSTANCE_ID, 'target-90');
    const prior: AnalysisResultDoc = {
      contractListDocId: INSTANCE_ID,
      runId: INSTANCE_ID,
      symbol: 'SPY',
      templateId: 'csp',
      exitId: 'target-90',
      registryVersion: EXIT_REGISTRY_VERSION,
      status: 'success',
      generatedAt: '2025-11-23T21:00:00Z',
      trades: [{
        runId: INSTANCE_ID, symbol: 'SPY', templateId: 'csp',
        contractListDocId: INSTANCE_ID, exitId: 'target-90',
        pickDate: '2025-11-20', contractId: trade().id, entryMark: 2.0,
        outcome: 'exit', exitDate: '2025-11-23', exitPrice: 0.4,
        terminalMark: 0.4, daysHeld: 3,
        mae: { value: 2.0, date: '2025-11-20' },
        mfe: { value: 0.4, date: '2025-11-23' },
      }],
      aggregate: { exitId: 'target-90', contractCount: 1, exitedCount: 1, expiredCount: 0, openCount: 0, errorCount: 0 },
    };
    const { deps, docs } = store({ [docId]: prior });
    const s = await runShadowEvalTick([{ trade: trade(), mark: 1.5 }], deps);
    const r = rec(docs, 'target-90', trade().id);
    check('terminal exit stays exit', r?.outcome, 'exit');
    check('exitPrice preserved', r?.outcome === 'exit' ? r.exitPrice : -1, 0.4);
    check('no new fire counted', s.fires, 0);
  }

  // 6. Re-cross after EOD scan rewrote 'open' — original first-fire wins
  {
    const docId = stOptionsAnalysisResultDocId(INSTANCE_ID, 'target-90');
    const prior: AnalysisResultDoc = {
      contractListDocId: INSTANCE_ID,
      runId: INSTANCE_ID,
      symbol: 'SPY',
      templateId: 'csp',
      exitId: 'target-90',
      registryVersion: EXIT_REGISTRY_VERSION,
      status: 'success',
      generatedAt: '2025-11-23T21:30:00Z',
      trades: [{
        runId: INSTANCE_ID, symbol: 'SPY', templateId: 'csp',
        contractListDocId: INSTANCE_ID, exitId: 'target-90',
        pickDate: '2025-11-20', contractId: trade().id, entryMark: 2.0,
        outcome: 'open', lastBarDate: '2025-11-23', terminalMark: 0.4, daysHeld: 3,
        mae: { value: 2.0, date: '2025-11-20' },
        mfe: { value: 0.15, date: '2025-11-23' },
        firstFiredAt: '2025-11-23T18:20:00.000Z',
        firstFiredMark: 0.15,
      }],
      aggregate: { exitId: 'target-90', contractCount: 1, exitedCount: 0, expiredCount: 0, openCount: 1, errorCount: 0 },
    };
    const { deps, docs } = store({ [docId]: prior });
    await runShadowEvalTick([{ trade: trade(), mark: 0.1 }], deps);
    const r = rec(docs, 'target-90', trade().id);
    check('re-cross keeps original firstFiredAt', r?.firstFiredAt, '2025-11-23T18:20:00.000Z');
    check('re-cross keeps original firstFiredMark', r?.firstFiredMark, 0.15);
    check('exitDate = original fire date', r?.outcome === 'exit' ? r.exitDate : '', '2025-11-23');
    check('exitPrice = original fire mark', r?.outcome === 'exit' ? r.exitPrice : -1, 0.15);
  }

  // 7. No-instance trade skipped; multi-expiry → error records
  {
    const { deps, docs } = store();
    const s = await runShadowEvalTick(
      [{ trade: trade({ strategyInstanceId: undefined }), mark: 0.15 }],
      deps,
    );
    check('no-instance skip', s.skippedNoInstance, 1);
    check('no doc written for skip', docs.size, 0);

    const multi = trade({
      legs: [
        optionLeg(),
        optionLeg({
          id: 'leg-2', contractID: 'SPY260619P00500000', side: TradeSide.LONG,
          strike: 500, expiration: '2026-06-19',
        }),
      ],
    });
    const s2 = await runShadowEvalTick([{ trade: multi, mark: 0.15 }], deps);
    const r = rec(docs, 'target-90', multi.id);
    check('multi-expiry → error record', r?.outcome, 'error');
    check('eval counted error records', s2.evaluated, 6);
  }

  // 8. Orchestrator wires marked {trade, mark} into the eval tick
  {
    const evalInputs: { trade: unknown; mark: number }[] = [];
    const t = trade();
    const markRes: MarkPassResult = {
      markedAt: TICK,
      positions: [{
        positionId: t.id, trade: t, contractIDs: ['C'], netMark: -40,
        mark: 0.4, unrealizedPnl: 10, interpolatedClose: false, asOf: TICK,
      }],
      errors: [],
    };
    const summary = await runUnifiedMarkPass(
      { getQuotes: async () => [] },
      async () => markRes,
      async (positions) => {
        evalInputs.push(...positions);
        return { positions: 1, evaluated: 6, fires: 0, skippedNoInstance: 0, skippedNonOption: 0, docsWritten: 6, errors: [] };
      },
    );
    check('eval input {trade, mark}', evalInputs.length === 1 && evalInputs[0].mark, 0.4);
    check('eval input trade ref', evalInputs[0].trade === t, true);
    check('orchestrator summary fields', summary,
      { positions: 1, errors: 0, evaluated: 1, fires: 0, evalErrors: 0 });
    const failed = await runUnifiedMarkPass(
      { getQuotes: async () => [] },
      async () => markRes,
      async () => { throw new Error('analysis read denied'); },
    );
    check('eval failure → evalError, marks survive', failed,
      { positions: 1, errors: 0, evaluated: 0, fires: 0, evalErrors: 0, evalError: 'analysis read denied' });
  }

  // 9. EOD scan carries firstFired* forward onto rebuilt records
  {
    const EXPIRY = '2026-02-27';
    const OPEN_DATE = '2026-01-30';
    const posId = 'QQQ-PCS-28-30-15-ALL-2026-01-30';
    const legs: PositionLeg[] = [
      {
        id: 'leg-short', type: OptionType.PUT, side: TradeSide.SHORT,
        strike: 480, expiration: EXPIRY, openDate: OPEN_DATE,
        contractID: 'QQQ260227P00480000', premium: 2.5,
      },
      {
        id: 'leg-long', type: OptionType.PUT, side: TradeSide.LONG,
        strike: 470, expiration: EXPIRY, openDate: OPEN_DATE,
        contractID: 'QQQ260227P00470000', premium: 1.0,
      },
    ];
    const position: ManageOpenPosition = {
      id: posId, instanceId: 'QQQ-PCS-28-30-15-ALL', symbol: 'QQQ',
      status: PositionStatus.OPEN, premiumCollected: 150,
      capitalRequired: 850, openDate: OPEN_DATE, currentValue: 100,
      currentValueAsOf: '2026-02-06', unrealizedPnl: 50, legs,
    };
    const instance = {
      id: 'QQQ-PCS-28-30-15-ALL', variantRef: 'pcs-28-30-15',
      variant: { templateId: 'pcs', legs: [] } as never, symbol: 'QQQ',
      mode: 'paper', trigger: 'daily', stopType: 'ALL', runState: 'ACTIVE',
      userId: 'u', paperAccountId: 'acct-1',
      createdAt: 'x', updatedAt: 'x',
    } as RunnableManageInstance;
    const docId = 'QQQ-PCS-28-30-15-ALL_target-90';
    const docs = new Map<string, AnalysisResultDoc>([
      [docId, {
        contractListDocId: instance.id, runId: instance.id, symbol: 'QQQ',
        templateId: 'pcs', exitId: 'target-90',
        registryVersion: EXIT_REGISTRY_VERSION, status: 'success',
        generatedAt: '2026-02-05T18:20:00Z',
        trades: [{
          runId: instance.id, symbol: 'QQQ', templateId: 'pcs',
          contractListDocId: instance.id, exitId: 'target-90',
          pickDate: OPEN_DATE, contractId: posId, entryMark: 1.5,
          outcome: 'exit', exitDate: '2026-02-05', exitPrice: 0.14,
          terminalMark: 0.14, daysHeld: 6,
          mae: { value: 1.5, date: '2026-01-30' },
          mfe: { value: 0.14, date: '2026-02-05' },
          firstFiredAt: '2026-02-05T18:20:00Z',
          firstFiredMark: 0.14,
        }],
        aggregate: { exitId: 'target-90', contractCount: 1, exitedCount: 1, expiredCount: 0, openCount: 0, errorCount: 0 },
      }],
    ]);
    const dates = [OPEN_DATE, '2026-02-02', '2026-02-03', '2026-02-04', '2026-02-05', '2026-02-06'];
    const shorts = [2.5, 2.25, 1.875, 1.625, 1.25, 0.75];
    const longs = [1.0, 0.875, 0.75, 0.625, 0.5, 0.625];
    await runManageExitScan('2026-02-06', {
      listActiveInstances: async () => ({ daily: [instance], signal: [] }),
      listOpenPositions: async () => [position],
      fetchSeries: async ({ contractID }) => ({
        symbol: 'QQQ', contractID,
        series: dates.map((date, i) => ({
          date,
          mark: String((contractID === 'QQQ260227P00480000' ? shorts : longs)[i]),
        })),
      }) as never,
      loadUnderlyingClose: async () => new Map([[EXPIRY, 500]]),
      readResultDoc: async (id) => docs.get(id) ?? null,
      writeResultDoc: async (id, d) => { docs.set(id, d); },
      writeResult: async () => {},
      now: () => new Date('2026-02-06T21:30:00Z'),
    });
    const r = docs.get(docId)?.trades.find((t) => t.contractId === posId);
    check('scan rebuilt record (exit)', r?.outcome, 'exit');
    check('scan preserved firstFiredAt', r?.firstFiredAt, '2026-02-05T18:20:00Z');
    check('scan preserved firstFiredMark', r?.firstFiredMark, 0.14);
  }

  console.log(failures === 0 ? '\nALL CHECKS PASSED' : `\n${failures} CHECK(S) FAILED`);
  process.exit(failures === 0 ? 0 : 1);
}

main();
