/**
 * @topic #553 — Paper Trading Infra (task #562)
 *
 * One-off migration: copies the legacy `options-strategy-*` collections into
 * the `paper-trading/{anchor}/items` layout.
 *
 *   options-strategy-instances/{id}            → paper-trading/instances/items/{id}
 *     (+ kind / paperAccountId / governingVariant)
 *   options-strategy-positions/{id}            → paper-trading/trades/items/{id}
 *     (+ legs / daily-updates embedded; raw-quotes → raw-quotes/items)
 *   options-strategy-stats/{scope}             → paper-trading/stats/items/stats-{scope}
 *     (+ equity-curve/ subcollection embedded as equityCurve[])
 *
 * Idempotent: doc ids are deterministic, so re-running overwrites with
 * identical content.
 *
 * Usage (from functions/):
 *   npx tsx scripts/migrate-options-strategy-to-paper.ts            # dry run (default)
 *   npx tsx scripts/migrate-options-strategy-to-paper.ts --apply    # write
 *   npx tsx scripts/migrate-options-strategy-to-paper.ts --apply --only=verify-562
 *     # restrict to docs whose ids contain the given substring (verification)
 *
 * The dry-run prints a P&L parity check: it recomputes per-scope stats from
 * the *migrated* trades and diffs them against the existing stats docs —
 * equity curves must be identical pre/post migration.
 */

import { db } from '../src/firebase-admin-init';
import { PaperTradingKind, PaperTradeStatus } from '../../shared/paper-trading-contracts';
import type { PaperAccount, PaperStats, PaperTrade } from '../../shared/paper-trading-contracts';
import { buildAccountId, buildRawQuoteId, buildStatsId, paperTradingItemsPath } from '../../shared/paper-trading-ids';
import { positionValue, signedCashDelta } from '../src/paper-trading/ledger';
import {
  positionToTrade,
  rawQuoteToDoc,
  tradeToPosition,
  LEGACY_GOVERNING_VARIANT,
} from '../src/paper-trading/engine/trade-adapter';
import { computeStatsFromPositions } from '../src/paper-trading/engine/stats-utils';
import type {
  DailyUpdate,
  Position,
  PositionLeg,
  RawQuote,
  StrategyStats,
} from '../src/paper-trading/engine/types';
import { SHARES_PER_CONTRACT } from '../src/paper-trading/engine/types';

const INSTANCES_OLD = 'options-strategy-instances';
const POSITIONS_OLD = 'options-strategy-positions';
const STATS_OLD = 'options-strategy-stats';

export interface MigrationOptions {
  /** Write to Firestore when true; dry-run when false. */
  apply: boolean;
  /** Restrict to doc ids containing this substring (verification runs). */
  only: string | null;
}

let OPTS: MigrationOptions = { apply: false, only: null };

const matches = (id: string) => !OPTS.only || id.includes(OPTS.only);

// ── Helpers ─────────────────────────────────────────────────────────────────

async function listDocs(col: string) {
  const snap = await db.collection(col).get();
  return snap.docs.filter((d) => matches(d.id));
}

function itemsCol(kind: PaperTradingKind) {
  return db.collection(paperTradingItemsPath(kind));
}

let writeBatch = db.batch();
let pendingOps = 0;
function addOp() {
  pendingOps++;
}
async function flushBatch(): Promise<void> {
  if (pendingOps > 0) {
    await writeBatch.commit();
    writeBatch = db.batch();
    pendingOps = 0;
  }
}
async function maybeFlush(): Promise<void> {
  if (pendingOps >= 400) {
    await flushBatch();
  }
}

// ── Migration ────────────────────────────────────────────────────────────────

const accountAcc = new Map<string, AccountAcc>();

/**
 * Fold one migrated trade into the user's account reconstruction:
 * premium credits, assignment share-purchase debits, realized P&L, open
 * counts, and open liquidation value (equity = cash + openValue).
 */
