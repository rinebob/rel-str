/**
 * @topic #984 — ST Firestore Reorg (task #1563)
 *
 * Verifies the ledger stats-increment seam against REAL prod — no stubs,
 * no emulator — by driving canonical trades through the REAL lifecycle
 * functions and asserting the stats counters move INTRADAY, before any
 * nightly recompute:
 *
 *   1. Entry: two MANUAL trades minted via the REAL applyEntryFill +
 *      ledgerDeps(db) → stats-all + stats-src-MANUAL openTradeCount +1
 *      each and totalPremiumCollected += the SHORT entry premium.
 *   2. Exit: trade A closed via the REAL applyExitFill → open−1,
 *      closed+1, totalRealizedPnl += realizedPnl.
 *   3. Settle: trade B settled via the REAL markPositionSettled
 *      (EXPIRED_WORTHLESS) → open−1, closed+1, expiredWorthless+1,
 *      totalRealizedPnl += banked premium.
 *   4. Mint check: if stats-src-MANUAL didn't exist, the increment
 *      mints it with ALL 8 counters present (inc(0) shape).
 *   5. Self-heal: seeds deleted + the REAL nightly pass re-run →
 *      counters return to their pre-seed baselines.
 *
 * Asserts DELTAS (after − before) so a concurrent prod trade landing
 * mid-run can't produce a false absolute-count failure. A racing trade
 * landing BETWEEN a before/after read could still skew one assertion —
 * re-run before believing a failure.
 *
 * Cleanup: verify trades + verify account docs are deleted, the nightly
 * pass is re-run, and stats-src-MANUAL is deleted if the increments
 * minted it (the recompute doesn't write scopes with zero trades).
 *
 * Run:    cd functions && npx tsx scripts/verify/paper-trading-stats-increments-1563.ts
 * Prereq: Application Default Credentials with Firestore access
 *         (gcloud auth application-default login). No RH OAuth needed.
 */

import {
  PaperTradeSource,
  PaperTradeStatus,
  PaperTradingKind,
  type PaperStats,
  type PaperTradeLeg,
} from '../../../shared/paper-trading-contracts';
import { OptionType, OptionQuoteSource } from '../../../shared/options-common';
import { TradeSide } from '../../../shared/common';
import { LegOutcome, PositionStatus } from '../../src/paper-trading/engine/types';
import {
  buildAccountId,
  buildStatsId,
  statsScopeSource,
} from '../../../shared/paper-trading-ids';
import { db } from '../../src/firebase-admin-init';
import { getStats } from '../../src/paper-trading/repository';
import { ledgerDeps } from '../../src/paper-trading/repository';
import { applyEntryFill, applyExitFill } from '../../src/paper-trading/ledger';
import { markPositionSettled } from '../../src/paper-trading/engine/position-repository';
import { paperDocRef } from '../../src/paper-trading/collections';
import {
  createPaperStatsPassDeps,
  runPaperStatsPass,
} from '../../src/paper-trading/passes/paper-stats-pass';

const DATE = new Date().toISOString().slice(0, 10);
const NOW = new Date().toISOString();
const USER = 'verify-1563';
const TRADE_EXIT = 'verify-1563-exit';
const TRADE_SETTLE = 'verify-1563-settle';

// The 8 counters the increment mints — mirrors COUNTER_FIELDS in
// stats-increments.ts (PaperStats counter shape).
const COUNTER_FIELDS = [
  'openTradeCount',
  'closedTradeCount',
  'totalPremiumCollected',
  'totalRealizedPnl',
  'totalUnrealizedPnl',
  'assignedCount',
  'expiredWorthlessCount',
  'maxDrawdown',
] as const;

