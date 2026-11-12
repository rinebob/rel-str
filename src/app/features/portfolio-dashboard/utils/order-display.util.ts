/**
 * Order display helpers — how an order identifies itself in table cells.
 */

import { BrokerOrder } from '../../../core/robinhood-mcp/types/robinhood-mcp.types';

const strikeFormatter = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  minimumFractionDigits: 2,
});

/** Symbol-cell label. Equities get the bare ticker. Option orders resolve
 *  `symbol` to the underlying chain — a bare 'NFLX' is indistinguishable
 *  from the equity row (#1411 QA) — so a single-leg order renders its
 *  contract: `NFLX $15.00 C 2026-11-20`. A multi-leg order can't be one
 *  contract — `NFLX 2-leg` (leg detail is in the order payload). */
export function orderSymbolLabel(order: BrokerOrder): string {
  const sym = order.symbol ?? '—';
  if (order.instrumentType !== 'option') return sym;
  const legs = order.legs ?? [];
  if (legs.length === 1) {
    const leg = legs[0];
    const parts = [sym];
    if (leg.strikePrice != null) parts.push(strikeFormatter.format(leg.strikePrice));
    if (leg.optionType === 'call') parts.push('C');
    else if (leg.optionType === 'put') parts.push('P');
    if (leg.expirationDate) parts.push(leg.expirationDate.slice(0, 10));
    return parts.join(' ');
  }
  if (legs.length > 1) return `${sym} ${legs.length}-leg`;
  return sym;
}
