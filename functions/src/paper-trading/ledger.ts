/**
 * @topic #553 — Paper Trading Infra (task #561)
 *
 * The ledger seam: `applyEntryFill` / `applyExitFill` are the single boundary
 * where order terms + a fill become a trade lifecycle doc plus a cash delta on
 * `acct-{userId}`.
 *
 * Atomicity: every applyFill runs inside `deps.transact` — a Firestore
 * transaction for the production wiring (`repository.ledgerDeps`). Reads,
 * the collision check, and the account+trade writes all happen inside one
 * transaction, so a concurrent mark/fill on the same docs retries rather
 * than silently overwriting.
 *
 * Cash conventions:
 * - SHORT orders credit cash at entry and debit at exit; LONG debit at entry
 *   and credit at exit. Notional = price × quantity × leg multiplier.
 * - Cash is tracked, never enforced — negative balances are permitted.
 * - `equity = cash + open liquidation value`; an entry fill is a cash→asset
 *   swap so equity is unchanged, and an exit shifts equity by the change from
 *   the legs' last marks to the exit fill.
 *
 * Mark semantics (deferred seam — mark-pass, Phase 2/3):
 * - `marks[date]` is the order-level daily mark written by `appendMark`.
 * - `legs[].lastMark` is updated only at fills — entry legs seed
 *   `entryMark`/`lastMark` with per-leg entry prices; an exit sets `lastMark`
 *   to the order-level exit price ONLY for single-leg trades (a net exit
 *   price cannot decompose across legs). `appendMark` does NOT touch
 *   `legs[].lastMark` or `unrealizedPnl`; refreshing position value and
 *   account equity between fills is the mark-pass's job.
 * - `unrealizedPnl` is 0 at entry and exit; it is only non-zero while open,
 *   written by mark-pass.
 */

import { TradeSide } from '@common';
import {
  PaperTradeSource,
  PaperTradeStatus,
  PaperTradingKind,
  type PaperAccount,
  type PaperFill,
  type PaperOrderTerms,
  type PaperTicket,
  type PaperTrade,
  type PaperTradeLeg,
  type SignalExpressionTemplate,
  type VariantRun,
} from '@paper-trading/contracts';
import { buildAccountId } from '@paper-trading/ids';

// ── Types ──────────────────────────────────────────────────────────────────

export interface FillDimensions {
  source: PaperTradeSource;
  symbol: string;
  expression: string;
  governingVariant: string;
  /** All variant keys to seed; defaults to [governingVariant]. */
  variantKeys?: string[];
  strategyInstanceId?: string;
  cohortId?: string;
  signalId?: string;
  ticket?: PaperTicket;
}

export interface EntryFillInput {
  userId: string;
  tradeId: string;
  order: PaperOrderTerms;
  /** Legs with `entryMark` set to each leg's entry price (lastMark is seeded from it). */
  legs: PaperTradeLeg[];
  fill: PaperFill;
  dims: FillDimensions;
  /** Underlying close at fill; seeds marks[fill.date] when provided. */
  underlyingClose?: number;
  /** Extra trade fields merged onto the constructed doc (e.g. engine view
   *  fields like `capitalRequired`/`lastMarkedAt`). Whitelist — lifecycle
   *  fields (status/fills/legs/marks/order/variants) can't be overridden. */
  tradeOverrides?: PaperTradeOverrides;
  now: string;
}

/** Optional trade fields a fill input may merge — lifecycle and
 *  variant-derived fields (governingVariant/variantKeys/variantRuns,
 *  assignment/shares) excluded so overrides can't desync invariants. */
export type PaperTradeOverrides = Partial<
  Pick<
    PaperTrade,
    | 'userId'
    | 'strategyInstanceId'
    | 'cohortId'
    | 'signalId'
    | 'symbol'
    | 'expression'
    | 'ticket'
    | 'expressionTemplate'
    | 'capitalRequired'
    | 'lastMarkedAt'
    | 'legacyStatus'
  >
