/**
 * Advisory STO collateral estimate (Topic #1177 / task #1190) — parses the
 * `collateral` block of a `review_option_order` response into the display
 * line the option ticket renders for sell-to-open orders.
 *
 * Wire shape verified against live captures
 * (docs/topics/657-rh-mcp/captures/opt-rev-csp.json + opt-rev-naked.json):
 *
 *   collateral: {
 *     account_number: string,
 *     cash:     { amount: string, direction: 'debit'|'credit', infinite: bool },
 *     equities: [{ symbol, quantity: string, uncovered_shares: string, ... }]
 *   }
 *
 * Cash-secured put: cash.amount = the locked debit (strike×100), equities [].
 * Naked call:       cash.infinite = true (amount 0) and equities carries what
 *                   the order is missing (uncovered_shares — 100/contract).
 * Covered call:     equities[] reports share collateral; a fully covered
 *                   order reports no uncovered shares.
 *
 * Advisory only — the caller renders the line or nothing; RH enforces at place.
 */

/** One leg's share-based collateral requirement (covered calls). */
export interface StoCollateralShare {
  /** Underlying ticker the shares collateralize. */
  readonly symbol: string;
  /** Shares the position is missing — RH's `uncovered_shares`. */
  readonly uncovered: number;
}

/** Parsed collateral estimate — absent fields mean "not reported". */
export interface StoCollateral {
  /** Cash the order locks (debit) — parsed from the wire's string amount. */
  readonly cashAmount?: number;
  /** Unlimited-risk flag — a naked position the broker will reject at place. */
  readonly cashInfinite?: boolean;
  /** Share collateral requirements — only entries with uncovered > 0. */
  readonly shares?: readonly StoCollateralShare[];
}

const num = (v: unknown): number | undefined => {
  const n = typeof v === 'number' ? v : parseFloat(String(v ?? ''));
  return Number.isFinite(n) ? n : undefined;
};

/** Pull the collateral estimate out of a review_option_order result —
 *  accepts the parsed tool payload (collateral nested under `data`) or a
 *  bare collateral-bearing object. Returns null on any shape it can't read —
 *  the caller renders nothing. */
export function parseStoCollateral(parsed: unknown): StoCollateral | null {
  if (!parsed || typeof parsed !== 'object') return null;
  const root = parsed as Record<string, unknown>;
  const inner =
    root['data'] && typeof root['data'] === 'object'
      ? (root['data'] as Record<string, unknown>)
      : root;
  const col = inner['collateral'];
  if (!col || typeof col !== 'object') return null;
  const rec = col as Record<string, unknown>;

  const cash = rec['cash'];
  const cashObj = cash && typeof cash === 'object' ? (cash as Record<string, unknown>) : null;
  const cashAmount = cashObj ? num(cashObj['amount']) : num(cash);
  const cashInfinite = cashObj?.['infinite'] === true;

  const equities = rec['equities'];
  const shares: StoCollateralShare[] = [];
  if (Array.isArray(equities)) {
    for (const entry of equities) {
      if (!entry || typeof entry !== 'object') continue;
      const e = entry as Record<string, unknown>;
      // uncovered_shares only — `quantity` (0E-8 in the naked capture) is
      // shares already held, not the requirement; guessing it would
      // render a false "Requires ~N shares held" on covered positions.
      const uncovered = num(e['uncovered_shares']);
      if (uncovered === undefined || uncovered <= 0) continue;
      shares.push({ symbol: String(e['symbol'] ?? ''), uncovered });
    }
  }

  if (cashAmount === undefined && !cashInfinite && shares.length === 0) return null;
  return {
    ...(cashAmount !== undefined ? { cashAmount } : {}),
    ...(cashInfinite ? { cashInfinite } : {}),
    ...(shares.length ? { shares } : {}),
  };
}

/** The rendered advisory line — the unlimited-risk warning leads (a naked
 *  position RH will reject at place), then the cash lock, then per-leg
 *  share requirements. Returns null when nothing needs displaying. */
export function stoCollateralText(c: StoCollateral | null): string | null {
  if (!c) return null;
  const parts: string[] = [];
  if (c.cashInfinite) {
    parts.push('Unlimited risk — the broker may reject this order');
  }
  if (c.cashAmount !== undefined && c.cashAmount > 0) {
    parts.push(
      `Locks ~${c.cashAmount.toLocaleString('en-US', {
        style: 'currency',
        currency: 'USD',
        maximumFractionDigits: 0,
      })} cash`,
    );
  }
  for (const s of c.shares ?? []) {
    parts.push(
      `Requires ~${s.uncovered.toLocaleString('en-US')}${s.symbol ? ` ${s.symbol}` : ''} shares held`,
    );
  }
  return parts.length ? parts.join(' · ') : null;
}
