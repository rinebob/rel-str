/**
 * @topic #984 — ST Firestore Reorg (task #1563)
 *
 * Intraday stats freshness for paper-trade lifecycle transitions. The
 * ledger functions and `markPositionSettled` fire `incrementStatsOnTransition`
 * post-commit: one transaction of blind `FieldValue.increment` merge-sets
 * (no reads) over the freshness-tier scopes — `all`, `src-{source}`, and
 * `inst-{id}` when the trade carries a strategy instance. The remaining
 * scope families (`sym-`, `cohort-`, `sig-`, `var-`, `sigtype-`, `dir-`,
 * `sigstatus-`, `sector-`, `ind-`, `captier-`) stay nightly-only by design
 * — see the PRD's bounded-freshness decision.
 *
 * Increment docs are non-authoritative: the nightly `runPaperStatsPass`
 * recomputes every scope from trades and self-heals drift — both missed
 * increments (a crash between ledger commit and stats fire) and double
 * increments (a lost commit-ack retrying this txn; a nightly pass listing
 * trades between the two commits). Fields that aren't transition deltas —
 * `totalUnrealizedPnl`, `equityCurve`, `maxDrawdown` — stay at last-nightly
 * values until the recompute owns them again; `createdAt`/`equityCurve`
 * can't be minted blindly (a literal merge-set would clobber real values
 * on existing docs) so an increment-minted doc carries neither.
 *
 * Counter shape: every numeric stats field is written as
 * `FieldValue.increment(n ?? 0)` — `increment(0)` mints an absent field
 * at 0 and no-ops on a present one, so increment-minted docs carry the
 * complete counter shape without a read.
 *
 * Failure contract: the whole call — input resolution, scope derivation,
 * and the transaction — is inside one try/catch → warn. It can never
 * throw into a fill or settlement path. `markPositionSettled` calls this
 * directly (consistent with that file's module-`db` architecture); the
 * ledger routes it through the injectable `onStatsTransition` dep.
 */

import { FieldValue, db } from '../../firebase-admin-init';
import type { Transaction } from 'firebase-admin/firestore';
import {
  PaperTradingKind,
  PaperTradeStatus,
  type PaperStats,
  type PaperTrade,
  type PaperTradeSource,
} from '@paper-trading/contracts';
import {
  statsScopeAll,
  statsScopeInstance,
  statsScopeSource,
} from '@paper-trading/ids';
import { createLogger } from './logging';
import { statsDocRef } from './stats-repository';
import { premiumCollectedFor } from './trade-adapter';
import { PositionStatus } from './types';

const logger = createLogger('StatsIncrements');

// ── Deltas ──────────────────────────────────────────────────────────────────

/** The countable stats fields a transition may move. */
export type StatsIncrementDeltas = Partial<
  Pick<
    PaperStats,
    | 'openTradeCount'
    | 'closedTradeCount'
    | 'totalPremiumCollected'
    | 'totalRealizedPnl'
    | 'assignedCount'
    | 'expiredWorthlessCount'
  >
>;

export interface StatsIncrementInput {
  source: PaperTradeSource;
  strategyInstanceId?: string;
  deltas: StatsIncrementDeltas;
}

export type StatsIncrementFn = (input: StatsIncrementInput) => Promise<unknown>;

/** Every numeric PaperStats counter — minted at 0 on absent fields. */
const COUNTER_FIELDS: ReadonlyArray<
  | 'openTradeCount'
  | 'closedTradeCount'
  | 'totalPremiumCollected'
  | 'totalRealizedPnl'
  | 'totalUnrealizedPnl'
  | 'assignedCount'
  | 'expiredWorthlessCount'
  | 'maxDrawdown'
> = [
  'openTradeCount',
  'closedTradeCount',
  'totalPremiumCollected',
  'totalRealizedPnl',
  'totalUnrealizedPnl',
  'assignedCount',
  'expiredWorthlessCount',
  'maxDrawdown',
];

/** The `{source, inst?}` scope fields every transition shares. */
export function statsInputFor(
  trade: PaperTrade,
  deltas: StatsIncrementDeltas,
): StatsIncrementInput {
  return {
    source: trade.source,
    ...(trade.strategyInstanceId
      ? { strategyInstanceId: trade.strategyInstanceId }
      : {}),
    deltas,
  };
}

