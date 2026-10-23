/**
 * Option signal-ticket staging (Topic #942 / task #961) — pure builder
 * mirroring buildSignalOrderTickets: identical signalContext/decisionIds
 * semantics (canonical buildStOccurrenceDecisionId per occurrence, first
 * id → decisionId, all → decisionIds), but produces a single STAGED
 * OptionOrderTicket — one buy-to-open leg.
 *
 * `signals` is assumed single-card — same symbol, same direction — same
 * trust model as the equity builder; `first.direction` lands in the id.
 * There is no side dedup: the option ticket is always side 'buy' even on
 * a SHORT card (a long put is a buy-to-open), so every occurrence's id
 * lands on it. Reject is card-level session state post-#1017 — a
 * rejected card can't reach this builder, so every passed occurrence's
 * id is carried.
 */
import { StSignalItem } from '../services/types';
import {
  InstrumentType,
  OptionOrderTicket,
  OrderSource,
  OrderTicketStatus,
} from '../services/order-ticket.types';
import { buildStOccurrenceDecisionId } from '../services/firestore-helpers';
import { buildTicketId } from './signal-order-staging.util';

/** Inputs needed to build the option signal ticket. */
export interface OptionTicketStagingContext {
  runId: string;
  accountNumber: string;
  now: Date;
  buildRefId: () => string;
}

/** Canonical OCC contract-id charset — the only safe leg of a ticket doc
 *  id (a '/' or space would corrupt the Firestore path). Shared with the
 *  manual builder (#1177) so both enforce the same contract. */
export const OCC_SYMBOL_PATTERN = /^[A-Z0-9]+$/;

/** Resolved contract identity for the leg. */
export interface OptionContractRef {
  /** OCC contract id — leg display AND the ticket doc-id discriminator,
   *  so it is load-bearing: it must match `OCC_SYMBOL_PATTERN` (what
   *  `buildOccContractId` emits). The builder normalizes case and
   *  refuses anything else — a '/' would corrupt the doc path. */
  occSymbol: string;
  /** RH instrument UUID — the ordering identity. */
  optionId: string;
}

/**
 * Build the card's STAGED option ticket. `symbol` is the UNDERLYING — it
 * feeds `ticketsBySymbol` grouping; the OCC symbol lives on the leg.
 * Returns null when `signals` is empty (all occurrences rejected — the
 * caller snackbars instead of staging) or when `occSymbol` isn't a
 * canonical OCC id (it lands in the Firestore doc id).
 */
export function buildOptionSignalTicket(
  symbol: string,
  signals: StSignalItem[],
  contract: OptionContractRef,
  context: OptionTicketStagingContext,
): OptionOrderTicket | null {
  if (!signals.length) return null;

  // occSymbol lands in the Firestore doc id — normalize + enforce the
  // OCC charset (exactly what buildOccContractId emits) so a malformed
  // caller string can't corrupt the doc path ('/', spaces).
  const occSymbol = String(contract.occSymbol ?? '').toUpperCase();
  if (!OCC_SYMBOL_PATTERN.test(occSymbol)) return null;

  const { runId, accountNumber, now, buildRefId } = context;
  const first = signals[0];
  // Same canonical-id semantics as the equity builder — but no side
  // filter: the option ticket is always buy-to-open, so it owns every
  // non-rejected occurrence's decision regardless of card direction.
  const decisionIds = signals.map((s) =>
    buildStOccurrenceDecisionId(runId, s.symbol, s.timeframe, s.signalType),
  );
  const decisionId = decisionIds[0];

  return {
    // 'OPT' + direction + the OCC contract id keep the ticket id
    // human-readable, distinct from the equity ticket's
    // {SYMBOL}-{BUY|SELL}-…, AND unique per {card direction, contract} —
    // buildTicketId resolves to the PT minute, so two contracts staged
    // within one minute would collide on {SYMBOL}-OPT-{ts}, and a LONG
    // and SHORT card can legally coexist on the same underlying — the
    // later doc would .set()-overwrite the earlier one (no id uniqueness
    // enforcement in the store/service). The same-card same-contract
    // same-minute re-stage still maps to the same id — the reopen path.
    // The residual axis (same direction, different card, same contract,
    // same minute — or re-stage while the first ticket is live) is a
    // caller contract: check for an existing OPTION ticket for the card
    // before staging, reopen STAGED, block on live (#963).
    id: buildTicketId(symbol, `OPT-${first.direction}-${occSymbol}`, now),
    refId: buildRefId(),
    source: OrderSource.SIGNAL_PIPELINE,
    sourceRef: { type: 'occurrence_decision', id: decisionId },
    status: OrderTicketStatus.STAGED,
    accountNumber,
    side: 'buy',
    orderType: 'limit',
    timeInForce: 'gfd',
    marketHours: 'regular_hours',
    instrumentType: InstrumentType.OPTION,
    symbol: symbol.toUpperCase(),
    legs: [
      {
        side: 'buy',
        symbol: occSymbol,
        optionId: contract.optionId,
        positionEffect: 'open',
      },
    ],
    quantity: '1', // contracts — default 1 (same as the equity ticket);
    // the ticket form can edit it before submit
    signalContext: {
      signalType: first.signalType,
      barDate: first.barDate,
      timeframe: first.timeframe,
      direction: first.direction,
      decisionId,
      decisionIds,
      ...(first.closePrice != null ? { signalPrice: first.closePrice } : {}),
    },
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
  };
}
