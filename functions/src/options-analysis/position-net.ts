/**
 * `position-net.ts` — the per-day signed cost-to-close series a
 * `ContractListPositionRow` feeds the shared exit evaluators (Topic
 * #1238, Thread #1270, task #1500; IMPL-BE §4 multi-leg extension).
 *
 * Sign space = cost-to-close (`signFor`): SHORT legs contribute
 * +mark, LONG legs −mark — a credit spread is a positive liability
 * that decays to 0, so the existing short-premium evaluators work
 * unchanged. The SAME signed formula applies to delta and iv: a
 * 1-leg short pick reproduces the v1 pick-row fields verbatim
 * (entryMark = mark, entryDelta = −0.2…), which is what lets v1
 * docs narrow to 1-leg positions without behavior change.
 *
 * Join semantics — INNER: a date missing from any living leg can't
 * price the package and drops out (a corpus hole on one leg must
 * never fabricate a net mark from stale data).
 *
 * Settlement freezing — an option leg past its expiry contributes
 * `frozenMark` (its intrinsic at ITS expiry, computed by the caller
 * from the underlying close — never fabricated here) on every later
 * date, so the position lives until the last leg expires. Frozen
 * legs carry no greeks: expired contracts have none, so the day's
 * net delta/iv are absent (absent-field → absent-value rule — a leg
 * missing a field voids the whole net field; nothing is fabricated).
 *
 * `expiry` on each emitted bar = the nearest LIVING option expiry —
 * a leg is living through its own expiry date — so `dte-time` exits
 * compare remaining days against the next leg to die, not blindly
 * against the position's last expiry. Stock legs are non-expiring
 * and never contribute an expiry.
 *
 * No network, no Firestore — unit-testable in isolation.
 */

import { TradeSide } from '@common';
import type { ExitScanBar } from './exit-evaluators';

/** Cost-to-close sign: a short leg is a liability (+), a long leg an
 *  offset (−). Same convention as the manage-exit-scan pass's netMark
 *  (#1544) — one sign space across every multi-leg net computation. */
export const signFor = (side: TradeSide): 1 | -1 => (side === TradeSide.SHORT ? 1 : -1);

/** One leg's value on one day — mark always present; greeks ride
 *  along when the observation carries them. */
export interface PositionLegDay {
  mark: number;
  delta?: number;
  iv?: number;
}

export interface PositionLegInput {
  side: TradeSide;
  /** Live daily values `date → day`. Option legs: normalized scan bars
   *  bounded to [entryDate, leg expiry]. Stock legs: underlying closes
   *  (delta = ±1 is stamped by the caller — stock has no iv). */
  live: ReadonlyMap<string, PositionLegDay>;
  /** Option legs only — the leg's expiration (YYYY-MM-DD). Stock legs
   *  leave this absent: they never expire and never freeze. */
  expiry?: string;
  /** Option legs whose expiry precedes the position's last expiry —
   *  the intrinsic settlement the leg contributes on every date past
   *  its expiry. Undefined on a leg that needs it → dates past its
   *  expiry can't be priced (drop out of the join). */
  frozenMark?: number;
}

/** Join the legs' daily values into the signed net series. Pure —
 *  every upstream failure (fetch, truncation, unpriceable settlement)
 *  is the caller's error path; this function only sees value maps.
 *  Bars are `ExitScanBar`s — `expiry` (nearest living option expiry)
 *  is the per-bar expiration `dte-time` prefers over the position max. */
export function buildPositionNetSeries(
  legs: readonly PositionLegInput[],
  maxExpiry: string,
): ExitScanBar[] {
  // Candidate dates = the union of live dates bounded to the position's
  // last expiry — frozen legs contribute only where a living leg's
  // dates exist.
  const candidates = new Set<string>();
  for (const l of legs) {
    for (const d of l.live.keys()) {
      if (d <= maxExpiry) candidates.add(d);
    }
  }

  const bars: ExitScanBar[] = [];
  for (const date of [...candidates].sort()) {
    let mark = 0;
    let delta = 0;
    let iv = 0;
    let deltaOk = true;
    let ivOk = true;
    let nearestExpiry: string | undefined;
    let joinable = true;
    for (const l of legs) {
      const sign = signFor(l.side);
      const liveDay = l.live.get(date);
      let day: PositionLegDay | undefined;
      if (l.expiry === undefined || date <= l.expiry) {
        day = liveDay; // living leg: requires a real observation
      } else if (l.frozenMark !== undefined) {
        day = { mark: l.frozenMark }; // dead leg: frozen settlement
      }
      if (day === undefined) {
        joinable = false;
        break;
      }
      mark += sign * day.mark;
      if (day.delta === undefined) deltaOk = false;
      else delta += sign * day.delta;
      if (day.iv === undefined) ivOk = false;
      else iv += sign * day.iv;
      if (l.expiry !== undefined && date <= l.expiry) {
        if (nearestExpiry === undefined || l.expiry < nearestExpiry) {
          nearestExpiry = l.expiry;
        }
      }
    }
    if (!joinable) continue;
    bars.push({
      date,
      mark,
      ...(deltaOk && { delta }),
      ...(ivOk && { iv }),
      ...(nearestExpiry !== undefined && { expiry: nearestExpiry }),
    });
  }
  return bars;
}
