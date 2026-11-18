/**
 * @topic #553 — Paper Trading Infra (task #1575)
 *
 * Historical signal mint: a picked signal occurrence becomes a REAL
 * PaperTrade — entry fill at the signal-bar close (SDS_BARS provenance),
 * marks backfilled from stored bars, the full curated variant set walked
 * forward day-by-day in memory with the same evaluator + governing
 * policy the nightly pass runs, the real ledger close (applyExitFill)
 * when a run fires, then one atomic commit of marks + final run state +
 * mirror. Same ledger, same math as live trades — the mint is a time
 * machine, not a parallel analysis universe.
 *
 * Intentional divergences from the nightly eval pass (same evaluators +
 * policy, different substrate):
 * - Entry-day eval is skipped (walk starts at the bar AFTER the signal
 *   bar) — mirrors `replaySignalToRow`'s convention, not the nightly
 *   pass's "evaluate today's mark" (a live trade exists before the pass;
 *   a backfill's entry already IS that bar's close).
 * - The walk BREAKS at the first real close — nightly keeps shadow runs
 *   evaluating on closed trades only while marks land, and mark-pass
 *   coverage for closed trades is deferred, so this is equivalent today.
 * - Unusable bars (non-finite close, defined non-final `barStatus`) are
 *   SKIPPED rather than counted — the nightly convention adapted to a
 *   summary-less walk; an unusable SIGNAL bar errors the mint.
 * - Missing-SMA `ma-close` skips warn once per run (expected for
 *   early-history picks) instead of accumulating summary errors.
 * - Fills carry `SDS_BARS` provenance (bars, not a quote provider).
 *
 * Failure model — every partial state is self-healing:
 * - `applyEntryFill` committed but walk/commit never ran → an OPEN doc
 *   missing the marks the walk owns (one per usable stored bar after
 *   entry); a re-mint RESUMES it — but only a mint-seeded doc (entry
 *   fill at the signal-bar date via `SDS_BARS`): live auto-ingest
 *   shares the deterministic tradeId and a foreign doc must dedupe,
 *   never replay pre-entry history. The audit is mark-derived rather
 *   than `lastMarkedAt`-based because the nightly mark-pass stamps that
 *   field on every OPEN signal trade — it must not mask a crashed mint.
 * - `applyExitFill` runs BEFORE the backfill commit — nightly's
 *   close→annotate order: a missed commit leaves a CLOSED trade the
 *   nightly repair path annotates from the exit fill; a failed exit
 *   leaves an unwalked OPEN trade the next mint resumes.
 * - Ticket staged then mint fails BEFORE the ledger entry lands →
 *   `markFailed`; after the entry exists the ticket stays filled — the
 *   ledger is the truth. An `already exists` race does no transition at
 *   all (the winning mint owns markFilled).
 */

import { createLogger } from '../engine/logging';
import type { OhlcBar } from '../../common/market-data-types';
import { TradeSide } from '@common';
import { OptionQuoteSource } from '@options/common';
import {
  AUTO_PAPER_USER_ID,
  CURATED_GOVERNING_POLICY,
  CURATED_VARIANT_KEYS,
  DEFAULT_TRAILING_STOP_KEY,
  PaperTradeSource,
  PaperTradeStatus,
  type MintResult,
  type PaperFill,
  type PaperMark,
  type PaperTrade,
  type SignalPick,
  type VariantExitEvent,
  type VariantRun,
} from '@paper-trading/contracts';
import {
  buildAccountId,
  buildTradeId,
  signalDedupeKey,
  signalTradeDesc,
  EQUITY_TRADE_DESC,
} from '@paper-trading/ids';
import { stSignalOccurrenceId } from '@st/ids';
import { normalizeStSignalDirection, type StSignal } from '@st/signals';
import type { StOrderTicketEmitter } from '../../order-tickets/st-order-ticket-writer';
import { calendarDaysBetween } from '../../common/pt-date-utils';
import {
  computeExitPnl,
  type ApplyFillResult,
  type EntryFillInput,
  type ExitFillInput,
} from '../ledger';
import type { CommitBackfilledTradeUpdate } from '../repository';
import {
  evaluateVariant,
  isIndependentCloser,
  parseVariantKey,
} from '../exits/registry';
import { selectGoverningRun, smaIndicatorsFor } from '../exits/governing-policy';