>;

export interface ExitFillInput {
  userId: string;
  tradeId: string;
  fill: PaperFill;
  now: string;
}

export interface PendingTradeInput {
  userId: string;
  tradeId: string;
  order: PaperOrderTerms;
  dims: FillDimensions;
  /** Template params carried until the expression-fill pass resolves a contract. */
  expressionTemplate?: SignalExpressionTemplate;
  tradeOverrides?: PaperTradeOverrides;
  now: string;
}

export interface PendingFillInput {
  userId: string;
  tradeId: string;
  /** Legs with `entryMark` set to the filled price (lastMark is seeded from it). */
  legs: PaperTradeLeg[];
  fill: PaperFill;
  /** Underlying close at fill; seeds marks[fill.date] when provided. */
  underlyingClose?: number;
  tradeOverrides?: PaperTradeOverrides;
  now: string;
}

/**
 * The atomic write set produced by a fill: the full account doc and the full
 * trade doc to persist together inside the surrounding transaction.
 */
export interface LedgerWritePlan {
  accountId: string;
  account: PaperAccount;
  tradeId: string;
  trade: PaperTrade;
  cashDelta: number;
}

/**
 * Transaction-scoped ledger context. `write` buffers the plan; the
 * transaction commits it only if all reads/writes complete.
 */
export interface LedgerTxn {
  getAccount(userId: string): Promise<PaperAccount | null>;
  getTrade(tradeId: string): Promise<PaperTrade | null>;
  write(plan: LedgerWritePlan): void;
}

export interface LedgerDeps {
  /**
   * Runs `work` inside one atomic unit — a Firestore transaction in
   * production. All reads happen before any write.
   */
  transact<T>(work: (txn: LedgerTxn) => Promise<T>): Promise<T>;
}

export interface ApplyFillResult {
  trade: PaperTrade;
  account: PaperAccount;
  cashDelta: number;
}

// ── Fill math ────────────────────────────────────────────────────────────────

/** Contract multiplier for an order-level fill — 100 if any leg is an option. */
export function orderMultiplier(legs: PaperTradeLeg[]): number {
  return Math.max(...legs.map((l) => l.multiplier), 1);
}

/**
 * Signed cash movement for an order-level fill.
 * `side` is the order's own side (entry side for opens, the close direction
 * computed by the caller for exits — see applyExitFill).
 */
export function signedCashDelta(fill: PaperFill, side: TradeSide, legs: PaperTradeLeg[]): number {
  const notional = fill.price * fill.quantity * orderMultiplier(legs);
  return side === TradeSide.SHORT ? notional : -notional;
}

/**
 * Realized P&L for a whole-order exit: `(exit − entry) × qty × multiplier`,
 * signed by the entry side (SHORT gains when the exit is cheaper).
 * Shared by `applyExitFill` and shadow-variant exit-event bookkeeping.
 */
export function computeExitPnl(
  entryFill: PaperFill,
  exitPrice: number,
  entrySide: TradeSide,
  legs: PaperTradeLeg[],
): number {
  const pnlDir = entrySide === TradeSide.SHORT ? -1 : 1;
  return (exitPrice - entryFill.price) * entryFill.quantity * orderMultiplier(legs) * pnlDir;
}

/**
 * Liquidation value of a trade's legs at their last marks:
 * long legs positive, short legs negative.
 */
export function positionValue(legs: PaperTradeLeg[]): number {
  return legs.reduce(
    (sum, leg) =>
      sum + (leg.side === TradeSide.SHORT ? -1 : 1) * leg.lastMark * leg.quantity * leg.multiplier,
    0,
  );
}

function baseAccount(userId: string, now: string): PaperAccount {
  return {
    kind: PaperTradingKind.ACCOUNT,
    id: buildAccountId(userId),
    userId,
    cash: 0,
    equity: 0,
    realizedPnl: 0,
    openTradeCount: 0,
    createdAt: now,
    updatedAt: now,
  };
}

