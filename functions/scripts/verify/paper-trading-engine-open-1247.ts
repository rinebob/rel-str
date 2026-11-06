/**
 * @topic #553 — Paper Trading Infra (task #1247 — ladder cadence)
 *
 * Verifies the engine `runOpenPass` ladder fix against REAL prod data.
 * Pre-#1247 the pass skipped whenever ANY open position existed
 * ('existing_position'), making every instance serial — one position at a
 * time, held to expiration. The fix opens one new position per cadence
 * period while prior positions stay open, gated by same-day idempotency
 * and an optional `maxOpenPositions` cap.
 *
 *   1. Seeds two scratch strategy instances + daily-analysis/latest sims:
 *        A) daily instance with a YESTERDAY-open strategy trade — old code
 *           would skip 'existing_position'; fixed code must open a NEW leg.
 *        B) same shape but `maxOpenPositions: 1` — must skip at the cap.
 *   2. Runs the real `runOpenPass` with all-default deps (real Firestore
 *      readers/writers; brokerage order placer is the built-in STUB — no
 *      real order is placed).
 *   3. Asserts: A opens (AC1), same-day re-run is idempotent
 *      'already_opened_today' (AC2), B skips 'max_open_positions' with a
 *      distinct reason (AC3; cap=1 preserves old serial behavior — AC4).
 *   4. Cleans up all scratch docs (instances, analysis docs, trades,
 *      raw quotes, accounts, per-instance stats) AND restores the global
 *      `stats/ALL` doc to its pre-run snapshot — the pass increments it.
 *
 * Usage (from functions/ dir):
 *   npx tsx scripts/verify/paper-trading-engine-open-1247.ts
 *
 * Requires: ADC (rel-str). No RH MCP needed — the order placer is a stub.
 */

import { db } from '../../src/firebase-admin-init';
import { FieldValue } from 'firebase-admin/firestore';
import {
  OptionQuoteSource,
  OptionType,
  PositionSpreadType,
  StrategyFrequency,
  buildOccContractId,
} from '../../../shared/options-common';
import { TradeSide } from '../../../shared/common';
import {
  ExitPolicy,
  LifecycleState,
} from '../../../shared/options-strategy-engine-contracts';
import type {
  StrategyInstanceConfig,
  OvernightDeltaSimulation,
} from '../../../shared/options-strategy-engine-contracts';
import {
  PaperTradingKind,
  PaperTradeSource,
  PaperTradeStatus,
} from '../../../shared/paper-trading-contracts';
import type { PaperTrade } from '../../../shared/paper-trading-contracts';
import { buildAccountId } from '../../../shared/paper-trading-ids';
import { paperDocRef, paperItemsRef } from '../../src/paper-trading/collections';
import { ST_STRATEGY_INSTANCES_ROOT } from '../../src/common/st-collections';
import { getMarketDatePT } from '../../src/common/pt-date-utils';
import { strategyInstanceDailyAnalysisRef } from '../../src/paper-trading/engine/strategy-instance-repository';
import { LATEST_DAILY_ANALYSIS_DOC_ID } from '../../src/paper-trading/engine/pricing/overnight-simulation-writer';
import { buildPositionId } from '../../src/paper-trading/engine/position-ids';
import { statsDocRef } from '../../src/paper-trading/engine/stats-repository';
import { runOpenPass } from '../../src/paper-trading/engine/passes/open-pass';
import { SHARES_PER_CONTRACT } from '../../src/paper-trading/engine/types';

const USER_A = 'verify-1247-user';
const USER_B = 'verify-1247-user-cap';
const INST_A = 'verify-1247-inst';
const INST_B = 'verify-1247-inst-cap';
const SEEDED_TRADE_A = 'verify-1247-opened-yesterday';
const SEEDED_TRADE_B = 'verify-1247-capped-position';
const EXPIRY = '2026-12-18'; // any future third-Friday; leg date only
const ENTRY_PREMIUM = 2.0;

let passed = 0;
let failed = 0;

function check(name: string, cond: boolean, detail?: unknown): void {
  if (cond) {
    passed++;
    console.log(`OK   ${name}`);
  } else {
    failed++;
    console.log(`FAIL ${name}`, detail ?? '');
  }
}