const logger = createLogger('BackfillSignalTrade');

// ── Types ─────────────────────────────────────────────────────────────────

export interface BackfillSignalTradeDeps {
  /** Read the canonical `st-signals` occurrence doc. */
  getSignal(occurrenceId: string): Promise<StSignal | null>;
  /** Stored daily bars for the symbol — must be `d`-ascending (the
   *  `getCachedBarsFromSymbolData` loader sorts; the walk is
   *  order-sensitive). */
  getBars(symbol: string): Promise<OhlcBar[]>;
  /** Mint dedupe + resume check — the deterministic tradeId exists? */
  getTrade(tradeId: string): Promise<PaperTrade | null>;
  applyEntryFill(input: EntryFillInput): Promise<ApplyFillResult>;
  applyExitFill(input: ExitFillInput): Promise<ApplyFillResult>;
  /** One atomic write of the walk state onto the committed trade. */
  commitBackfill(tradeId: string, update: CommitBackfilledTradeUpdate): Promise<void>;
  /** Canonical `st-order-tickets` emitter — fail-soft like live ingest. */
  tickets?: Pick<StOrderTicketEmitter, 'emit' | 'markFilled' | 'markFailed'>;
  now(): Date;
}

/** A bar whose close can honestly stand in as a mark: finite, and not a
 *  flagged interim bar when the source carries `barStatus` (absent = treat
 *  as final — the stored corpus predates the flag). */
function isUsableBar(b: OhlcBar): boolean {
  return Number.isFinite(b.c) && (b.barStatus === undefined || b.barStatus === 1);
}

// ── Mint ──────────────────────────────────────────────────────────────────

/**
 * Mint one picked signal occurrence into a real backdated PaperTrade.
 * Returns a MintResult — per-item failures never throw to the caller.
 */