// ── Entry ──────────────────────────────────────────────────────────────────

export async function applyEntryFill(
  input: EntryFillInput,
  deps: LedgerDeps,
): Promise<ApplyFillResult> {
  if (input.fill.role !== 'entry') {
    throw new Error(`fill role must be 'entry', got '${input.fill.role}'`);
  }
  if (input.fill.quantity !== input.order.quantity) {
    throw new Error(
      `fill quantity ${input.fill.quantity} != order quantity ${input.order.quantity}`,
    );
  }
  return deps.transact(async (txn) => {
    if (await txn.getTrade(input.tradeId)) {
      throw new Error(`paper trade ${input.tradeId} already exists`);
    }
    const account = (await txn.getAccount(input.userId)) ?? baseAccount(input.userId, input.now);

    const cashDelta = signedCashDelta(input.fill, input.order.side, input.legs);
    const legs = input.legs.map((leg) => ({ ...leg, lastMark: leg.entryMark }));

    const { variantKeys, variantRuns } = seedVariantRuns(input.dims, input.tradeId);

    const marks: PaperTrade['marks'] =
      input.underlyingClose === undefined
        ? {}
        : { [input.fill.date]: { mark: input.fill.price, underlyingClose: input.underlyingClose } };

    const trade: PaperTrade = {
      kind: PaperTradingKind.TRADE,
      id: input.tradeId,
      status: PaperTradeStatus.OPEN,
      userId: input.userId,
      source: input.dims.source,
      symbol: input.dims.symbol,
      expression: input.dims.expression,
      governingVariant: input.dims.governingVariant,
      ...(input.dims.strategyInstanceId ? { strategyInstanceId: input.dims.strategyInstanceId } : {}),
      ...(input.dims.cohortId ? { cohortId: input.dims.cohortId } : {}),
      ...(input.dims.signalId ? { signalId: input.dims.signalId } : {}),
      ...(input.dims.ticket ? { ticket: input.dims.ticket } : {}),
      order: input.order,
      fills: [input.fill],
      legs,
      marks,
      variantRuns,
      variantKeys,
      realizedPnl: 0,
      unrealizedPnl: 0,
      createdAt: input.now,
      updatedAt: input.now,
      ...input.tradeOverrides,
    };

    const updatedAccount: PaperAccount = {
      ...account,
      cash: account.cash + cashDelta,
      // equity = cash + open liquidation value; entry is a cash→asset swap
      equity: account.equity + cashDelta + positionValue(legs),
      openTradeCount: account.openTradeCount + 1,
      updatedAt: input.now,
    };

    txn.write({
      accountId: updatedAccount.id,
      account: updatedAccount,
      tradeId: trade.id,
      trade,
      cashDelta,
    });
    return { trade, account: updatedAccount, cashDelta };
  });
}

/**
 * Exactly one governing run is an invariant: dedupe keys (a dup would be
 * unreachable via updateVariantRun's first-match index) and require the
 * governing key to be present — otherwise the trade can never close.
 */
function seedVariantRuns(
  dims: FillDimensions,
  tradeId: string,
): { variantKeys: string[]; variantRuns: VariantRun[] } {
  const variantKeys = [...new Set(
    dims.variantKeys?.length ? dims.variantKeys : [dims.governingVariant],
  )];
  if (!variantKeys.includes(dims.governingVariant)) {
    throw new Error(
      `variantKeys must include governingVariant ${dims.governingVariant} ` +
        `for trade ${tradeId}`,
    );
  }
  const variantRuns: VariantRun[] = variantKeys.map((key) => ({
    variantKey: key,
    governing: key === dims.governingVariant,
    state: 'ACTIVE',
    workingState: {},
  }));
  return { variantKeys, variantRuns };
}

// ── Pending trades (signal expression cohorts) ─────────────────────────────

