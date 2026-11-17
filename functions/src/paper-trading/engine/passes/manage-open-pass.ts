/**
 * @topic #137 — STRAT-MANAGE, Thread #1510 (OpsStrat Manage Page Overhaul)
 * @task #1539 — BE: Manage instance reader + open-pass rework
 *
 * Noon-PT open pass for manage-domain instances (`ManageInstance` docs on
 * `st-strategy-instances`). Replaces the legacy sim-driven open for the
 * manage model: the variant's concrete legs (Δ/DTE) resolve to contracts
 * at open time through the RH MCP chain → instruments → quotes →
 * `selectOptionContract` machinery — the same selection seam the noon-PT
 * expression-fill pass uses (#1005).
 *
 * Trigger semantics (PRD US-4):
 * - `daily`  — open every trading day; positions ladder (concurrent opens
 *              accumulate, honoring an optional `maxOpenPositions` cap).
 * - `signal` — open only when a fresh ST signal exists for the instance's
 *              symbol today (`st-signals` where `marketDate ==` today —
 *              "detected in today's run"; the bar itself may be a weekend
 *              or prior-session bar).
 *
 * Non-ACTIVE instances never reach this pass — the reader's
 * `runState == 'ACTIVE'` query is the only firing surface.
 *
 * Fail-closed: stock legs throw (share-leg plumbing is a later task —
 * no seeded v1 template uses them; minting a position missing its
 * shares would be worse than failing loudly).
 */

import { TradeSide } from '@common';
import { buildOccContractId, OptionType } from '@options/common';
import type { HistoricalOptionContract } from '../../../types/partner';
import type { RunnableManageInstance } from '../manage-instance-reader';
import {
  fetchAllOptionInstruments,
  fetchOptionExpirations,
  fetchOptionQuotes,
  parseNum,
} from '../rh-mcp-shapes';
import { selectOptionContract } from '../../../common/option-contract-selection';
import { calendarDaysBetween } from '../../../common/pt-date-utils';
import { db } from '../../../firebase-admin-init';
import { ST_SIGNALS_ROOT } from '../../../common/st-collections';
import { evaluateOpenGates } from './open-pass-gates';
import type { OpenGateSkipReason } from './open-pass-gates';
import {
  buildLegId,
  getPosition,
  listPositionsByInstance,
  createManagePosition,
} from '../position-repository';
import {
  strategyInstanceRef,
  strategyInstanceDailyAnalysisRef,
} from '../strategy-instance-repository';
import type { Position, PositionLeg, RawQuote } from '../types';
import { PositionStatus } from '../types';
import { buildAccountId } from '@paper-trading/ids';
import type { StOrderTicketEmitter } from '../../../order-tickets/st-order-ticket-writer';
import { createLogger } from '../logging';
import type { OptionLeg } from '@options-replay/contracts';

const logger = createLogger('ManageOpenPass');

// ── Result ──────────────────────────────────────────────────────────────────

export type ManageOpenSkipReason =
  | OpenGateSkipReason
  | 'no_fresh_signal'
  | 'no_contracts'
  | 'error';

export interface ManageOpenPassResult {
  instanceId: string;
  symbol: string;
  positionId: string | null;
  skipped: boolean;
  skipReason: ManageOpenSkipReason | null;
  /** contractIDs resolved for each option leg, in variant leg order. */
  legsResolved: string[];
  /** Error message when skipReason === 'error'. */
  error?: string;
  recordedAt: string;
}

// ── Dependencies ────────────────────────────────────────────────────────────

export type RhMcpToolCaller = (
  name: string,
  args: Record<string, unknown>,
) => Promise<unknown>;