export async function backfillSignalTrade(
  item: SignalPick,
  deps: BackfillSignalTradeDeps,
): Promise<MintResult> {
  const signalId = signalDedupeKey(item.symbol, item.signalType, item.signalBarDate);
  let tradeId = '';
  let ticketId: string | null = null;
  // Tracks whether a ledger entry exists — a failed mint may only
  // markFailed a ticket when the entry never landed; once the trade
  // exists the ticket's "filled" is the truth.
  let entryCommitted = false;
  const now = deps.now().toISOString();
  try {
    const desc = signalTradeDesc(item.signalType); // throws on unsupported type
    tradeId = buildTradeId(
      new Date(`${item.signalBarDate}T12:00:00Z`),
      'sig',
      item.symbol,
      desc,
    );

    const existing = await deps.getTrade(tradeId);
    // Terminal states are complete — dedupe without a bars read.
    if (existing && existing.status !== PaperTradeStatus.OPEN) {
      return { signalId, tradeId, status: 'deduped' };
    }
    // Only a doc THIS mint seeded is resumable. The deterministic
    // tradeId also collides with live auto-ingest for the same signal —
    // that doc filled on its dispatch date from a live quote (RH_MCP),
    // not at the signal-bar close from SDS_BARS. Resuming it would walk
    // bars before the real entry and could mint an exit dated before the
    // entry fill — foreign docs dedupe, never resume.
    const mintSeeded =
      existing !== null &&
      existing.fills.some(
        (f) =>
          f.role === 'entry' &&
          f.date === item.signalBarDate &&
          f.quoteSource === OptionQuoteSource.SDS_BARS,
      );
    // An OPEN doc needs the marks audit below: the walk owns one mark
    // per usable stored bar after entry, so any missing mark means a
    // crashed mint (entry-only or nightly-marked) the re-mint resumes
    // idempotently. Auditing marks — not lastMarkedAt — because the
    // nightly mark-pass stamps that field on every OPEN signal trade.
    // (Date-keyed audit limit: a nightly EOD mark is indistinguishable
    // from a walk mark — PaperMark carries no provenance — so a crashed
    // mint fully covered by nightly stamps reads as walked. Near-
    // equivalent outcome: nightly ran the same evaluator on the same
    // closes.)
    if (existing && !mintSeeded) {
      return { signalId, tradeId, status: 'deduped' };
    }

    const bars = await deps.getBars(item.symbol);
    for (let i = 1; i < bars.length; i++) {
      if (bars[i].d <= bars[i - 1].d) {
        return {
          signalId,
          tradeId,
          status: 'error',
          error: `${item.symbol} bars not d-ascending at index ${i} — refusing to walk unordered history`,
        };
      }
    }
    const entryIdx = bars.findIndex((b) => b.d === item.signalBarDate);
    if (entryIdx < 0) {
      return {
        signalId,
        tradeId,
        status: 'error',
        error: `no stored bar on ${item.signalBarDate} for ${item.symbol}`,
      };
    }
    const entryBar = bars[entryIdx];
    if (!isUsableBar(entryBar)) {
      return {
        signalId,
        tradeId,
        status: 'error',
        error: `signal bar ${item.signalBarDate} unusable (non-finite close or interim flag)`,
      };
    }

    if (
      existing &&
      !bars
        .slice(entryIdx + 1)
        .some((b) => isUsableBar(b) && existing.marks?.[b.d] === undefined)
    ) {
      return { signalId, tradeId, status: 'deduped' };
    }

    const occurrenceId = stSignalOccurrenceId(item.symbol, item.signalBarDate, item.signalType);
    const signal = await deps.getSignal(occurrenceId);
    if (!signal) {
      return { signalId, tradeId, status: 'error', error: `signal doc ${occurrenceId} not found` };
    }
    // A doc whose identity fields disagree with the pick is corrupt —
    // minting from it would stamp a side/type that contradicts the id.
    if (
      signal.symbol !== item.symbol ||
      signal.barDate !== item.signalBarDate ||
      signal.signalType !== item.signalType
    ) {
      return {
        signalId,
        tradeId,
        status: 'error',
        error: `signal doc ${occurrenceId} identity mismatch (${signal.symbol}/${signal.signalType}/${signal.barDate})`,
      };
    }
    // Legacy docs persist 'LONG'/'SHORT' — normalize; an unparseable
    // direction is corrupt data, not a long.
    const side = normalizeStSignalDirection(signal.direction);
    if (!side) {
      return {
        signalId,
        tradeId,
        status: 'error',
        error: `signal ${occurrenceId} has unparseable direction '${signal.direction}'`,
      };
    }

    // Canonical pick ticket BEFORE the ledger write (live-ingest order);
    // auto:false marks a manual pick, idSeed dedupes a retried emit.
    // Fail-soft — a ticket miss never blocks the mint. Runs on the resume
    // path too: a prior mint may have crashed before its emit landed.
    ticketId = await emitPickTicket({ deps, item, tradeId, occurrenceId, side, signal, now });

    let trade: PaperTrade;
    if (existing) {
      trade = existing;
      entryCommitted = true;
    } else {
      const entry = await deps.applyEntryFill({
        userId: AUTO_PAPER_USER_ID,
        tradeId,
        order: { side, type: 'MARKET', quantity: 1 },
        legs: [
          {
            kind: 'share',
            side,
            quantity: 1,
            multiplier: 1,
            entryMark: entryBar.c,
            lastMark: entryBar.c,
          },
        ],
        fill: {
          fillId: `entry-${tradeId}`,
          role: 'entry',
          date: item.signalBarDate,
          price: entryBar.c,
          quantity: 1,
          quoteSource: OptionQuoteSource.SDS_BARS,
        },
        underlyingClose: entryBar.c,
        dims: {
          source: PaperTradeSource.SIGNAL,
          symbol: item.symbol,
          expression: EQUITY_TRADE_DESC,
          governingVariant: DEFAULT_TRAILING_STOP_KEY, // policy fallback seed
          variantKeys: [...CURATED_VARIANT_KEYS],
          signalId,
          governingPolicy: CURATED_GOVERNING_POLICY,
        },
        tradeOverrides: {
          signalType: item.signalType,
          signalTimeframe: signal.timeframe,
          signalBarDate: item.signalBarDate,
          signalStatus: signal.status,
          signalRunId: signal.sourceRunId,
          signalIndicators: signal.indicators,
        },
        now,
      });
      trade = entry.trade;
      entryCommitted = true;
    }
    // Stored ledger truth — on a resume this can disagree with today's
    // bars (a corrected close), and the ticket + walk must follow what
    // the ledger actually filled at. The mint is single-leg by contract;
    // a doc that doesn't match is corrupt, not resumable.
    const entryFill = trade.fills.find((f) => f.role === 'entry');
    if (!entryFill || trade.legs.length !== 1) {
      return {
        signalId,
        tradeId,
        status: 'error',
        error: `${tradeId} is missing its entry fill or has != 1 leg — corrupt ledger doc`,
      };
    }
    if (ticketId && deps.tickets) {
      await deps.tickets
        .markFilled(
          ticketId,
          { averagePrice: entryFill.price, filledQty: 1, filledAt: now },
          now,
        )
        .catch((err) =>
          logger.warn(
            `pick ticket markFilled failed ${ticketId}: ${err instanceof Error ? err.message : String(err)}`,
          ),
        );
    }

    // ── In-memory forward walk (see header for intentional divergences) ──
    // A resume RE-SEEDS runs rather than continuing the doc's state —
    // the nightly eval pass may have advanced watermarks on an unwalked
    // doc, and replaying old bars against advanced state can
    // false-trigger exits. The walk is a deterministic replay from
    // entry; the doc's keys carry its seeded set.
    const runs: VariantRun[] = trade.variantRuns.map((r) => ({
      variantKey: r.variantKey,
      governing: r.variantKey === DEFAULT_TRAILING_STOP_KEY,
      state: 'ACTIVE',
      workingState: {},
    }));
    const marks: Record<string, PaperMark> = { ...trade.marks };
    const skippedSma = new Set<string>();
    let mirror = trade.governingVariant;
    let exitFill: PaperFill | undefined;
    let closed = false;
    let lastMark = entryBar.c;
    let lastMarkDate = entryBar.d;

    for (let i = entryIdx + 1; i < bars.length; i++) {
      const b = bars[i];
      if (!isUsableBar(b)) continue; // never mint a corrupt/interim mark
      marks[b.d] = { mark: b.c, underlyingClose: b.c };
      lastMark = b.c;
      lastMarkDate = b.d;
      const actives = runs.filter((r) => r.state === 'ACTIVE');
      const indicators = smaIndicatorsFor(actives, bars, b.d);
      const pick = selectGoverningRun(actives, {
        trade,
        mark: b.c,
        ...(indicators ? { indicators } : {}),
      });
      for (const r of runs) {
        r.governing = r.state === 'ACTIVE' && r.variantKey === pick?.variantKey;
      }
      if (pick) mirror = pick.variantKey;

      const daysHeld = calendarDaysBetween(item.signalBarDate, b.d);
      for (const run of runs) {
        if (run.state !== 'ACTIVE') continue;
        const def = parseVariantKey(run.variantKey);
        // Never fire blind — missing SMA history skips the ma-close run.
        if (
          def?.family === 'ma-close' &&
          indicators?.sma?.[def.params.period] === undefined
        ) {
          if (!skippedSma.has(run.variantKey)) {
            skippedSma.add(run.variantKey);
            logger.warn(
              `${tradeId}: ${run.variantKey} skipped — SMA window incomplete for part of the walk`,
            );
          }
          continue;
        }
        let out;
        try {
          out = evaluateVariant({
            trade,
            mark: b.c,
            date: b.d,
            daysHeld,
            run,
            underlyingClose: b.c,
            ...(indicators ? { indicators } : {}),
          });
        } catch (err) {
          // Per-run isolation — mirror the nightly pass.
          logger.warn(
            `${tradeId}/${run.variantKey}@${b.d}: ${err instanceof Error ? err.message : String(err)}`,
          );
          continue;
        }
        if (!out.trigger) {
          if (out.workingState) run.workingState = out.workingState;
          continue;
        }
        const evt: VariantExitEvent = {
          date: b.d,
          price: b.c,
          pnl: computeExitPnl(entryFill, b.c, trade.order.side, trade.legs),
          daysHeld,
        };
        run.state = 'EXITED';
        run.exitEvent = evt;
        if (!closed && (run.governing || isIndependentCloser(run.variantKey))) {
          exitFill = {
            fillId: `exit-${tradeId}-${run.variantKey}-${b.d}`,
            role: 'exit',
            date: b.d,
            price: b.c,
            quantity: trade.order.quantity,
            quoteSource: OptionQuoteSource.SDS_BARS,
          };
          mirror = run.variantKey; // attribution names the actual closer
          closed = true;
        }
      }
      if (closed) break;
    }

    // Ledger close BEFORE the state commit (nightly's close→annotate
    // order — a missed commit leaves a CLOSED trade the nightly repair
    // path annotates from the exit fill, not an OPEN one with a dead
    // governing run).
    if (exitFill) {
      await deps.applyExitFill({
        userId: AUTO_PAPER_USER_ID,
        tradeId,
        fill: exitFill,
        now,
      });
    }
    await deps.commitBackfill(tradeId, {
      marks,
      // Single-leg mint — the leg mark walks with the last close (the
      // exit bar's close when closed, matching what applyExitFill wrote).
      legs: [{ ...trade.legs[0], lastMark }],
      variantRuns: runs,
      governingVariant: mirror,
      lastMarkedAt: lastMarkDate,
      ...(closed
        ? {}
        : { unrealizedPnl: computeExitPnl(entryFill, lastMark, trade.order.side, trade.legs) }),
    });
    return { signalId, tradeId, status: 'created' };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    // A concurrent mint's ledger dedupe ('already exists') reads as a
    // deduped result. No ticket transition here — the winning mint
    // already stamped markFilled with the real fill price; a second
    // markFilled would overwrite it (filled←filled is a legal
    // transition).
    if (/already exists/i.test(msg)) {
      return { signalId, tradeId: tradeId || undefined, status: 'deduped' };
    }
    if (ticketId && deps.tickets && !entryCommitted) {
      await deps.tickets
        .markFailed(ticketId, { category: 'paper-fill', message: msg }, now)
        .catch(() => {});
    }
    logger.warn(`backfill ${signalId}: ${msg}`);
    return { signalId, tradeId: tradeId || undefined, status: 'error', error: msg };
  }
}

