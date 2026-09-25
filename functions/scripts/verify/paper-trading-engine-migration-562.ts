/**
 * @topic #553 — Paper Trading Infra (task #562)
 *
 * Real-environment verification for the engine migration:
 * seeds namespaced legacy `options-strategy-*` docs, runs the actual
 * migration script with --apply --only=verify-562-, reads the results back
 * through the migrated repositories, checks P&L parity, and cleans up all
 * documents it created (old and new collections).
 *
 * Requires ADC + NODE_OPTIONS ipv4 preload. Run from functions/:
 *   npx tsx scripts/verify/paper-trading-engine-migration-562.ts
 */

import { db } from '../../src/firebase-admin-init';
import { runMigration } from '../migrate-options-strategy-to-paper';
import { PaperTradingKind } from '../../../shared/paper-trading-contracts';
import type { PaperAccount, PaperTrade } from '../../../shared/paper-trading-contracts';
import {
  getPosition,
  getLegs,
  listOpenPositions,
  markPositionSettled,
} from '../../src/paper-trading/engine/position-repository';
import { getInstance } from '../../src/paper-trading/engine/strategy-instance-repository';
import { defaultReadStatsDoc, getEquityCurve, defaultStatsDeps } from '../../src/paper-trading/engine/stats-repository';
import { LegOutcome, PositionStatus } from '../../src/paper-trading/engine/types';
import { OptionType } from '../../../shared/options-common';
import { TradeSide } from '../../../shared/common';
import { LifecycleState } from '../../../shared/options-strategy-engine-contracts';

const PREFIX = 'verify-562';
const INSTANCE_ID = `${PREFIX}-inst`;
const POSITION_ID = `${PREFIX}-pos-1`;
const INSTANCES_OLD = 'options-strategy-instances';
const POSITIONS_OLD = 'options-strategy-positions';
const STATS_OLD = 'options-strategy-stats';

let passed = 0;
let failed = 0;
function check(name: string, cond: boolean, detail?: string) {
  if (cond) { passed++; console.log(`OK   ${name}`); }
  else { failed++; console.log(`FAIL ${name}${detail ? ` — ${detail}` : ''}`); }
}

const now = new Date().toISOString();
const today = now.slice(0, 10);

async function seed() {
  const batch = db.batch();

  batch.set(db.collection(INSTANCES_OLD).doc(INSTANCE_ID), {
    id: INSTANCE_ID,
    symbol: 'QQQM',
    optionType: OptionType.PUT,
    side: TradeSide.SHORT,
    targetDelta: 0.2,
    dteMin: 21,
    dteMax: 30,
    phases: [{ spreadType: 'CASH_SECURED_PUT', targetDelta: 0.2, dteMin: 21, dteMax: 30 }],
    frequency: 'DAILY',
    openTimePT: '12:00',
    exitPolicies: [],
    lifecycleState: LifecycleState.ACTIVE,
    userId: `${PREFIX}-user`,
    createdAt: now,
    updatedAt: now,
  });

  const posRef = db.collection(POSITIONS_OLD).doc(POSITION_ID);
  batch.set(posRef, {
    instanceId: INSTANCE_ID,
    symbol: 'QQQM',
    status: 'OPEN',
    premiumCollected: 210,
    capitalRequired: 9750,
    openDate: today,
    currentValue: 210,
    currentValueAsOf: now,
    unrealizedPnl: 0,
    createdAt: now,
  });
  batch.set(posRef.collection('legs').doc(`PUT-97.50-${today}`), {
    id: `PUT-97.50-${today}`,
    type: OptionType.PUT,
    side: TradeSide.SHORT,
    strike: 97.5,
    expiration: today,
    openDate: today,
    contractID: 'QQQM260925P00097500',
    premium: 2.1,
  });
  batch.set(posRef.collection('daily-updates').doc(today), {
    date: today,
    underlyingClose: 99.25,
  });
  batch.set(posRef.collection('raw-quotes').doc(today), {
    date: today,
    rawResponse: { mark: 2.1, source: 'verify-562' },
  });

  batch.set(db.collection(STATS_OLD).doc(INSTANCE_ID), {
    scope: INSTANCE_ID,
    totalPremiumCollected: 210,
    totalRealizedPnl: 0,
    totalUnrealizedPnl: 0,
    openPositionCount: 1,
    closedPositionCount: 0,
    assignedCount: 0,
    expiredWorthlessCount: 0,
    maxDrawdown: 0,
    lastUpdated: now,
  });
  const prevDate = '2026-01-01';
  batch.set(
    db.collection(STATS_OLD).doc(INSTANCE_ID).collection('equity-curve').doc(prevDate),
    { date: prevDate, cumulativePnl: 42.5 },
  );
  batch.set(
    db.collection(STATS_OLD).doc(INSTANCE_ID).collection('equity-curve').doc(today),
    { date: today, cumulativePnl: 0 },
  );

  await batch.commit();
  console.log('seeded legacy verify-562 docs');
}