export interface ManageOpenPassDependencies {
  /** RH MCP read-only caller (`get_option_chains`/`instruments`/`quotes`). */
  callTool: RhMcpToolCaller;
  /** Fresh-signal check for `trigger: 'signal'` instances. */
  hasFreshSignal?: (symbol: string, marketDate: string) => Promise<boolean>;
  listInstancePositions?: (instanceId: string) => Promise<Position[]>;
  getPosition?: (positionId: string) => Promise<Position | null>;
  createPosition?: typeof createManagePosition;
  /** Canonical `st-order-tickets` emitter — stages a `program`/`auto`
   *  ticket before the ledger write (same seam as the legacy open pass).
   *  Optional — absent dep keeps the unticketed path for tests. */
  tickets?: Pick<StOrderTicketEmitter, 'emit' | 'markFilled' | 'markFailed'>;
  /** Observability seam — default stamps the result on the instance's
   *  `daily-analysis/latest` doc (`manageOpenPassResult` field). */
  writeResult?: (instanceId: string, result: ManageOpenPassResult) => Promise<void>;
  /** Post-create bookkeeping — default merges `lastFiredAt`/`updatedAt`
   *  onto the instance doc. */
  stampLastFiredAt?: (instanceId: string, at: string) => Promise<void>;
  now?: () => Date;
}

// ── Defaults ────────────────────────────────────────────────────────────────

async function defaultHasFreshSignal(
  symbol: string,
  marketDate: string,
): Promise<boolean> {
  const snap = await db
    .collection(ST_SIGNALS_ROOT)
    .where('symbol', '==', symbol)
    .where('marketDate', '==', marketDate)
    .limit(1)
    .get();
  return !snap.empty;
}

async function defaultWriteResult(
  instanceId: string,
  result: ManageOpenPassResult,
): Promise<void> {
  await strategyInstanceDailyAnalysisRef(instanceId, db)
    .doc('latest')
    .set({ manageOpenPassResult: result }, { merge: true });
}

async function defaultStampLastFiredAt(
  instanceId: string,
  at: string,
): Promise<void> {
  await strategyInstanceRef(instanceId, db).set(
    { lastFiredAt: at, updatedAt: at },
    { merge: true },
  );
}

// ── Leg resolution ──────────────────────────────────────────────────────────

/** Instrument-page fetch bounds — nearest-DTE expirations only, same bound
 *  as the expression-fill pass. */
const MAX_EXPIRATIONS = 4;
/** DTE window around the leg's target for the instrument fan-out. */
const DTE_FETCH_WINDOW = 15;

/** Resolve one option leg to a contract via the RH chain — same
 *  chains → instruments → quotes → selectOptionContract flow as the
 *  noon-PT expression-fill pass, scoped to the leg's type/Δ/DTE.
 *  `excludeIds` holds contractIDs already picked for earlier legs —
 *  adjacent Δ targets must never mint the same contract twice. */