async function emitPickTicket(args: {
  deps: BackfillSignalTradeDeps;
  item: SignalPick;
  tradeId: string;
  occurrenceId: string;
  side: TradeSide;
  signal: StSignal;
  now: string;
}): Promise<string | null> {
  const { deps, item, tradeId, occurrenceId, side, signal, now } = args;
  if (!deps.tickets) return null;
  try {
    return await deps.tickets.emit({
      mode: 'paper',
      idSeed: tradeId,
      origin: { type: 'signal', signalId: occurrenceId, runId: signal.sourceRunId },
      auto: false, // manual pick, not an automated capture
      terms: {
        symbol: item.symbol,
        side: side === TradeSide.SHORT ? 'sell' : 'buy',
        instrument: 'equity',
        quantity: 1,
        orderType: 'market',
        timeInForce: 'gfd',
        marketHours: 'regular_hours',
      },
      accountTarget: buildAccountId(AUTO_PAPER_USER_ID),
      userId: AUTO_PAPER_USER_ID,
      signalContext: {
        signalType: item.signalType,
        barDate: item.signalBarDate,
        timeframe: signal.timeframe,
        direction: signal.direction,
      },
      now,
    });
  } catch (err) {
    logger.warn(
      `pick ticket emit failed ${tradeId}: ${err instanceof Error ? err.message : String(err)}`,
    );
    return null;
  }
}
