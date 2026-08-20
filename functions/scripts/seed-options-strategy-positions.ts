/**
 * @topic #137 — Strategy Builder UI
 *
 * Seed script for demo options-strategy-positions and stats.
 * Writes 4 positions (2 open, 2 closed) across 2 instances, plus
 * equity-curve points and stats for the ALL scope.
 *
 * Usage:
 *   npx tsx functions/scripts/seed-options-strategy-positions.ts
 */

import { db } from '../src/firebase-admin-init';
import {
  OPTIONS_STRATEGY_POSITIONS_COLLECTION,
  OPTIONS_STRATEGY_STATS_COLLECTION,
} from '../src/options-strategy-engine/collections';
import { PositionStatus, LegOutcome } from '../src/options-strategy-engine/types';
import { OptionType } from '@options/common';
import { TradeSide } from '@common';

const now = new Date();
const iso = (d: Date) => d.toISOString();
const daysAgo = (n: number) => new Date(now.getTime() - n * 86400000);
const daysAhead = (n: number) => new Date(now.getTime() + n * 86400000);

const INSTANCE_QQQM = '250816-QQQM-CSP-020-30-D-1200';
const INSTANCE_SPY = '250816-SPY-CSP-018-14-D-1200';

// ── Positions ────────────────────────────────────────────────────────────────

const positions: Array<{ id: string; data: Record<string, unknown> }> = [
  // Open QQQM put
  {
    id: 'demo-pos-qqqm-open-1',
    data: {
      instanceId: INSTANCE_QQQM,
      symbol: 'QQQM',
      status: PositionStatus.OPEN,
      premiumCollected: 125,
      capitalRequired: 20000,
      openDate: iso(daysAgo(5)),
      currentValue: 80,
      currentValueAsOf: iso(now),
      unrealizedPnl: 45,
      createdAt: iso(daysAgo(5)),
    },
  },
  // Open SPY put
  {
    id: 'demo-pos-spy-open-1',
    data: {
      instanceId: INSTANCE_SPY,
      symbol: 'SPY',
      status: PositionStatus.OPEN,
      premiumCollected: 95,
      capitalRequired: 15000,
      openDate: iso(daysAgo(3)),
      currentValue: 60,
      currentValueAsOf: iso(now),
      unrealizedPnl: 35,
      createdAt: iso(daysAgo(3)),
    },
  },
  // Closed QQQM — expired worthless
  {
    id: 'demo-pos-qqqm-closed-1',
    data: {
      instanceId: INSTANCE_QQQM,
      symbol: 'QQQM',
      status: PositionStatus.EXPIRED_WORTHLESS,
      premiumCollected: 110,
      capitalRequired: 20000,
      openDate: iso(daysAgo(35)),
      currentValue: 0,
      currentValueAsOf: iso(daysAgo(7)),
      unrealizedPnl: 0,
      realizedPnl: 110,
      createdAt: iso(daysAgo(35)),
    },
  },
  // Closed SPY — assigned, holding shares
  {
    id: 'demo-pos-spy-closed-1',
    data: {
      instanceId: INSTANCE_SPY,
      symbol: 'SPY',
      status: PositionStatus.ASSIGNED_HOLDING_SHARES,
      premiumCollected: 85,
      capitalRequired: 15000,
      openDate: iso(daysAgo(28)),
      currentValue: 0,
      currentValueAsOf: iso(daysAgo(14)),
      unrealizedPnl: -200,
      realizedPnl: 85,
      shares: { quantity: 100, costBasis: 575 },
      assignment: {
        strikePrice: 575,
        underlyingCloseAtExpiration: 572,
        assignedAt: iso(daysAgo(14)),
      },
      createdAt: iso(daysAgo(28)),
    },
  },
];

// ── Legs (subcollection per position) ────────────────────────────────────────