// ── Delta table (mirrors computeStatsFromPositions) ─────────────────────────

/** → OPEN (entry fill or PENDING→OPEN). `premiumCollectedFor` is the same
 *  formula the position adapter/recompute sum. */
export function statsDeltasOnOpen(trade: PaperTrade): StatsIncrementDeltas {
  return {
    openTradeCount: 1,
    totalPremiumCollected: premiumCollectedFor(trade),
  };
}

/**
 * → terminal CLOSED. `realizedPnl` is the doc's post-write value — the
 * recompute counts it via the `unrealizedPnl` adapter slot, so the
 * increment must carry the same field (assignment-banked premium is
 * included only if it survives in the doc). `fromStatus` is the trade's
 * pre-transition status: the recompute's `assignedCount` counts trades
 * CURRENTLY in ASSIGNED, so closing one hands the count back.
 */
export function statsDeltasOnClose(
  trade: PaperTrade,
  fromStatus?: PaperTradeStatus,
): StatsIncrementDeltas {
  return {
    openTradeCount: -1,
    closedTradeCount: 1,
    ...(fromStatus === PaperTradeStatus.ASSIGNED
      ? { assignedCount: -1 }
      : {}),
    totalRealizedPnl: trade.realizedPnl,
  };
}

/**
 * Settlement transitions — `premium` is the value `markPositionSettled`
 * banks into the doc (`signedCashDelta(entryFill)`). EXPIRED closes the
 * position and realizes it; ASSIGNED keeps the position open and is the
 * recompute's `assignedCount` branch — premium stays out of stats until a
 * later close counts the doc's realized field.
 */
export function statsDeltasOnSettle(
  status: PositionStatus.EXPIRED_WORTHLESS | PositionStatus.ASSIGNED_HOLDING_SHARES,
  premium: number,
): StatsIncrementDeltas {
  if (status === PositionStatus.EXPIRED_WORTHLESS) {
    return {
      openTradeCount: -1,
      closedTradeCount: 1,
      expiredWorthlessCount: 1,
      totalRealizedPnl: premium,
    };
  }
  return { assignedCount: 1 };
}

// ── Write ───────────────────────────────────────────────────────────────────

export interface StatsIncrementDeps {
  runTransaction<T>(work: (txn: Transaction) => Promise<T>): Promise<T>;
}

const defaultDeps: StatsIncrementDeps = {
  runTransaction: (work) => db.runTransaction(work),
};

/**
 * Blind-increment every scope the transition touches. One transaction —
 * a partial failure can't leave the scope docs diverged — with no reads,
 * so increment-on-absent-field just mints the value. `kind`/`scope`/
 * `updatedAt` merge-set idempotently for docs the nightly pass owns
 * (`updatedAt` is an ISO timestamp here; the recompute writes the market
 * date — both are "when this stat last moved" in different units).
 *
 * Accepts the input or a thunk producing it — a thunk keeps pure-arg
 * evaluation inside the never-throw boundary too.
 */
export async function incrementStatsOnTransition(
  input: StatsIncrementInput | (() => StatsIncrementInput),
  deps: StatsIncrementDeps = defaultDeps,
): Promise<void> {
  try {
    const resolved = typeof input === 'function' ? input() : input;
    const deltas = Object.entries(resolved.deltas).filter(
      (entry): entry is [string, number] => entry[1] !== undefined,
    );
    if (deltas.length === 0) return;
    const scopes = [
      statsScopeAll(),
      statsScopeSource(resolved.source),
      ...(resolved.strategyInstanceId
        ? [statsScopeInstance(resolved.strategyInstanceId)]
        : []),
    ];
    const updatedAt = new Date().toISOString();
    const counters = Object.fromEntries(
      COUNTER_FIELDS.map((f) => [
        f,
        FieldValue.increment(
          resolved.deltas[f as keyof StatsIncrementDeltas] ?? 0,
        ),
      ]),
    );
    await deps.runTransaction(async (txn) => {
      for (const scope of scopes) {
        txn.set(
          statsDocRef(scope),
          {
            kind: PaperTradingKind.STATS,
            scope,
            ...counters,
            updatedAt,
          },
          { merge: true },
        );
      }
    });
  } catch (err) {
    logger.warn(
      `stats increment skipped: ` +
        (err instanceof Error ? err.message : String(err)),
    );
  }
}