/**
 * Create a PENDING trade — order accepted, awaiting a later fill (the
 * noon-PT expression-fill pass resolves a real contract). No cash moves;
 * the account doc is still created lazily so the trade's account anchor
 * exists, but no counts/P&L change until `applyPendingFill`.
 */
export async function createPendingTrade(
  input: PendingTradeInput,
  deps: LedgerDeps,
): Promise<PaperTrade> {
  return deps.transact(async (txn) => {
    if (await txn.getTrade(input.tradeId)) {
      throw new Error(`paper trade ${input.tradeId} already exists`);
    }
    const account = (await txn.getAccount(input.userId)) ?? baseAccount(input.userId, input.now);
    const { variantKeys, variantRuns } = seedVariantRuns(input.dims, input.tradeId);

    const trade: PaperTrade = {
      kind: PaperTradingKind.TRADE,
      id: input.tradeId,
      status: PaperTradeStatus.PENDING,
      userId: input.userId,
      source: input.dims.source,
      symbol: input.dims.symbol,
      expression: input.dims.expression,
      governingVariant: input.dims.governingVariant,
      ...(input.dims.strategyInstanceId ? { strategyInstanceId: input.dims.strategyInstanceId } : {}),
      ...(input.dims.cohortId ? { cohortId: input.dims.cohortId } : {}),
      ...(input.dims.signalId ? { signalId: input.dims.signalId } : {}),
      ...(input.dims.ticket ? { ticket: input.dims.ticket } : {}),
      ...(input.expressionTemplate ? { expressionTemplate: input.expressionTemplate } : {}),
      order: input.order,
      fills: [],
      legs: [],
      marks: {},
      variantRuns,
      variantKeys,
      realizedPnl: 0,
      unrealizedPnl: 0,
      createdAt: input.now,
      updatedAt: input.now,
      ...input.tradeOverrides,
    };

    txn.write({
      accountId: account.id,
      account: { ...account, updatedAt: input.now },
      tradeId: trade.id,
      trade,
      cashDelta: 0,
    });
    return trade;
  });
}

/**
 * Fill a PENDING trade: sets legs + entry fill + seeded marks, flips status
 * to OPEN, and applies the entry cash delta — the PENDING→OPEN mirror of
 * `applyEntryFill` for orders staged before a contract was known.
 */
export async function applyPendingFill(
  input: PendingFillInput,
  deps: LedgerDeps,
): Promise<ApplyFillResult> {
  if (input.fill.role !== 'entry') {
    throw new Error(`fill role must be 'entry', got '${input.fill.role}'`);
  }
  return deps.transact(async (txn) => {
    const trade = await txn.getTrade(input.tradeId);
    if (!trade) {
      throw new Error(`paper trade ${input.tradeId} not found`);
    }
    if (trade.status !== PaperTradeStatus.PENDING) {
      throw new Error(`paper trade ${input.tradeId} is not pending (status ${trade.status})`);
    }
    if (input.fill.quantity !== trade.order.quantity) {
      throw new Error(
        `fill quantity ${input.fill.quantity} != order quantity ${trade.order.quantity}`,
      );
    }
    const account =
      (await txn.getAccount(input.userId)) ?? baseAccount(input.userId, input.now);

    const cashDelta = signedCashDelta(input.fill, trade.order.side, input.legs);
    const legs = input.legs.map((leg) => ({ ...leg, lastMark: leg.entryMark }));
    const marks: PaperTrade['marks'] = {
      ...trade.marks,
      [input.fill.date]: {
        mark: input.fill.price,
        ...(input.underlyingClose !== undefined ? { underlyingClose: input.underlyingClose } : {}),
      },
    };

    const updatedTrade: PaperTrade = {
      ...trade,
      status: PaperTradeStatus.OPEN,
      fills: [...trade.fills, input.fill],
      legs,
      marks,
      updatedAt: input.now,
      ...input.tradeOverrides,
    };

    const updatedAccount: PaperAccount = {
      ...account,
      cash: account.cash + cashDelta,
      equity: account.equity + cashDelta + positionValue(legs),
      openTradeCount: account.openTradeCount + 1,
      updatedAt: input.now,
    };

    txn.write({
      accountId: updatedAccount.id,
      account: updatedAccount,
      tradeId: trade.id,
      trade: updatedTrade,
      cashDelta,
    });
    return { trade: updatedTrade, account: updatedAccount, cashDelta };
  });
}