const legs: Array<{ positionId: string; leg: Record<string, unknown> }> = [
  {
    positionId: 'demo-pos-qqqm-open-1',
    leg: {
      id: 'leg-1',
      type: OptionType.PUT,
      side: TradeSide.SHORT,
      strike: 185,
      expiration: iso(daysAhead(23)),
      openDate: iso(daysAgo(5)),
      contractID: 'QQQM_2026-09-12_PUT_185',
      premium: 125,
    },
  },
  {
    positionId: 'demo-pos-spy-open-1',
    leg: {
      id: 'leg-1',
      type: OptionType.PUT,
      side: TradeSide.SHORT,
      strike: 580,
      expiration: iso(daysAhead(11)),
      openDate: iso(daysAgo(3)),
      contractID: 'SPY_2026-08-29_PUT_580',
      premium: 95,
    },
  },
  {
    positionId: 'demo-pos-qqqm-closed-1',
    leg: {
      id: 'leg-1',
      type: OptionType.PUT,
      side: TradeSide.SHORT,
      strike: 182,
      expiration: iso(daysAgo(7)),
      openDate: iso(daysAgo(35)),
      contractID: 'QQQM_2026-08-12_PUT_182',
      premium: 110,
      outcome: LegOutcome.EXPIRED_WORTHLESS,
    },
  },
  {
    positionId: 'demo-pos-spy-closed-1',
    leg: {
      id: 'leg-1',
      type: OptionType.PUT,
      side: TradeSide.SHORT,
      strike: 575,
      expiration: iso(daysAgo(14)),
      openDate: iso(daysAgo(28)),
      contractID: 'SPY_2026-08-05_PUT_575',
      premium: 85,
      outcome: LegOutcome.ASSIGNED,
    },
  },
];

// ── Stats + equity curve (ALL scope) ─────────────────────────────────────────

const equityCurvePoints: Array<{ date: string; cumulativePnl: number }> = [
  { date: iso(daysAgo(35)), cumulativePnl: 0 },
  { date: iso(daysAgo(28)), cumulativePnl: 110 },
  { date: iso(daysAgo(21)), cumulativePnl: 195 },
  { date: iso(daysAgo(14)), cumulativePnl: 280 },
  { date: iso(daysAgo(7)), cumulativePnl: 390 },
  { date: iso(now), cumulativePnl: 470 },
];

const statsDoc = {
  scope: 'ALL',
  totalPremiumCollected: 415,
  totalRealizedPnl: 195,
  totalUnrealizedPnl: 80,
  openPositionCount: 2,
  closedPositionCount: 2,
  assignedCount: 1,
  expiredWorthlessCount: 1,
  maxDrawdown: -50,
  lastUpdated: iso(now),
};

// ── Main ─────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const batch = db.batch();

  // Positions
  for (const { id, data } of positions) {
    const ref = db.collection(OPTIONS_STRATEGY_POSITIONS_COLLECTION).doc(id);
    batch.set(ref, data, { merge: true });
  }

  // Legs (subcollection)
  for (const { positionId, leg } of legs) {
    const ref = db
      .collection(OPTIONS_STRATEGY_POSITIONS_COLLECTION)
      .doc(positionId)
      .collection('legs')
      .doc(leg.id as string);
    batch.set(ref, leg, { merge: true });
  }

  // Stats doc (ALL scope)
  const statsRef = db.collection(OPTIONS_STRATEGY_STATS_COLLECTION).doc('ALL');
  batch.set(statsRef, statsDoc, { merge: true });

  // Equity curve points (subcollection of stats doc)
  for (const point of equityCurvePoints) {
    const ref = statsRef.collection('equity-curve').doc(point.date);
    batch.set(ref, point, { merge: true });
  }

  await batch.commit();
  console.log(`Seeded ${positions.length} positions, ${legs.length} legs, stats + ${equityCurvePoints.length} equity-curve points.`);
}

main().catch((err) => {
  console.error('Seed failed:', err instanceof Error ? err.message : String(err));
  process.exit(1);
});