async function resolveOptionLeg(
  leg: OptionLeg,
  symbol: string,
  marketDate: string,
  expirations: string[],
  excludeIds: ReadonlySet<string>,
  callTool: RhMcpToolCaller,
): Promise<{ contractID: string; strike: number; expiration: string; mark: number } | null> {
  const rhType = leg.type === OptionType.CALL ? 'call' : 'put';
  const inBand = expirations
    .map((expiration) => ({
      expiration,
      dte: calendarDaysBetween(marketDate, expiration),
    }))
    .filter(
      (e) =>
        e.dte >= Math.max(0, leg.dte - DTE_FETCH_WINDOW) &&
        e.dte <= leg.dte + DTE_FETCH_WINDOW,
    )
    .sort((a, b) => Math.abs(a.dte - leg.dte) - Math.abs(b.dte - leg.dte))
    .slice(0, MAX_EXPIRATIONS);

  if (inBand.length === 0) {
    logger.info(
      `${symbol}: no expiration within ${Math.max(0, leg.dte - DTE_FETCH_WINDOW)}-${leg.dte + DTE_FETCH_WINDOW}d of target ${leg.dte}`,
    );
    return null;
  }

  const instrumentPages = await Promise.all(
    inBand.map(({ expiration }) =>
      fetchAllOptionInstruments(callTool, {
        chain_symbol: symbol,
        expiration_dates: expiration,
        type: rhType,
      }),
    ),
  );
  const instruments = instrumentPages.flat();
  const quotes = await fetchOptionQuotes(
    callTool,
    instruments.map((i) => i.id).filter((id): id is string => !!id),
  );

  const candidates: HistoricalOptionContract[] = [];
  for (const inst of instruments) {
    const strike = parseNum(inst.strike_price);
    const q = inst.id ? quotes.get(inst.id) : undefined;
    if (!inst.expiration_date || strike === undefined || !q) continue;
    const occId = buildOccContractId(symbol, inst.expiration_date, leg.type, strike);
    if (excludeIds.has(occId)) continue;
    candidates.push({
      contractID: occId,
      symbol,
      expiration: inst.expiration_date,
      strike: String(strike),
      type: leg.type,
      mark: q.mark === undefined ? undefined : String(q.mark),
      delta: q.delta === undefined ? undefined : String(q.delta),
    });
  }

  const selected = selectOptionContract(marketDate, candidates, {
    type: leg.type,
    // Signed target — the registry convention matches SA sign conventions,
    // but chain deltas come back signed too, so score against the leg's
    // absolute value (selectOptionContract's useAbsoluteDelta compares |Δ|).
    targetDelta: Math.abs(leg.targetDelta),
    targetDte: leg.dte,
    requireMark: true,
    useAbsoluteDelta: true,
  });

  if (!selected || selected.mark === undefined || !selected.contract.contractID) {
    logger.info(`${symbol}: no selectable contract (${candidates.length} candidates)`);
    return null;
  }

  const { contract } = selected;
  const contractID = contract.contractID;
  const strike = parseNum(contract.strike);
  if (!contractID || strike === undefined || !contract.expiration) {
    throw new Error(
      `resolveOptionLeg ${symbol}: selected contract ${contractID ?? 'n/a'} lacks id/strike/expiration`,
    );
  }
  return { contractID, strike, expiration: contract.expiration, mark: selected.mark };
}

// ── Position math ───────────────────────────────────────────────────────────

/**
 * Premium + capital for a resolved spread. `netPremium` = short-leg marks
 * minus long-leg marks (positive = credit). `premiumCollected` keeps the
 * legacy semantic (cash taken in — 0 for debits); `capitalRequired` is the
 * net debit for debit structures and a conservative same-type strike-width
 * bound minus the credit for credit structures.
 */
function computePositionMath(
  legs: { side: TradeSide; mark: number; strike: number; type: OptionType }[],
): { premiumCollected: number; capitalRequired: number; currentValue: number } {
  const netPremium = legs.reduce(
    (acc, l) => acc + (l.side === TradeSide.SHORT ? l.mark : -l.mark),
    0,
  );
  let capitalRequired = Math.max(-netPremium, 0) * 100;
  if (netPremium > 0) {
    // Credit structure — bound the loss by the widest same-type
    // short/long strike gap minus the credit taken in.
    let width = 0;
    for (const type of [OptionType.CALL, OptionType.PUT]) {
      const shorts = legs.filter((l) => l.type === type && l.side === TradeSide.SHORT);
      const longs = legs.filter((l) => l.type === type && l.side === TradeSide.LONG);
      for (const s of shorts) {
        for (const l of longs) {
          width = Math.max(width, Math.abs(s.strike - l.strike));
        }
      }
    }
    capitalRequired = Math.max(width - netPremium, 0) * 100;
  }
  return {
    premiumCollected: Math.max(netPremium, 0) * 100,
    capitalRequired,
    currentValue: Math.abs(netPremium) * 100,
  };
}

// ── Tickets ─────────────────────────────────────────────────────────────────