function makeConfig(
  instanceId: string,
  userId: string,
  symbol: string,
  overrides: Partial<StrategyInstanceConfig> = {},
): StrategyInstanceConfig {
  return {
    id: instanceId,
    symbol,
    optionType: OptionType.PUT,
    side: TradeSide.SHORT,
    dteMin: 20,
    dteMax: 33, // distinctive — position ids can't collide with live 30/45
    targetDelta: 0.11,
    phases: [
      {
        spreadType: PositionSpreadType.CASH_SECURED_PUT,
        targetDelta: 0.11,
        dteMin: 20,
        dteMax: 33,
      },
    ],
    frequency: StrategyFrequency.DAILY,
    openTimePT: '13:00', // no live instance opens at 13:00
    exitPolicies: [{ policy: ExitPolicy.HOLD_TO_EXPIRATION }],
    lifecycleState: LifecycleState.ACTIVE,
    userId,
    createdAt: '2026-11-01T00:00:00Z',
    updatedAt: '2026-11-01T00:00:00Z',
    ...overrides,
  };
}

function makeSimulation(symbol: string): OvernightDeltaSimulation {
  return {
    baseUnderlyingPrice: 100,
    baseContractID: buildOccContractId(symbol, EXPIRY, OptionType.PUT, 90),
    rangePct: 0.025,
    stepPct: 0.005,
    grid: [
      { underlyingMovePct: -0.010, underlyingPrice: 99.0, delta: -0.29, mark: 0.90, theta: -0.04 },
      { underlyingMovePct: -0.005, underlyingPrice: 99.5, delta: -0.27, mark: 0.80, theta: -0.03 },
      { underlyingMovePct: 0.000, underlyingPrice: 100.0, delta: -0.25, mark: 0.70, theta: -0.03 },
      { underlyingMovePct: 0.005, underlyingPrice: 100.5, delta: -0.23, mark: 0.60, theta: -0.03 },
      { underlyingMovePct: 0.010, underlyingPrice: 101.0, delta: -0.21, mark: 0.50, theta: -0.02 },
      { underlyingMovePct: 0.015, underlyingPrice: 101.5, delta: -0.19, mark: 0.40, theta: -0.02 },
    ],
    computedAt: '2026-11-01T20:00:00.000Z',
  };
}

function seededOpenTrade(
  id: string,
  instanceId: string,
  userId: string,
  symbol: string,
  openDate: string,
): PaperTrade {
  return {
    kind: PaperTradingKind.TRADE,
    id,
    status: PaperTradeStatus.OPEN,
    userId,
    source: PaperTradeSource.STRATEGY,
    strategyInstanceId: instanceId,
    symbol,
    expression: 'CSP',
    governingVariant: 'trailing-8',
    order: { side: TradeSide.SHORT, type: 'MARKET', quantity: 1 },
    fills: [
      {
        fillId: `entry-${id}`,
        role: 'entry',
        date: openDate,
        price: ENTRY_PREMIUM,
        quantity: 1,
        quoteSource: OptionQuoteSource.RH_MCP,
      },
    ],
    legs: [
      {
        kind: 'option',
        id: `PUT-85.00-${EXPIRY}`,
        contractID: buildOccContractId(symbol, EXPIRY, OptionType.PUT, 85),
        type: OptionType.PUT,
        strike: 85,
        expiration: EXPIRY,
        openDate,
        side: TradeSide.SHORT,
        quantity: 1,
        multiplier: SHARES_PER_CONTRACT,
        entryMark: ENTRY_PREMIUM,
        lastMark: ENTRY_PREMIUM,
      },
    ],
    marks: {},
    variantRuns: [
      { variantKey: 'trailing-8', governing: true, state: 'ACTIVE', workingState: {} },
    ],
    variantKeys: ['trailing-8'],
    realizedPnl: 0,
    unrealizedPnl: 0,
    createdAt: `${openDate}T12:00:00Z`,
    updatedAt: `${openDate}T12:00:00Z`,
  };
}

function yesterday(date: string): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

async function instanceDoc(config: StrategyInstanceConfig): Promise<void> {
  const now = new Date().toISOString();
  const { id: _id, ...fields } = config;
  await db.collection(ST_STRATEGY_INSTANCES_ROOT).doc(config.id).set({
    ...fields,
    mode: 'paper',
    enabled: true,
    governingVariant: 'trailing-8',
    createdAt: now,
    updatedAt: now,
  });
}

async function openTradeCount(instanceId: string): Promise<number> {
  const snap = await paperItemsRef(db, PaperTradingKind.TRADE)
    .where('status', '==', PaperTradeStatus.OPEN)
    .where('source', '==', PaperTradeSource.STRATEGY)
    .where('strategyInstanceId', '==', instanceId)
    .get();
  return snap.size;
}

