/**
 * @topic #553 — Paper Trading Infra (task #565)
 *
 * Production verification for the paper-trading read APIs + generalized
 * stats pass — REAL environment, no stubs, no emulator:
 *
 *   1. Seeds namespaced trade docs (strategy + signal dims, one CLOSED)
 *      and an `acct-verify-565` account directly into Firestore.
 *   2. Runs the REAL generalized stats pass (prod repository + stats
 *      writer) — writes stats-{scope} docs for every populated scope.
 *   3. Calls the real handler functions with prod deps:
 *      - listPaperTrades — every filter + a combined cohort+expression query
 *      - getPaperStats — a named scope + the omitted-scope enumeration
 *      - getPaperAccount — the seeded account, and a missing-account uid
 *      - listExitVariants — registry defaults
 *   4. Cleanup: deletes seeded docs, RE-RUNS the stats pass so shared
 *      scopes (all, var-*) self-heal without the verify trades, then
 *      deletes the namespaced scope docs the healed pass leaves behind.
 *
 * Run:  cd functions && npx tsx scripts/verify/paper-trading-read-apis-565.ts
 * Prereq: Application Default Credentials with Firestore access
 *         (gcloud auth application-default login). No RH OAuth needed —
 *         the read APIs never touch the broker.
 */

import { TradeSide } from '../../../shared/common';
import {
  PaperTradingKind,
  PaperTradeSource,
  PaperTradeStatus,
  type PaperAccount,
  type PaperStats,
  type PaperTrade,
} from '../../../shared/paper-trading-contracts';
import { buildAccountId, buildStatsId } from '../../../shared/paper-trading-ids';
import { db } from '../../src/firebase-admin-init';
import {
  handleGetPaperAccount,
  handleGetPaperStats,
  handleListExitVariants,
  handleListPaperTrades,
  paperReadDeps,
} from '../../src/paper-trading/read-callables';
import {
  createPaperStatsPassDeps,
  runPaperStatsPass,
} from '../../src/paper-trading/passes/paper-stats-pass';
import type { CallableRequest } from 'firebase-functions/v2/https';

const PFX = 'verify-565';
const SYMBOL = 'VRFY';
const UID = `${PFX}-uid`;
const DATE = new Date().toISOString().slice(0, 10);
const NOW = new Date().toISOString();

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

function req<T>(data: T, uid = UID) {
  return { data, auth: { uid, token: {} } } as CallableRequest<T>;
}

