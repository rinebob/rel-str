/**
 * Option staging lanes (Topic #942 / #1177) — one object per flow
 * capturing the axes that differ between signal-card and manual staging:
 * the leg's open side, which tickets the adopt/block probe matches, the
 * block message, the can-stage precondition, and the ticket builder.
 * The component's ensure path is then a single straight line — the
 * bound check, unbind, guard, adopt, and stage run identically for both
 * lanes instead of a `manual ?` branch woven through each.
 */
import { StSignalItem } from '../services/types';
import { OptionOrderTicket, OrderTicket } from '../services/order-ticket.types';
import {
  OptionContractRef,
  OptionTicketStagingContext,
  buildOptionSignalTicket,
} from './option-ticket-staging.util';
import { buildManualOptionTicket } from './manual-ticket-staging.util';
import {
  findCardOptionTickets,
  findMatchingOptionTickets,
  LIVE_OPTION_TICKET_STATUSES,
} from './option-ticket-lookup.util';

/** Builder context shared by both lanes — account, timestamp, ref-id mint. */
export type OptionStageBuildCtx = Pick<
  OptionTicketStagingContext,
  'accountNumber' | 'now' | 'buildRefId'
>;

export interface OptionStageLane {
  /** The leg's open side — 'buy' for signal cards, the toggle for manual. */
  readonly side: 'buy' | 'sell';
  /** Is the bound ticket the identity this contract stages into?
   *  Signal: always — a bound ticket IS the card's ticket, so a contract
   *  retarget re-legs it in place. Manual: only when the bound ticket's
   *  contract matches — {contract, side} IS the ticket identity, so a
   *  retarget to a different contract is a different ticket and must
   *  run the live-block probe (re-legging past it would bypass the
   *  guard against a live same-side ticket on the target contract). */
  isSameIdentity(bound: OptionOrderTicket, contract: OptionContractRef): boolean;
  /** Adopt/block probe — card provenance for signal, {contract, side}
   *  (source-agnostic) for manual. */
  probe(occSymbol: string): OptionOrderTicket[];
  /** Does a probe-matched ticket block staging? Signal lane: the card's
   *  live-or-FILLED set (one open option order per card). Manual lane:
   *  never — manual intent governs (QA #1226: adding to a position /
   *  running a parallel order is legitimate; each minted ticket tracks
   *  its own broker order). */
  isBlocking(t: OptionOrderTicket): boolean;
  /** The blocked-stage message shown inline + snackbar. `blocker` is the
   *  matched ticket that triggered the guard. */
  blockMessage(blocker?: OptionOrderTicket): string;
  /** Preconditions for minting a fresh ticket — a signal card with all
   *  occurrences rejected stages nothing; manual always can. */
  canStage(): boolean;
  /** Build the lane's ticket (null on builder refusal). */
  build(contract: OptionContractRef, ctx: OptionStageBuildCtx): OptionOrderTicket | null;
}

/** The signal-card lane — buy-to-open only, provenance-keyed probe,
 *  signalContext/decisionIds on the minted ticket. */
export function signalOptionLane(deps: {
  symbol: string;
  signals: readonly StSignalItem[];
  runId: string;
  /** Live read — the store map changes under the component, so the
   *  probe resolves it per call rather than snapshotting. */
  ticketsBySymbol: () => Record<string, OrderTicket[]>;
}): OptionStageLane {
  return {
    side: 'buy',
    isSameIdentity: () => true,
    probe: () =>
      findCardOptionTickets({
        symbol: deps.symbol,
        signals: deps.signals,
        runId: deps.runId,
        ticketsBySymbol: deps.ticketsBySymbol(),
      }),
    isBlocking: (t) => LIVE_OPTION_TICKET_STATUSES.has(t.status),
    blockMessage: () => `${deps.symbol}: a live option order already exists for this card`,
    canStage: () => deps.signals.length > 0,
    build: (contract, ctx) =>
      buildOptionSignalTicket(deps.symbol, [...deps.signals], contract, {
        runId: deps.runId,
        ...ctx,
      }),
  };
}

/** The manual lane — the user's BTO/STO pick, contract+side probe, and
 *  a provenance-free MANUAL ticket (OPT-MAN-{BTO|STO}-{occ} id). */
export function manualOptionLane(deps: {
  symbol: string;
  side: 'buy' | 'sell';
  ticketsBySymbol: () => Record<string, OrderTicket[]>;
}): OptionStageLane {
  return {
    side: deps.side,
    isSameIdentity: (bound, contract) => bound.legs[0]?.symbol === contract.occSymbol,
    probe: (occSymbol) =>
      findMatchingOptionTickets({
        symbol: deps.symbol,
        occSymbol,
        side: deps.side,
        ticketsBySymbol: deps.ticketsBySymbol(),
      }),
    // Manual staging never blocks on a probe match — parallel orders and
    // adding to a position are legitimate user intent. blockMessage is
    // unreachable for this lane but kept for interface uniformity.
    isBlocking: () => false,
    blockMessage: () => `${deps.symbol}: a live option order already exists for this contract`,
    canStage: () => true,
    build: (contract, ctx) => buildManualOptionTicket(deps.symbol, contract, deps.side, ctx),
  };
}