async function cleanup() {
  // new layout
  const anchors = ['instances', 'trades', 'stats', 'raw-quotes', 'accounts'];
  for (const anchor of anchors) {
    const snap = await db.collection(`paper-trading/${anchor}/items`).get();
    const b = db.batch();
    for (const d of snap.docs) if (d.id.includes(PREFIX)) b.delete(d.ref);
    await b.commit();
  }
  // legacy docs
  const posRef = db.collection(POSITIONS_OLD).doc(POSITION_ID);
  for (const sub of ['legs', 'daily-updates', 'raw-quotes']) {
    const snap = await posRef.collection(sub).get();
    const b = db.batch();
    snap.docs.forEach((d) => b.delete(d.ref));
    await b.commit();
  }
  await posRef.delete();
  const curveSnap = await db.collection(STATS_OLD).doc(INSTANCE_ID).collection('equity-curve').get();
  const cb = db.batch();
  curveSnap.docs.forEach((d) => cb.delete(d.ref));
  await cb.commit();
  await db.collection(STATS_OLD).doc(INSTANCE_ID).delete();
  await db.collection(INSTANCES_OLD).doc(INSTANCE_ID).delete();
  console.log('cleanup: verification docs removed');
}

async function main(): Promise<void> {
  await seed();

  // Run the real migration restricted to our seed ids.
  await runMigration({ apply: true, only: PREFIX });

  // ── Instance ──
  const inst = await getInstance(INSTANCE_ID);
  check('instance readable via migrated repository', inst !== null && inst.symbol === 'QQQM');
  check('instance keeps legacy lifecycle fields', inst?.lifecycleState === 'ACTIVE' && inst?.userId === `${PREFIX}-user`);

  // ── Trade doc ──
  const rawTrade = await db.doc(`paper-trading/trades/items/${POSITION_ID}`).get();
  check('trade doc exists at trades/items anchor', rawTrade.exists);
  const trade = rawTrade.exists
    ? ({ id: rawTrade.id, ...(rawTrade.data() as object) } as PaperTrade)
    : null;
  check('trade is a PaperTrade doc', trade?.kind === PaperTradingKind.TRADE);
  check('trade legs embedded',
    (trade?.legs.length ?? 0) === 1 &&
    trade?.legs[0].kind === 'option' &&
    trade.legs[0].strike === 97.5,
  );
  check('trade entry fill synthesized', trade?.fills[0]?.role === 'entry' && trade?.fills[0].price === 2.1);
  check('trade marks embedded from daily-updates', trade?.marks[today]?.underlyingClose === 99.25);
  check('trade source = strategy', trade?.source === 'strategy');
  check('trade strategyInstanceId preserved', trade?.strategyInstanceId === INSTANCE_ID);

  // ── Position view through adapter ──
  const pos = await getPosition(POSITION_ID);
  check('adapter: position view reads back', pos !== null);
  check('adapter: premiumCollected preserved (2.1 × 100)', pos?.premiumCollected === 210);
  check('adapter: capitalRequired preserved', pos?.capitalRequired === 9750);
  check('adapter: status mapped OPEN', pos?.status === 'OPEN');
  const legs = await getLegs(POSITION_ID);
  check('adapter: getLegs returns embedded legs', legs.length === 1 && legs[0].premium === 2.1);
  const open = await listOpenPositions(INSTANCE_ID);
  check('adapter: listOpenPositions finds the migrated position', open.some((p) => p.id === POSITION_ID));

  // ── Raw quote ──
  const rqSnap = await db.collection('paper-trading/raw-quotes/items')
    .where('tradeId', '==', POSITION_ID).get();
  check('raw quote migrated to raw-quotes anchor', rqSnap.size === 1);

  // ── Stats ──
  const stats = await defaultReadStatsDoc(INSTANCE_ID);
  check('stats doc migrated (premium + open count)', stats?.totalPremiumCollected === 210 && stats?.openPositionCount === 1);
  const curve = await getEquityCurve(INSTANCE_ID, { readEquityCurve: defaultStatsDeps.getExistingEquityCurve });
  check('equity curve embedded — identical points pre/post migration',
    curve.length === 2 &&
    curve[0].date === '2026-01-01' && curve[0].cumulativePnl === 42.5 &&
    curve[1].date === today && curve[1].cumulativePnl === 0,
  );

  // ── Seeded account + real settlement txn ──
  // Migration reconstructs acct-{userId} from the position: +210 premium
  // credit cash, 1 open trade, −210 short-liability open value → equity 0.
  const acctSnap = await db.doc(`paper-trading/accounts/items/acct-${PREFIX}-user`).get();
  const acct = acctSnap.data() as PaperAccount | undefined;
  check('account seeded by migration (premium cash, open count)',
    acctSnap.exists && acct?.cash === 210 && acct?.openTradeCount === 1 && acct?.realizedPnl === 0);

  // markPositionSettled runs a real Firestore transaction — exercises the
  // reads-before-writes ordering and account bookkeeping in one atomic unit.
  const legId = `PUT-97.50-${today}`;
  await markPositionSettled(
    POSITION_ID,
    {
      status: PositionStatus.EXPIRED_WORTHLESS,
      currentValue: 0,
      currentValueAsOf: new Date().toISOString(),
      unrealizedPnl: 210,
    },
    [{ legId, outcome: LegOutcome.EXPIRED_WORTHLESS, closeDate: today }],
    { date: today, underlyingClose: 99.25 },
  );

  const settled = await getPosition(POSITION_ID);
  check('settlement: legacyStatus round-trips EXPIRED_WORTHLESS',
    settled?.status === PositionStatus.EXPIRED_WORTHLESS);
  const settledTrade = (await db.doc(`paper-trading/trades/items/${POSITION_ID}`).get())
    .data() as PaperTrade;
  check('settlement: trade realized premium, unrealized cleared',
    settledTrade.realizedPnl === 210 && settledTrade.unrealizedPnl === 0);
  check('settlement: leg outcome + closeDate stamped',
    settledTrade.legs[0].outcome === 'EXPIRED_WORTHLESS' && settledTrade.legs[0].closeDate === today);
  const acctAfter = (await db.doc(`paper-trading/accounts/items/acct-${PREFIX}-user`).get())
    .data() as PaperAccount;
  check('settlement: account decremented + premium realized',
    acctAfter.openTradeCount === 0 && acctAfter.realizedPnl === 210);
  check('settlement: equity released (cash + open value)',
    acctAfter.cash === 210 && acctAfter.equity === 210);

  await cleanup();
  console.log(`\n=== ${passed} passed, ${failed} failed ===`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch(async (err) => {
  console.error('verification error:', err instanceof Error ? err.message : String(err));
  try { await cleanup(); } catch { /* best effort */ }
  process.exit(1);
});