function seedTrade(id: string, overrides: Partial<PaperTrade>): PaperTrade {
  return {
    kind: PaperTradingKind.TRADE,
    id,
    status: PaperTradeStatus.OPEN,
    source: PaperTradeSource.STRATEGY,
    symbol: SYMBOL,
    expression: 'CSP',
    governingVariant: 'trailing-20',
    order: { side: TradeSide.SHORT, type: 'LIMIT', quantity: 1 },
    fills: [],
    legs: [],
    marks: {},
    variantRuns: [],
    variantKeys: ['trailing-20'],
    realizedPnl: 0,
    unrealizedPnl: -25,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

const TRADES: PaperTrade[] = [
  seedTrade(`${PFX}-strat`, { strategyInstanceId: `${PFX}-inst` }),
  seedTrade(`${PFX}-sig`, {
    source: PaperTradeSource.SIGNAL,
    expression: 'CSP',
    cohortId: `${PFX}-cohort`,
    signalId: `${PFX}-sig`,
    variantKeys: ['trailing-20', 'time-9d'],
  }),
  seedTrade(`${PFX}-closed`, {
    status: PaperTradeStatus.CLOSED,
    expression: 'BCS',
    strategyInstanceId: `${PFX}-inst`,
    realizedPnl: 150,
    unrealizedPnl: 0,
  }),
];

const ACCOUNT: PaperAccount = {
  kind: PaperTradingKind.ACCOUNT,
  id: buildAccountId(UID),
  userId: UID,
  cash: 99_500,
  equity: 99_500,
  realizedPnl: 150,
  openTradeCount: 2,
  createdAt: NOW,
  updatedAt: NOW,
};

const tradeRef = (id: string) =>
  db.doc(`paper-trading/trades/items/${id}`);
const statsRef = (id: string) =>
  db.doc(`paper-trading/stats/items/${id}`);
const acctRef = db.doc(`paper-trading/accounts/items/${ACCOUNT.id}`);

const NAMESPACED_SCOPES = [
  `inst-${PFX}-inst`,
  `cohort-${PFX}-cohort`,
  `sig-${PFX}-sig`,
  `sym-${SYMBOL}`,
];

/** Variant scopes our seeds feed — shared keys, healed not deleted UNLESS
 *  they only exist because of this run (tracked below). */
const VAR_SCOPES = ['var-trailing-20', 'var-time-9d'];
const varScopeExisted = new Map<string, boolean>();

async function readStats(scope: string): Promise<PaperStats | null> {
  const snap = await statsRef(buildStatsId(scope)).get();
  return snap.exists ? ({ id: snap.id, ...snap.data() } as PaperStats) : null;
}

async function cleanup() {
  // Delete seeds, then re-run the pass so shared scopes (all + any var-*
  // that still has real trades) recompute WITHOUT our seeds. var-* docs
  // that only exist because of this run are never re-written by the
  // healed pass — delete those explicitly.
  const batch = db.batch();
  for (const t of TRADES) batch.delete(tradeRef(t.id));
  batch.delete(acctRef);
  await batch.commit();
  await runPaperStatsPass(DATE, createPaperStatsPassDeps());
  const batch2 = db.batch();
  for (const scope of NAMESPACED_SCOPES) batch2.delete(statsRef(buildStatsId(scope)));
  for (const scope of VAR_SCOPES) {
    if (!varScopeExisted.get(scope)) {
      batch2.delete(statsRef(buildStatsId(scope)));
    }
  }
  await batch2.commit();
  console.log('cleanup: seeds deleted, shared scopes recomputed, namespaced/orphan scopes removed');
}

async function main() {
  console.log(`seeding ${TRADES.length} trades + account under ${PFX}-*`);
  const batch = db.batch();
  for (const t of TRADES) batch.set(tradeRef(t.id), t);
  batch.set(acctRef, ACCOUNT);
  await batch.commit();

  const deps = paperReadDeps();

  // Snapshot which var-* scope docs already exist so cleanup knows whether
  // to delete (created by us) or heal (real docs recomputed post-delete).
  for (const scope of VAR_SCOPES) {
    varScopeExisted.set(scope, (await statsRef(buildStatsId(scope)).get()).exists);
  }

  try {
    // ── Stats pass ────────────────────────────────────────────────────
    const summary = await runPaperStatsPass(DATE, createPaperStatsPassDeps());
    check('stats pass: no errors', summary.errors.length === 0,
      summary.errors.join('; '));
    for (const scope of NAMESPACED_SCOPES) {
      check(`stats pass: scope ${scope} written`,
        summary.scopesWritten.includes(scope));
    }
    check('stats pass: all + var-* scopes written',
      summary.scopesWritten.includes('all') &&
        summary.scopesWritten.includes('var-trailing-20') &&
        summary.scopesWritten.includes('var-time-9d'));

    const symStats = await readStats(`sym-${SYMBOL}`);
    check('sym scope doc: counts all 3 seeded trades',
      !!symStats && symStats.openTradeCount === 2 && symStats.closedTradeCount === 1 &&
        symStats.totalRealizedPnl === 150 && symStats.totalUnrealizedPnl === -50,
      JSON.stringify(symStats && {
        o: symStats.openTradeCount, c: symStats.closedTradeCount,
        r: symStats.totalRealizedPnl, u: symStats.totalUnrealizedPnl,
      }));
    check('sym scope doc: equity curve point for today + maxDrawdown',
      !!symStats && symStats.equityCurve.some((p) => p.date === DATE) &&
        symStats.maxDrawdown >= 0);
    const instStats = await readStats(`inst-${PFX}-inst`);
    check('inst scope: only the two inst-attributed trades',
      !!instStats && instStats.openTradeCount === 1 && instStats.closedTradeCount === 1);
    const varStats = await readStats('var-time-9d');
    check('var scope: only the shadow-variant trade counted',
      !!varStats && varStats.openTradeCount === 1);

    // ── listPaperTrades ───────────────────────────────────────────────
    const all = await handleListPaperTrades(req({ symbol: SYMBOL }), deps);
    check('listPaperTrades: symbol filter returns the 3 seeds',
      all.trades.length === 3);

    const combo = await handleListPaperTrades(
      req({ cohortId: `${PFX}-cohort`, expression: 'CSP' }), deps);
    check('listPaperTrades: cohort+expression AND-combine',
      combo.trades.length === 1 && combo.trades[0].id === `${PFX}-sig`);

    const variant = await handleListPaperTrades(
      req({ symbol: SYMBOL, variantKey: 'time-9d' }), deps);
    check('listPaperTrades: variantKey array-contains filter',
      variant.trades.length === 1 && variant.trades[0].id === `${PFX}-sig`);

    const closed = await handleListPaperTrades(
      req({ symbol: SYMBOL, status: PaperTradeStatus.CLOSED }), deps);
    check('listPaperTrades: status filter',
      closed.trades.length === 1 && closed.trades[0].realizedPnl === 150);

    // ── getPaperStats ─────────────────────────────────────────────────
    const symScope = await handleGetPaperStats(req({ scope: `sym-${SYMBOL}` }), deps);
    check('getPaperStats: named scope returns the doc',
      symScope.stats.length === 1 && symScope.stats[0].scope === `sym-${SYMBOL}`);

    const enumerated = await handleGetPaperStats(req({}), deps);
    check('getPaperStats: omitted scope enumerates all docs incl. namespaced',
      enumerated.stats.some((s) => s.scope === `sym-${SYMBOL}`) &&
        enumerated.stats.some((s) => s.scope === 'all'));

    const missing = await handleGetPaperStats(req({ scope: 'sym-NOPE' }), deps);
    check('getPaperStats: unknown scope returns []', missing.stats.length === 0);

    // ── getPaperAccount / listExitVariants ────────────────────────────
    const acct = await handleGetPaperAccount(req({}), deps);
    check('getPaperAccount: seeded account returned',
      acct.account?.cash === 99_500 && acct.account.openTradeCount === 2);

    const noAcct = await handleGetPaperAccount(req({}, 'no-such-uid'), deps);
    check('getPaperAccount: missing account → null', noAcct.account === null);

    const variants = await handleListExitVariants(req({}));
    const keys = variants.variants.map((v) => v.key);
    check('listExitVariants: registry defaults',
      keys.includes('initial-stop-10') && keys.includes('trailing-20') &&
        keys.includes('time-9d') && keys.includes('limit-sd1'));
  } finally {
    await cleanup();
  }

  console.log(`\n=== ${passed} passed, ${failed} failed ===`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch(async (err) => {
  console.error('verification crashed:', err);
  try {
    await cleanup();
  } catch { /* best-effort */ }
  process.exit(1);
});