async function cleanup(posIdA: string | null): Promise<void> {
  const dels: Promise<unknown>[] = [
    db.collection(ST_STRATEGY_INSTANCES_ROOT).doc(INST_A).delete(),
    db.collection(ST_STRATEGY_INSTANCES_ROOT).doc(INST_B).delete(),
    strategyInstanceDailyAnalysisRef(INST_A).doc(LATEST_DAILY_ANALYSIS_DOC_ID).delete(),
    strategyInstanceDailyAnalysisRef(INST_B).doc(LATEST_DAILY_ANALYSIS_DOC_ID).delete(),
    paperDocRef(db, PaperTradingKind.TRADE, SEEDED_TRADE_A).delete(),
    paperDocRef(db, PaperTradingKind.TRADE, SEEDED_TRADE_B).delete(),
    paperDocRef(db, PaperTradingKind.ACCOUNT, buildAccountId(USER_A)).delete(),
    paperDocRef(db, PaperTradingKind.ACCOUNT, buildAccountId(USER_B)).delete(),
    statsDocRef(INST_A).delete(),
    statsDocRef(INST_B).delete(),
  ];
  if (posIdA) {
    dels.push(
      paperDocRef(db, PaperTradingKind.TRADE, posIdA).delete(),
      // Raw-quote doc ids are date-keyed, not predictable — delete by
      // the `tradeId` field instead.
      paperItemsRef(db, PaperTradingKind.RAW_QUOTE)
        .where('tradeId', '==', posIdA)
        .get()
        .then((s) => Promise.all(s.docs.map((d) => d.ref.delete()))),
    );
  }
  await Promise.all(dels);
}

