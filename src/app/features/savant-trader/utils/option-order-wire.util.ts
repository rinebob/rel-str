/**
 * Option order wire args (Topic #942 / #1177) — the single owner of the
 * `review_option_order` / `place_option_order` snake_case contract. Both
 * writers converge here: the execution path (ticket-derived, in
 * OrderExecutionService) and the STO collateral preview (form-derived, in
 * the option ticket component). Two owners of one wire shape drift
 * silently — the service's mocked specs accept anything.
 *
 * The wire is legs-oriented: one {option_id, side, position_effect}
 * object per leg (ratio_quantity only when set — v1 single-leg omits
 * it), plus type/quantity/market_hours. `direction` is never sent — RH
 * derives it from the legs. `price` rides only on priced types;
 * `stop_price` only on stop types — RH rejects either field on a type
 * that doesn't carry it. `chain_symbol` + `underlying_type` are optional
 * but enable the fee + collateral fields in the review response
 * (rh-mcp-tools-orders.md) — always pass both when known.
 */
import { OptionLeg } from '../services/order-ticket.types';

export interface OptionOrderWireInput {
  accountNumber: string;
  legs: readonly Pick<OptionLeg, 'optionId' | 'side' | 'positionEffect' | 'ratioQuantity'>[];
  /** Wire order type — the caller maps its domain enum ('stop_loss' →
   *  'stop_market') before calling. */
  type: string;
  quantity: string;
  timeInForce?: string;
  price?: string;
  stopPrice?: string;
  /** Underlying ticker — pair with underlyingType to enable the fee +
   *  collateral fields in the review response. */
  chainSymbol?: string;
  underlyingType?: 'equity' | 'index';
}

export function buildOptionOrderWireArgs(i: OptionOrderWireInput): Record<string, unknown> {
  const args: Record<string, unknown> = {
    account_number: i.accountNumber,
    legs: i.legs.map((leg) => {
      const wire: Record<string, unknown> = {
        option_id: leg.optionId,
        side: leg.side,
        position_effect: leg.positionEffect,
      };
      if (leg.ratioQuantity != null) wire['ratio_quantity'] = leg.ratioQuantity;
      return wire;
    }),
    type: i.type,
    quantity: i.quantity,
    // Options only trade regular hours — the ticket field is typed for
    // the equity enum, so pin the literal rather than trusting it.
    market_hours: 'regular_hours',
  };
  const priced = i.type === 'limit' || i.type === 'stop_limit';
  const stopped = i.type === 'stop_market' || i.type === 'stop_limit';
  if (priced && i.price) args['price'] = i.price;
  if (stopped && i.stopPrice) args['stop_price'] = i.stopPrice;
  if (i.timeInForce) args['time_in_force'] = i.timeInForce;
  if (i.chainSymbol) args['chain_symbol'] = i.chainSymbol;
  if (i.underlyingType) args['underlying_type'] = i.underlyingType;
  return args;
}