async function stageManageTicket(
  tickets: ManageOpenPassDependencies['tickets'],
  instance: RunnableManageInstance,
  positionId: string,
  netPremium: number,
  now: () => Date,
): Promise<string | null> {
  if (!tickets) return null;
  try {
    return await tickets.emit({
      mode: 'paper',
      idSeed: positionId,
      origin: { type: 'program', instanceId: instance.id },
      auto: true,
      terms: {
        symbol: instance.symbol,
        // Spreads have no single side — the ticket's instrument terms are
        // strategy-level only (contract detail lives on the position doc);
        // debit structures read 'buy', credit read 'sell'.
        side: netPremium >= 0 ? 'sell' : 'buy',
        instrument: 'option',
        quantity: 1,
        orderType: 'market',
        timeInForce: 'gfd',
        marketHours: 'regular_hours',
      },
      accountTarget: instance.paperAccountId ?? buildAccountId(instance.userId),
      userId: instance.userId,
      now: now().toISOString(),
    });
  } catch (err) {
    logger.warn(
      `manage_open_ticket_emit ${instance.id}: ${err instanceof Error ? err.message : String(err)}`,
    );
    return null;
  }
}

// ── Main ────────────────────────────────────────────────────────────────────

export async function runManageOpenPass(
  instance: RunnableManageInstance,
  marketDate: string,
  deps: ManageOpenPassDependencies,
): Promise<ManageOpenPassResult> {
  const hasFreshSignal = deps.hasFreshSignal ?? defaultHasFreshSignal;
  const listPositions = deps.listInstancePositions ?? listPositionsByInstance;
  const getPositionById = deps.getPosition ?? getPosition;
  const createPosition = deps.createPosition ?? createManagePosition;
  const writeResult = deps.writeResult ?? defaultWriteResult;
  const stampLastFiredAt = deps.stampLastFiredAt ?? defaultStampLastFiredAt;
  const now = deps.now ?? (() => new Date());

  const base = { instanceId: instance.id, symbol: instance.symbol };
  const finish = async (
    positionId: string | null,
    skipped: boolean,
    skipReason: ManageOpenSkipReason | null,
    legsResolved: string[] = [],
  ): Promise<ManageOpenPassResult> => {
    const result: ManageOpenPassResult = {
      ...base,
      positionId,
      skipped,
      skipReason,
      legsResolved,
      recordedAt: now().toISOString(),
    };
    await writeResult(instance.id, result);
    return result;
  };

  try {
    // 1. Signal gate — signal-triggered instances stay flat until a fresh
    //    ST signal exists for the symbol today.
    if (instance.trigger === 'signal') {
      if (!(await hasFreshSignal(instance.symbol, marketDate))) {
        logger.info(`Skipped ${instance.id}/${marketDate}: no fresh signal for ${instance.symbol}`);
        return finish(null, true, 'no_fresh_signal');
      }
    }

    // 2. Cadence + cap gates — daily cadence only (the noon routine IS the
    //    cadence); positions ladder under an optional maxOpenPositions cap.
    const positions = await listPositions(instance.id);
    const gate = evaluateOpenGates(
      positions,
      { cadenceDays: 1, maxOpenPositions: instance.maxOpenPositions },
      marketDate,
    );
    if (gate) {
      logger.info(`Skipped ${instance.id}/${marketDate}: ${gate.reason}`);
      return finish(gate.blockingPositionId, true, gate.reason);
    }

    // 3. Resolve legs — option legs to contracts via the RH chain; stock
    //    legs fail closed (no share-leg plumbing yet — no seeded v1
    //    template uses them; a missing shares leg is worse than a throw).
    const optionLegs = instance.variant.legs.filter((l) => l.kind === 'option');
    if (optionLegs.length !== instance.variant.legs.length) {
      throw new Error(
        `runManageOpenPass ${instance.id}: variant has ${instance.variant.legs.length - optionLegs.length} stock leg(s) — share-leg plumbing not implemented`,
      );
    }

    // Sequential resolution — each leg's pick joins the exclusion set so
    // adjacent Δ targets can never mint the same contract twice.
    const expirations = await fetchOptionExpirations(deps.callTool, instance.symbol);
    const resolved: ({ contractID: string; strike: number; expiration: string; mark: number } | null)[] = [];
    const picked = new Set<string>();
    for (const leg of optionLegs) {
      const r = await resolveOptionLeg(
        leg,
        instance.symbol,
        marketDate,
        expirations,
        picked,
        deps.callTool,
      );
      if (r === null) {
        return finish(null, true, 'no_contracts');
      }
      picked.add(r.contractID);
      resolved.push(r);
    }
    const contracts = resolved as NonNullable<(typeof resolved)[number]>[];

    // 4. Build the position + legs.
    const positionId = `${instance.id}-${marketDate}`;
    const math = computePositionMath(
      contracts.map((c, i) => ({
        side: optionLegs[i].side,
        mark: c.mark,
        strike: c.strike,
        type: optionLegs[i].type,
      })),
    );

    const position: Omit<Position, 'id'> = {
      instanceId: instance.id,
      symbol: instance.symbol,
      status: PositionStatus.OPEN,
      premiumCollected: math.premiumCollected,
      capitalRequired: math.capitalRequired,
      openDate: marketDate,
      currentValue: math.currentValue,
      currentValueAsOf: now().toISOString(),
      unrealizedPnl: 0,
    };

    const legs: PositionLeg[] = contracts.map((c, i) => {
      const leg = optionLegs[i];
      return {
        id: buildLegId(leg.type, c.strike, c.expiration),
        type: leg.type,
        side: leg.side,
        strike: c.strike,
        expiration: c.expiration,
        openDate: marketDate,
        contractID: c.contractID,
        premium: c.mark,
      };
    });

    const rawQuote: RawQuote = {
      date: marketDate,
      rawResponse: {
        source: 'rh_mcp_chain_selection',
        legs: contracts.map((c) => ({ contractID: c.contractID, mark: c.mark })),
      },
    };

    // 5. Deterministic-id dedup — a same-day re-fire collides at the
    //    ledger's transactional `already exists`; this read narrows the
    //    window without a round-trip per retry attempt.
    if (await getPositionById(positionId)) {
      logger.info(`Skipped ${instance.id}/${marketDate}: already_opened_today`);
      return finish(positionId, true, 'already_opened_today');
    }

    const netPremium = contracts.reduce(
      (acc, c, i) => acc + (optionLegs[i].side === TradeSide.SHORT ? c.mark : -c.mark),
      0,
    );
    const ticketId = await stageManageTicket(
      deps.tickets,
      instance,
      positionId,
      netPremium,
      now,
    );

    // 6. Create the position — the ledger write is transactional; a
    //    duplicate-id retry throws `already exists` here rather than
    //    double-minting.
    let created: Position;
    try {
      created = await createPosition(position, legs, rawQuote, instance, positionId);
    } catch (err) {
      if (ticketId && deps.tickets) {
        await deps.tickets.markFailed(
          ticketId,
          { category: 'program-fill', message: err instanceof Error ? err.message : String(err) },
          now().toISOString(),
        );
      }
      throw err;
    }

    if (ticketId && deps.tickets) {
      await deps.tickets.markFilled(
        ticketId,
        { averagePrice: Math.abs(netPremium), filledQty: 1, filledAt: now().toISOString() },
        now().toISOString(),
      );
    }

    // 7. Stamp lastFiredAt — the routine pass that opened this position.
    // 7. Stamp lastFiredAt — bookkeeping only; a stamp failure must not
    //    fail the pass after the position already minted.
    try {
      await stampLastFiredAt(instance.id, now().toISOString());
    } catch (stampErr) {
      logger.warn(
        `lastFiredAt stamp failed for ${instance.id}: ${stampErr instanceof Error ? stampErr.message : String(stampErr)}`,
      );
    }

    logger.info(
      `Opened position ${created.id} for ${instance.id}/${marketDate} (${contracts.length} legs)`,
    );
    return finish(
      created.id,
      false,
      null,
      contracts.map((c) => c.contractID),
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.warn(`Manage open pass ${instance.id}/${marketDate} failed: ${message}`);
    try {
      await writeResult(instance.id, {
        ...base,
        positionId: null,
        skipped: true,
        skipReason: 'error',
        legsResolved: [],
        error: message,
        recordedAt: now().toISOString(),
      });
    } catch {
      // observability sink must not mask the real error
    }
    throw err;
  }
}