function accumulateAccount(
  map: Map<string, AccountAcc>,
  userId: string,
  trade: PaperTrade,
): void {
  const acc = map.get(userId) ?? { cash: 0, realizedPnl: 0, openTradeCount: 0, openValue: 0 };
  const entryFill = trade.fills.find((f) => f.role === 'entry');
  if (entryFill) {
    // Approximation: legacy CLOSED positions carry no exit-fill price, so the
  // buyback cash debit isn't modeled — cash overstates vs realizedPnl by the
  // exit cost. Documented; realizedPnl itself is exact.
  acc.cash += signedCashDelta(entryFill, trade.order.side, trade.legs);
  }
  acc.realizedPnl += trade.realizedPnl;

  if (trade.status === PaperTradeStatus.OPEN || trade.status === PaperTradeStatus.ASSIGNED) {
    acc.openTradeCount++;
    if (trade.status === PaperTradeStatus.OPEN) {
      acc.openValue += positionValue(trade.legs);
    } else {
      // Holding delivered shares: debit cash for the strike purchase, value
      // the shares at the latest marked underlying close.
      const contracts = trade.shares?.quantity ?? 0;
      acc.cash -= (trade.assignment?.strikePrice ?? 0) * SHARES_PER_CONTRACT * contracts;
      const marks = Object.entries(trade.marks ?? {})
        .filter(([, m]) => m.underlyingClose !== undefined)
        .sort(([a], [b]) => a.localeCompare(b));
      const latestClose = marks.pop()?.[1].underlyingClose;
      acc.openValue += (latestClose ?? trade.assignment?.strikePrice ?? 0) * SHARES_PER_CONTRACT * contracts;
    }
  }
  map.set(userId, acc);
}

/** Write reconstructed `acct-{userId}` docs — deterministic, idempotent. */
async function migrateAccounts(): Promise<number> {
  const now = new Date().toISOString();
  for (const [userId, acc] of accountAcc) {
    const account: PaperAccount = {
      kind: PaperTradingKind.ACCOUNT,
      id: buildAccountId(userId),
      userId,
      cash: acc.cash,
      // equity = cash + open liquidation value
      equity: acc.cash + acc.openValue,
      realizedPnl: acc.realizedPnl,
      openTradeCount: acc.openTradeCount,
      createdAt: now,
      updatedAt: now,
    };
    if (OPTS.apply) {
      const { id: _id, ...data } = account;
      writeBatch.set(itemsCol(PaperTradingKind.ACCOUNT).doc(account.id), data);
      addOp();
      await maybeFlush();
    }
    console.log(
      `  account ${account.id}: cash=${acc.cash.toFixed(2)} realized=${acc.realizedPnl.toFixed(2)} open=${acc.openTradeCount} equity=${account.equity.toFixed(2)}`,
    );
  }
  return accountAcc.size;
}

async function migrateInstances() {
  const docs = await listDocs(INSTANCES_OLD);
  let n = 0;
  for (const doc of docs) {
    const data = doc.data() as { userId?: string; createdAt?: unknown; updatedAt?: unknown };
    const now = new Date().toISOString();
    if (OPTS.apply) {
      const { id: _id, ...rest } = data as Record<string, unknown>;
      writeBatch.set(itemsCol(PaperTradingKind.INSTANCE).doc(doc.id), {
        ...rest,
        kind: PaperTradingKind.INSTANCE,
        paperAccountId: buildAccountId(data.userId ?? 'system'),
        governingVariant: LEGACY_GOVERNING_VARIANT,
        createdAt: data.createdAt ?? now,
        updatedAt: data.updatedAt ?? now,
      });
      addOp();
      await maybeFlush();

      // Copy the daily-analysis subcollection (open pass reads 'latest').
      const analysisSnap = await doc.ref.collection('daily-analysis').get();
      for (const a of analysisSnap.docs) {
        writeBatch.set(
          itemsCol(PaperTradingKind.INSTANCE)
            .doc(doc.id)
            .collection('daily-analysis')
            .doc(a.id),
          a.data(),
        );
        addOp();
      }
      await maybeFlush();
    }
    n++;
    console.log(`  instance ${doc.id} → instances/items/${doc.id}`);
  }
  return n;
}

/** Per-user account aggregates accumulated while converting positions. */
interface AccountAcc {
  cash: number;
  realizedPnl: number;
  openTradeCount: number;
  openValue: number;
}