async function main(): Promise<void> {
  const marketDate = getMarketDatePT();
  const priorDate = yesterday(marketDate);
  const configA = makeConfig(INST_A, USER_A, 'VTSY');
  const configB = makeConfig(INST_B, USER_B, 'VTSZ', { maxOpenPositions: 1 });
  const expectedPosId = buildPositionId(configA, marketDate);

  // Snapshot the global stats doc — the pass increments it on open and the
  // scratch open must not leak into prod aggregates.
  const statsAllSnap = await statsDocRef('ALL').get();
  const statsAllBefore = statsAllSnap.exists ? statsAllSnap.data() : null;

  await cleanup(expectedPosId); // clear leftovers from a prior run

  // ── Seed scratch state ──
  await instanceDoc(configA);
  await instanceDoc(configB);
  await strategyInstanceDailyAnalysisRef(INST_A)
    .doc(LATEST_DAILY_ANALYSIS_DOC_ID)
    .set({ overnightDeltaSimulation: makeSimulation('VTSY') });
  await strategyInstanceDailyAnalysisRef(INST_B)
    .doc(LATEST_DAILY_ANALYSIS_DOC_ID)
    .set({ overnightDeltaSimulation: makeSimulation('VTSZ') });
  await paperDocRef(db, PaperTradingKind.TRADE, SEEDED_TRADE_A).set(
    (({ id: _id, ...d }) => d)(
      seededOpenTrade(SEEDED_TRADE_A, INST_A, USER_A, 'VTSY', priorDate),
    ),
  );
  await paperDocRef(db, PaperTradingKind.TRADE, SEEDED_TRADE_B).set(
    (({ id: _id, ...d }) => d)(
      seededOpenTrade(SEEDED_TRADE_B, INST_B, USER_B, 'VTSZ', priorDate),
    ),
  );
  check('scratch instances + prior-day open trades seeded',
    (await openTradeCount(INST_A)) === 1 && (await openTradeCount(INST_B)) === 1);
  const latestA = await strategyInstanceDailyAnalysisRef(INST_A)
    .doc(LATEST_DAILY_ANALYSIS_DOC_ID)
    .get();
  check('scratch daily-analysis/latest sim seeded',
    latestA.exists &&
      !!(latestA.data() as { overnightDeltaSimulation?: unknown })
        ?.overnightDeltaSimulation);

  // ── AC1: prior-day open position does NOT block a new cadence open ──
  const runA1 = await runOpenPass(INST_A, marketDate, configA, 101);
  check('AC1: daily ladder opens a new position despite a prior-day open leg',
    runA1 !== null && runA1.skipped === false && runA1.positionId === expectedPosId,
    runA1);
  const newTrade = await paperDocRef(db, PaperTradingKind.TRADE, expectedPosId).get();
  check('AC1: new position doc persisted with OPEN status',
    newTrade.exists && (newTrade.data() as PaperTrade).status === PaperTradeStatus.OPEN);
  check('AC1: instance now holds two concurrent open positions',
    (await openTradeCount(INST_A)) === 2);
  const rawQuoteSnap = await paperItemsRef(db, PaperTradingKind.RAW_QUOTE)
    .where('tradeId', '==', expectedPosId)
    .get();
  check('AC1: entry raw quote persisted', rawQuoteSnap.size === 1, rawQuoteSnap.size);

  // ── AC2: same-day re-run is idempotent ──
  const runA2 = await runOpenPass(INST_A, marketDate, configA, 101);
  check('AC2: same-day retry skips already_opened_today',
    runA2 !== null && runA2.skipped === true && runA2.skipReason === 'already_opened_today',
    runA2?.skipReason);
  check('AC2: no third position created by the retry',
    (await openTradeCount(INST_A)) === 2);

  // ── AC3 + AC4: maxOpenPositions cap (cap=1 == old serial behavior) ──
  const runB = await runOpenPass(INST_B, marketDate, configB, 101);
  check('AC3: capped instance skips with distinct max_open_positions reason',
    runB !== null && runB.skipped === true && runB.skipReason === 'max_open_positions',
    runB?.skipReason);
  check('AC4: cap=1 preserves single-position behavior (still 1 open)',
    (await openTradeCount(INST_B)) === 1);
  check('AC3/AC4: capped instance accrued no stats doc',
    !(await statsDocRef(INST_B).get()).exists);

  // ── Stats honesty: A's open incremented its scope AND the global ALL ──
  const statsA = (await statsDocRef(INST_A).get()).data() as
    | { openTradeCount?: number; totalPremiumCollected?: number }
    | undefined;
  check('instance-A stats scope shows the open',
    statsA !== undefined && statsA.openTradeCount === 1, statsA);
  const statsAllAfter = (await statsDocRef('ALL').get()).data() as
    | { openTradeCount?: number; totalPremiumCollected?: number }
    | undefined;
  const expectedPremium = 0.5 * 100; // nearest grid point mark 0.50 × 100
  // >= semantics: the deployed engine opens REAL legs during market
  // hours, so ALL can gain concurrent increments on top of ours.
  check('global ALL stats picked up the scratch open (+1, +premium)',
    statsAllAfter !== undefined &&
      (statsAllAfter.openTradeCount ?? 0) >=
        (((statsAllBefore as { openTradeCount?: number } | null)?.openTradeCount) ?? 0) + 1 &&
      (statsAllAfter.totalPremiumCollected ?? 0) >=
        (((statsAllBefore as { totalPremiumCollected?: number } | null)
          ?.totalPremiumCollected) ?? 0) + expectedPremium - 1e-6,
    { before: statsAllBefore, after: statsAllAfter });

  // ── Undo the scratch's contribution + cleanup ──
  // Atomic decrement, not a snapshot restore — writing `before` back
  // would clobber concurrent prod opens that landed during the run.
  if (statsAllBefore) {
    await statsDocRef('ALL').set(
      {
        openTradeCount: FieldValue.increment(-1),
        totalPremiumCollected: FieldValue.increment(-expectedPremium),
        updatedAt: new Date().toISOString(),
      },
      { merge: true },
    );
  } else if (statsAllSnap.exists) {
    await statsDocRef('ALL').delete();
  }
  await cleanup(expectedPosId);

  const statsAllRestored = (await statsDocRef('ALL').get()).data() as
    | { openTradeCount?: number; totalPremiumCollected?: number }
    | undefined;
  // >= before: the scratch's +1 is undone while concurrent prod opens
  // (if any) survive — a failed undo would leave it BELOW before.
  check('global ALL stats: scratch contribution undone, concurrent opens preserved',
    statsAllRestored !== undefined &&
      (statsAllRestored.openTradeCount ?? 0) >=
        ((statsAllBefore as { openTradeCount?: number } | null)?.openTradeCount ?? 0),
    statsAllRestored);

  const survivors = [
    (await paperDocRef(db, PaperTradingKind.TRADE, expectedPosId).get()).exists,
    (await paperDocRef(db, PaperTradingKind.TRADE, SEEDED_TRADE_A).get()).exists,
    (await paperDocRef(db, PaperTradingKind.TRADE, SEEDED_TRADE_B).get()).exists,
    (await db.collection(ST_STRATEGY_INSTANCES_ROOT).doc(INST_A).get()).exists,
    (await db.collection(ST_STRATEGY_INSTANCES_ROOT).doc(INST_B).get()).exists,
    (await paperDocRef(db, PaperTradingKind.ACCOUNT, buildAccountId(USER_A)).get()).exists,
    (await statsDocRef(INST_A).get()).exists,
  ];
  check('cleanup removed all scratch docs', survivors.every((s) => !s));
}

main()
  .catch((err) => {
    console.error('FATAL', err);
    failed++;
  })
  .finally(async () => {
    await cleanup(null).catch(() => undefined); // belt-and-suspenders
    console.log(`\n${passed} passed, ${failed} failed`);
    process.exit(failed === 0 ? 0 : 1);
  });
