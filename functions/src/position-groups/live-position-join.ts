/**
 * @topic #984 — ST Firestore Reorg (task #1004)
 *
 * Live position join — the deterministic membership rule for live
 * `st-position-groups`: which broker positions belong to a group.
 *
 * - Equity holdings join through `tax_lots[].order_id` matching a member
 *   live ticket's `brokerOrderId` (RH stamps the opening order id on each
 *   lot).
 * - Option positions join through `option_id` matching a member ticket's
 *   leg identity (`terms.legs[].optionId`). `chain_id` is also matched
 *   when a caller supplies chain ids — but a chain id identifies the
 *   WHOLE chain (every strike/expiry on the underlying), so a chain-level
 *   membership input joins positions other groups may own. Prefer
 *   `option_id` (the leg-precise join); pass chain ids only for
 *   deliberately chain-scoped membership.
 *
 * Pure functions — no Firestore, no MCP. The caller supplies the group's
 * membership (`collectGroupMembership` extracts it from member tickets)
 * plus the raw RH tax-lot / option-position payloads.
 */
import type { StOrderTicket } from '@st/order-tickets';

/** What joins a group to broker positions — collected from member tickets. */
export interface LiveJoinMembership {
  /** `brokerOrderId` of each live member ticket (st-order-tickets). */
  brokerOrderIds: string[];
  /** Leg identities across member tickets — RH option UUIDs (`option_id`).
   *  Chain ids work but join chain-wide — see the module header. */
  optionLegIds: string[];
}

/** Minimal equity tax-lot shape the join needs (raw RH payload). */
export interface EquityTaxLotLike {
  order_id?: string | null;
}

/** Minimal option-position shape the join needs (raw RH payload). */
export interface OptionPositionLike {
  option_id?: string | null;
  chain_id?: string | null;
}

export interface LiveJoinResult<TLot, TPos> {
  /** Tax lots whose `order_id` is a member broker order — group holdings. */
  taxLots: TLot[];
  /** Option positions matching a member leg identity. */
  optionPositions: TPos[];
  /** Member broker orders with no matching lot — sold legs, still-open
   *  orders, or fills RH hasn't lot-joined yet. Diagnostic, not an error. */
  unmatchedBrokerOrderIds: string[];
}

/**
 * Deterministic membership join — a holding belongs to the group iff it
 * traces to a member order (equity) or member leg identity (options).
 */
export function joinLivePositions<
  TLot extends EquityTaxLotLike,
  TPos extends OptionPositionLike,
>(
  membership: LiveJoinMembership,
  taxLots: readonly TLot[],
  optionPositions: readonly TPos[],
): LiveJoinResult<TLot, TPos> {
  const orderIds = new Set(membership.brokerOrderIds);
  const legIds = new Set(membership.optionLegIds);

  const matchedLots = taxLots.filter(
    (l) => typeof l.order_id === 'string' && orderIds.has(l.order_id),
  );
  const matchedPositions = legIds.size
    ? optionPositions.filter(
        (p) =>
          (typeof p.option_id === 'string' && legIds.has(p.option_id)) ||
          (typeof p.chain_id === 'string' && legIds.has(p.chain_id)),
      )
    : [];

  const coveredOrders = new Set(matchedLots.map((l) => l.order_id as string));
  return {
    taxLots: matchedLots,
    optionPositions: matchedPositions,
    unmatchedBrokerOrderIds: membership.brokerOrderIds.filter(
      (id) => !coveredOrders.has(id),
    ),
  };
}

/**
 * Extract the join inputs from a group's member live tickets —
 * `brokerOrderId` on each ticket plus every leg `optionId`.
 */
export function collectGroupMembership(
  memberTickets: readonly Pick<StOrderTicket, 'brokerOrderId' | 'terms'>[],
): LiveJoinMembership {
  const brokerOrderIds: string[] = [];
  const optionLegIds: string[] = [];
  for (const t of memberTickets) {
    if (t.brokerOrderId) brokerOrderIds.push(t.brokerOrderId);
    for (const leg of t.terms?.legs ?? []) {
      if (leg.optionId) optionLegIds.push(leg.optionId);
    }
  }
  return { brokerOrderIds, optionLegIds };
}