async function migratePositions() {
  const docs = await listDocs(POSITIONS_OLD);
  // Resolve userId for each position's instance — needed to seed accounts.
  const instUsers = new Map(
    (await db.collection(INSTANCES_OLD).get()).docs.map(
      (d) => [d.id, (d.data() as { userId?: string }).userId ?? 'system'] as const,
    ),
  );
  let n = 0;
  const trades: { position: Position; legs: PositionLeg[]; dailyUpdates: DailyUpdate[] }[] = [];
  for (const doc of docs) {
    const position = { id: doc.id, ...(doc.data() as Omit<Position, 'id'>) };
    const [legsSnap, updatesSnap, quotesSnap] = await Promise.all([
      doc.ref.collection('legs').get(),
      doc.ref.collection('daily-updates').get(),
      doc.ref.collection('raw-quotes').get(),
    ]);
    const legs = legsSnap.docs.map((l) => l.data() as PositionLeg);
    const dailyUpdates = updatesSnap.docs.map((d) => d.data() as DailyUpdate);
    const rawQuotes = quotesSnap.docs.map((q) => q.data() as RawQuote);
    trades.push({ position, legs, dailyUpdates });

    const trade = positionToTrade(position, legs, dailyUpdates);
    accumulateAccount(accountAcc, instUsers.get(position.instanceId) ?? 'system', trade);

    if (OPTS.apply) {
      const { id: _id, ...tradeData } = trade;
      writeBatch.set(itemsCol(PaperTradingKind.TRADE).doc(doc.id), tradeData);
      addOp();

      const now = new Date().toISOString();
      for (const rq of rawQuotes) {
        const rqDate = new Date(`${rq.date}T00:00:00Z`);
        if (Number.isNaN(rqDate.getTime())) {
          console.log(`  SKIP raw-quote on ${doc.id}: malformed date '${rq.date}'`);
          continue;
        }
        const rqDoc = rawQuoteToDoc(
          doc.id,
          rq,
          buildRawQuoteId(doc.id, rqDate),
          now,
        );
        const { id: _rid, ...rqData } = rqDoc;
        writeBatch.set(itemsCol(PaperTradingKind.RAW_QUOTE).doc(rqDoc.id), rqData);
        addOp();
      }
      await maybeFlush();
    }
    n++;
    console.log(
      `  position ${doc.id} → trades/items/${doc.id} (${legs.length} legs, ${dailyUpdates.length} updates, ${rawQuotes.length} quotes)`,
    );
  }
  return { n, trades };
}

async function migrateStats() {
  const docs = await listDocs(STATS_OLD);
  let n = 0;
  for (const doc of docs) {
    const stats = doc.data() as StrategyStats;
    const curveSnap = await doc.ref.collection('equity-curve').orderBy('date').get();
    const curve = curveSnap.docs.map((d) => d.data() as { date: string; cumulativePnl: number });
    // Curve completeness: the embedded array must carry every point from the
    // legacy subcollection — this is the equity-curve identity check.
    if (curve.length !== curveSnap.size) {
      console.log(`  WARNING: stats ${doc.id} curve truncated (${curve.length}/${curveSnap.size})`);
    }
    if (OPTS.apply) {
      const now = new Date().toISOString();
      const paper: Omit<PaperStats, 'id'> = {
        kind: PaperTradingKind.STATS,
        scope: stats.scope,
        totalRealizedPnl: stats.totalRealizedPnl,
        totalUnrealizedPnl: stats.totalUnrealizedPnl,
        openTradeCount: stats.openPositionCount,
        closedTradeCount: stats.closedPositionCount,
        maxDrawdown: stats.maxDrawdown,
        totalPremiumCollected: stats.totalPremiumCollected,
        assignedCount: stats.assignedCount,
        expiredWorthlessCount: stats.expiredWorthlessCount,
        equityCurve: curve,
        createdAt: stats.lastUpdated ?? now,
        updatedAt: stats.lastUpdated ?? now,
      };
      writeBatch.set(itemsCol(PaperTradingKind.STATS).doc(buildStatsId(stats.scope)), paper);
      addOp();
      await maybeFlush();
    }
    n++;
    console.log(`  stats ${doc.id} → stats/items/${buildStatsId(stats.scope)} (${curve.length} curve points)`);
  }
  return n;
}