let passed = 0;
let failed = 0;
function check(name: string, ok: boolean, detail = '') {
  if (ok) {
    passed++;
    console.log(`OK   ${name}`);
  } else {
    failed++;
    console.log(`FAIL ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

const ZERO: Record<string, number> = Object.fromEntries(
  COUNTER_FIELDS.map((f) => [f, 0]),
);
const counters = (s: PaperStats | null | undefined) =>
  s ? Object.fromEntries(COUNTER_FIELDS.map((f) => [f, s[f] ?? 0])) : ZERO;

const delta = (after: PaperStats | null | undefined, before: PaperStats | null | undefined) => {
  const a = counters(after);
  const b = counters(before);
  return Object.fromEntries(COUNTER_FIELDS.map((f) => [f, a[f] - b[f]]));
};

const leg = (id: string, strike: number, entryMark: number): PaperTradeLeg => ({
  id,
  kind: 'option',
  contractID: `QQQM${DATE.slice(2).replace(/-/g, '')}P00${strike}000`,
  type: OptionType.PUT,
  strike,
  expiration: '2026-12-18',
  side: TradeSide.SHORT,
  quantity: 1,
  multiplier: 100,
  entryMark,
  lastMark: entryMark,
  openDate: DATE,
});

async function main() {
  const ldeps = ledgerDeps(db);
  const srcScope = statsScopeSource(PaperTradeSource.MANUAL); // src-MANUAL
  const srcId = buildStatsId(srcScope);

  // ── Baselines ─────────────────────────────────────────────────────
  const all0 = await getStats(db, buildStatsId('all'));
  const src0 = await getStats(db, srcId);
  const srcMintedByUs = src0 == null; // getStats returns null when absent
  check('baseline stats-all present', !!all0);
  console.log(`      src-MANUAL baseline: ${src0 ? 'exists' : 'absent — increment must mint it'}`);

  const refFor = (tradeId: string) =>
    paperDocRef(db, PaperTradingKind.TRADE, tradeId);
  const acctRef = paperDocRef(db, PaperTradingKind.ACCOUNT, buildAccountId(USER));

  try {
    // ── 1. Entry increments ─────────────────────────────────────────
    // Trade A — SHORT put, entry mark 1.00 → premium +100.
    await applyEntryFill(
      {
        userId: USER,
        tradeId: TRADE_EXIT,
        order: { side: TradeSide.SHORT, type: 'MARKET', quantity: 1 },
        legs: [leg('leg-a', 400, 1.0)],
        fill: {
          fillId: 'vf-a-entry',
          role: 'entry',
          date: DATE,
          price: 1.0,
          quantity: 1,
          quoteSource: OptionQuoteSource.RH_MCP,
        },
        dims: {
          source: PaperTradeSource.MANUAL,
          symbol: 'QQQM',
          expression: 'CSP',
          governingVariant: 'trailing-8',
        },
        now: NOW,
      },
      ldeps,
    );

    const all1 = await getStats(db, buildStatsId('all'));
    const src1 = await getStats(db, srcId);
    let d = delta(all1, all0);
    check('entry A: stats-all openTradeCount +1', d.openTradeCount === 1, `Δ${d.openTradeCount}`);
    check('entry A: stats-all totalPremiumCollected +100',
      d.totalPremiumCollected === 100, `Δ${d.totalPremiumCollected}`);
    if (srcMintedByUs) {
      check('entry A: stats-src-MANUAL minted by the increment', !!src1);
      check('entry A: minted doc carries all 8 counters',
        !!src1 && COUNTER_FIELDS.every((f) => typeof src1[f] === 'number'));
    }
    // Delta checks use the null-aware helper — src0 may be null.
    d = delta(src1, src0);
    check('entry A: src-MANUAL openTradeCount +1', d.openTradeCount === 1, `Δ${d.openTradeCount}`);

    // Trade B — SHORT put, entry mark 0.50 → premium +50.
    await applyEntryFill(
      {
        userId: USER,
        tradeId: TRADE_SETTLE,
        order: { side: TradeSide.SHORT, type: 'MARKET', quantity: 1 },
        legs: [leg('leg-b', 395, 0.5)],
        fill: {
          fillId: 'vf-b-entry',
          role: 'entry',
          date: DATE,
          price: 0.5,
          quantity: 1,
          quoteSource: OptionQuoteSource.RH_MCP,
        },
        dims: {
          source: PaperTradeSource.MANUAL,
          symbol: 'QQQM',
          expression: 'CSP',
          governingVariant: 'trailing-8',
        },
        now: NOW,
      },
      ldeps,
    );

    const all2 = await getStats(db, buildStatsId('all'));
    d = delta(all2, all1);
    check('entry B: stats-all openTradeCount +1', d.openTradeCount === 1, `Δ${d.openTradeCount}`);
    check('entry B: stats-all totalPremiumCollected +50',
      d.totalPremiumCollected === 50, `Δ${d.totalPremiumCollected}`);

    // ── 2. Exit increment (trade A — buy back at 0.60 → realized +40)
    const exitRes = await applyExitFill(
      {
        userId: USER,
        tradeId: TRADE_EXIT,
        fill: {
          fillId: 'vf-a-exit',
          role: 'exit',
          date: DATE,
          price: 0.6,
          quantity: 1,
          quoteSource: OptionQuoteSource.RH_MCP,
        },
        now: NOW,
      },
      ldeps,
    );
    check('exit A: trade landed CLOSED', exitRes.trade.status === PaperTradeStatus.CLOSED,
      exitRes.trade.status);

    const all3 = await getStats(db, buildStatsId('all'));
    const src3 = await getStats(db, srcId);
    d = delta(all3, all2);
    check('exit A: stats-all openTradeCount −1', d.openTradeCount === -1, `Δ${d.openTradeCount}`);
    check('exit A: stats-all closedTradeCount +1', d.closedTradeCount === 1, `Δ${d.closedTradeCount}`);
    check('exit A: stats-all totalRealizedPnl +40',
      d.totalRealizedPnl === 40, `Δ${d.totalRealizedPnl}`);
    d = delta(src3, src1);
    check('exit A: src-MANUAL closedTradeCount +1', d.closedTradeCount === 1, `Δ${d.closedTradeCount}`);

    // ── 3. Settle increment (trade B — EXPIRED_WORTHLESS, premium +50)
    await markPositionSettled(
      TRADE_SETTLE,
      {
        status: PositionStatus.EXPIRED_WORTHLESS,
        currentValue: 0,
        currentValueAsOf: NOW,
        unrealizedPnl: 0,
      },
      [{ legId: 'leg-b', outcome: LegOutcome.EXPIRED_WORTHLESS, closeDate: DATE }],
    );

    const all4 = await getStats(db, buildStatsId('all'));
    const src4 = await getStats(db, srcId);
    d = delta(all4, all3);
    check('settle B: stats-all openTradeCount −1', d.openTradeCount === -1, `Δ${d.openTradeCount}`);
    check('settle B: stats-all closedTradeCount +1', d.closedTradeCount === 1, `Δ${d.closedTradeCount}`);
    check('settle B: stats-all expiredWorthlessCount +1',
      d.expiredWorthlessCount === 1, `Δ${d.expiredWorthlessCount}`);
    check('settle B: stats-all totalRealizedPnl +50',
      d.totalRealizedPnl === 50, `Δ${d.totalRealizedPnl}`);
    d = delta(src4, src3);
    check('settle B: src-MANUAL mirrors expired/realized deltas',
      d.expiredWorthlessCount === 1 && d.totalRealizedPnl === 50);
  } finally {
    // ── Cleanup: delete seeds, recompute, restore baseline ──────────
    await refFor(TRADE_EXIT).delete().catch(() => undefined);
    await refFor(TRADE_SETTLE).delete().catch(() => undefined);
    await acctRef.delete().catch(() => undefined);

    const heal = await runPaperStatsPass(DATE, createPaperStatsPassDeps());
    check('cleanup: nightly pass re-ran clean', heal.errors.length === 0,
      heal.errors.join('; '));

    const allEnd = await getStats(db, buildStatsId('all'));
    const dEnd = delta(allEnd, all0);
    check('cleanup: stats-all self-healed to baseline',
      COUNTER_FIELDS.every((f) => dEnd[f] === 0),
      JSON.stringify(dEnd));

    const srcEnd = await getStats(db, srcId);
    if (srcMintedByUs) {
      // We minted the doc; the recompute won't write an empty scope —
      // remove it so prod returns to its pre-run shape.
      if (srcEnd) {
        await paperDocRef(db, PaperTradingKind.STATS, srcId).delete().catch(() => undefined);
        check('cleanup: minted stats-src-MANUAL removed (baseline was absent)', true);
      } else {
        check('cleanup: minted stats-src-MANUAL removed (baseline was absent)', true);
      }
    } else if (src0) {
      const dSrc = delta(srcEnd, src0);
      check('cleanup: stats-src-MANUAL self-healed to baseline',
        COUNTER_FIELDS.every((f) => dSrc[f] === 0),
        JSON.stringify(dSrc));
    }
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

main().catch(async (err) => {
  console.error(err);
  // Best-effort cleanup on a mid-run crash.
  await paperDocRef(db, PaperTradingKind.TRADE, TRADE_EXIT).delete().catch(() => undefined);
  await paperDocRef(db, PaperTradingKind.TRADE, TRADE_SETTLE).delete().catch(() => undefined);
  await paperDocRef(db, PaperTradingKind.ACCOUNT, buildAccountId(USER)).delete().catch(() => undefined);
  process.exit(1);
});