// ── Exit ───────────────────────────────────────────────────────────────────

/**
 * NOTE for #563 (exit engine): this computes realizedPnl absolutely from
 * `(exit − entry) × qty × mult` on the option entry fill. An ASSIGNED engine
 * trade's entry fill is the option premium, not the share cost basis — a
 * share-sale exit through this seam would miscompute P&L. The engine's own
 * settlement path (position-repository.markPositionSettled) mirrors this
 * account math inline (premium realized at expiry/assignment, assignment
 * cash debit + share value) — the two formulas must stay consistent; extract
 * a shared `applySettlement` helper when the share-sale path lands in #563.
 */
export async function applyExitFill(
  input: ExitFillInput,
  deps: LedgerDeps,
): Promise<ApplyFillResult> {
  if (input.fill.role !== 'exit') {
    throw new Error(`fill role must be 'exit', got '${input.fill.role}'`);
  }
  return deps.transact(async (txn) => {
    const trade = await txn.getTrade(input.tradeId);
    if (!trade) {
      throw new Error(`paper trade ${input.tradeId} not found`);
    }
    if (trade.status !== PaperTradeStatus.OPEN && trade.status !== PaperTradeStatus.ASSIGNED) {
      throw new Error(`paper trade ${input.tradeId} is not open (status ${trade.status})`);
    }
    if (input.fill.quantity !== trade.order.quantity) {
      throw new Error(
        `partial exits not supported: fill quantity ${input.fill.quantity} != order quantity ${trade.order.quantity}`,
      );
    }
    const account =
      (await txn.getAccount(input.userId)) ?? baseAccount(input.userId, input.now);

    const entryFill = trade.fills.find((f) => f.role === 'entry');
    if (!entryFill) {
      throw new Error(`paper trade ${input.tradeId} has no entry fill`);
    }
    const entrySide = trade.order.side;

    // closing direction is opposite the entry side
    const cashDelta = -signedCashDelta(input.fill, entrySide, trade.legs);
    const realizedPnl = computeExitPnl(entryFill, input.fill.price, entrySide, trade.legs);

    const markedValue = positionValue(trade.legs); // value carried before this exit
    // An order-level exit price cannot decompose across legs — only stamp
    // lastMark when there is exactly one leg.
    const legs =
      trade.legs.length === 1
        ? trade.legs.map((leg) => ({ ...leg, lastMark: input.fill.price }))
        : trade.legs;

    // Drop legacyStatus — a ledger close must not leave a stale engine status
    // (adapter prefers legacyStatus over status on read-back).
    const { legacyStatus: _dropped, ...rest } = trade;
    const updatedTrade: PaperTrade = {
      ...rest,
      status: PaperTradeStatus.CLOSED,
      fills: [...trade.fills, input.fill],
      legs,
      realizedPnl,
      unrealizedPnl: 0,
      updatedAt: input.now,
    };

    const updatedAccount: PaperAccount = {
      ...account,
      cash: account.cash + cashDelta,
      // remove the position's marked value, add the exit proceeds
      equity: account.equity + cashDelta - markedValue,
      realizedPnl: account.realizedPnl + realizedPnl,
      openTradeCount: account.openTradeCount - 1,
      updatedAt: input.now,
    };

    txn.write({
      accountId: updatedAccount.id,
      account: updatedAccount,
      tradeId: trade.id,
      trade: updatedTrade,
      cashDelta,
    });
    return { trade: updatedTrade, account: updatedAccount, cashDelta };
  });
}