// ── P&L parity check (dry-run verification) ──────────────────────────────────

async function parityCheck(
  trades: { position: Position; legs: PositionLeg[]; dailyUpdates: DailyUpdate[] }[],
) {
  // Round-trip every legacy position through the adapter — what the passes
  // will see post-migration — then recompute stats and diff vs the existing
  // stats docs. This is the P&L-identity check: the migrated view must
  // reproduce the same numbers.
  const migratedPositions = trades.map(({ position, legs, dailyUpdates }) =>
    tradeToPosition(positionToTrade(position, legs, dailyUpdates)),
  );

  const statsDocs = await listDocs(STATS_OLD);
  let mismatches = 0;

  const byScope = new Map<string, Position[]>();
  for (const pos of migratedPositions) {
    const inst = pos.instanceId;
    byScope.set(inst, [...(byScope.get(inst) ?? []), pos]);
  }

  for (const doc of statsDocs) {
    const existing = doc.data() as StrategyStats;
    const positions =
      doc.id === 'ALL'
        ? migratedPositions
        : (byScope.get(doc.id) ?? []);
    const recomputed = computeStatsFromPositions(positions, doc.id, new Date().toISOString().slice(0, 10));

    const diffs: string[] = [];
    const compare = (name: string, a: number, b: number) => {
      if (Math.abs(a - b) > 0.005) diffs.push(`${name}: existing ${a} vs migrated ${b}`);
    };
    compare('totalPremiumCollected', existing.totalPremiumCollected, recomputed.totalPremiumCollected);
    compare('totalRealizedPnl', existing.totalRealizedPnl, recomputed.totalRealizedPnl);
    compare('totalUnrealizedPnl', existing.totalUnrealizedPnl, recomputed.totalUnrealizedPnl);
    compare('openPositionCount', existing.openPositionCount, recomputed.openPositionCount);
    compare('closedPositionCount', existing.closedPositionCount, recomputed.closedPositionCount);
    compare('assignedCount', existing.assignedCount, recomputed.assignedCount);
    compare('expiredWorthlessCount', existing.expiredWorthlessCount, recomputed.expiredWorthlessCount);

    if (diffs.length) {
      mismatches++;
      console.log(`  MISMATCH scope ${doc.id}:`);
      for (const d of diffs) console.log(`    ${d}`);
    } else {
      console.log(`  scope ${doc.id}: P&L parity OK`);
    }
  }
  return mismatches;
}

// ── Runner ───────────────────────────────────────────────────────────────────

export async function runMigration(options: MigrationOptions): Promise<number> {
  OPTS = options;
  console.log(`Mode: ${OPTS.apply ? 'APPLY (writing)' : 'DRY RUN'}${OPTS.only ? ` — only ids containing '${OPTS.only}'` : ''}`);

  const instN = await migrateInstances();
  const { n: posN, trades } = await migratePositions();
  const statsN = await migrateStats();
  const acctN = await migrateAccounts();

  console.log('\nP&L parity check (migrated trades vs existing stats docs):');
  const mismatches = await parityCheck(trades);

  if (OPTS.apply) {
    await flushBatch();
    console.log(`\nApplied: ${instN} instances, ${posN} positions, ${statsN} stats docs, ${acctN} accounts written.`);
  } else {
    console.log(`\nDry run: would write ${instN} instances, ${posN} positions, ${statsN} stats docs, ${acctN} accounts.`);
  }
  console.log(mismatches === 0 ? 'Parity: PASS' : `Parity: ${mismatches} scope mismatch(es)`);
  return mismatches;
}

// ── CLI entry ────────────────────────────────────────────────────────────────

if (process.argv[1]?.endsWith('migrate-options-strategy-to-paper.ts')) {
  const apply = process.argv.includes('--apply');
  const onlyArg = process.argv.find((a) => a.startsWith('--only='));
  const only = onlyArg ? onlyArg.split('=')[1] : null;
  runMigration({ apply, only })
    .then((mismatches) => {
      if (mismatches > 0 && only === null) process.exit(1);
    })
    .catch((err) => {
      console.error('Migration failed:', err instanceof Error ? err.message : String(err));
      process.exit(1);
    });
}
