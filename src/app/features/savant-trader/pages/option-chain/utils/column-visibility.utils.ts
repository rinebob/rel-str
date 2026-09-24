/**
 * Column-visibility selection model for the option-chain page's
 * expiration picker — DTE bands supply the default per window,
 * per-expiration overrides win. Feature-local: the pct-change page has
 * no column picker.
 */
import { daysBetween } from '../../../../shared/utils/date.util';

/** DTE band definition for the column picker's time-bucket rows. */
export interface ExpBand {
  id: string;
  label: string;
  test: (dte: number) => boolean;
}

/** Days-to-expiration buckets — membership is recomputed per session
 *  date, so band selections track DTE windows rather than fixed dates.
 *  Bounds are contiguous and non-overlapping; labels match them. */
export const EXP_BANDS: ExpBand[] = [
  { id: 'lt6', label: '<6d', test: (d) => d >= 0 && d < 6 },
  { id: 'd6_15', label: '6–15d', test: (d) => d >= 6 && d <= 15 },
  { id: 'd15_30', label: '16–30d', test: (d) => d > 15 && d <= 30 },
  { id: 'd30_60', label: '31–60d', test: (d) => d > 30 && d <= 60 },
  { id: 'd60_120', label: '61–120d', test: (d) => d > 60 && d <= 120 },
  { id: 'd120_365', label: '121–365d', test: (d) => d > 120 && d <= 365 },
  { id: 'gt365', label: '366d+', test: (d) => d > 365 },
];

/** Band id containing an expiration's DTE, or null when it fits none. */
export function dteBandId(session: string | null, exp: string): string | null {
  if (!session) return null;
  const dte = daysBetween(session, exp);
  return EXP_BANDS.find((b) => b.test(dte))?.id ?? null;
}

/**
 * Effective hidden-expiration set for the current session — band ids
 * supply the default per DTE window (re-evaluated on every session
 * change), per-expiration overrides win over the band default.
 */
export function effectiveHiddenExpirations(
  exps: readonly string[],
  session: string | null,
  hiddenBands: ReadonlySet<string>,
  expHidden: ReadonlySet<string>,
  expShown: ReadonlySet<string>,
): Set<string> {
  const out = new Set<string>();
  for (const e of exps) {
    const bandHidden = hiddenBands.has(dteBandId(session, e) ?? '');
    if (expShown.has(e)) continue;
    if (bandHidden || expHidden.has(e)) out.add(e);
  }
  return out;
}
