/**
 * @topic #261 — Trading Indicator Library, Thread #1665
 * @task #1675 — SHARED: computeIbs + availability
 *
 * Internal Bar Strength — IBS = (C-L)/(H-L) ∈ [0,1]; where the close sits
 * inside the bar's range. Canonical pure function for FE chart dots and BE
 * signal detection via the `@st/ibs` path alias.
 *
 * Availability semantics: returns `undefined` while the bar is the current
 * developing ET period and `now` precedes activation (default 12:00 ET for
 * daily, Wednesday for weekly) — an intraday/early-week IBS is too noisy to
 * gate a signal on. Callers treat `undefined` as "filter not applicable"
 * and let the signal through. Completed bars always return a value.
 */
/** Bar intervals IBS availability is defined for (IMPL doc: 'D' | 'W' only —
 *  a caller holding a wider signal timeframe must narrow explicitly). */
export type IbsTimeframe = 'D' | 'W';

export interface IbsBar {
  high: number;
  low: number;
  close: number;
  /** Market date 'YYYY-MM-DD' (the bar's `d` field). */
  date?: string;
}

export interface IbsAvailabilityContext {
  /** Reference instant; defaults to real wall-clock. Injected in tests/scripts. */
  now?: Date;
  /** ET minutes since midnight when daily IBS becomes meaningful (default 720 = 12:00). */
  activateAtEtMin?: number;
  /** Weekday (0=Sun … 6=Sat, `Date.getDay` numbering) when weekly IBS becomes meaningful (default 3 = Wed). */
  activateAtWeekday?: number;
}

const DEFAULT_ACTIVATE_ET_MIN = 720;
const DEFAULT_ACTIVATE_WEEKDAY = 3;

const ET_FORMAT = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/New_York',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  weekday: 'short',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
});

const ET_WEEKDAYS: Record<string, number> = {
  Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6,
};

interface EtParts {
  date: string;
  weekday: number;
  minutes: number;
}

function etParts(now: Date): EtParts {
  const parts = new Map(ET_FORMAT.formatToParts(now).map((p) => [p.type, p.value]));
  // hour12:false yields '24' for midnight on some ICU builds — normalize to 0.
  const hour = Number(parts.get('hour')) % 24;
  return {
    date: `${parts.get('year')}-${parts.get('month')}-${parts.get('day')}`,
    weekday: ET_WEEKDAYS[parts.get('weekday') ?? ''] ?? -1,
    minutes: hour * 60 + Number(parts.get('minute')),
  };
}

/** ISO-week key ('YYYY-MM-DD' of the week's Monday); null on malformed input. */
function weekKey(dateStr: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return null;
  const [y, m, d] = dateStr.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d, 12));
  // Date.UTC rolls out-of-range components into adjacent months — a
  // round-trip check is what actually rejects them (e.g. '2026-13-40').
  if (
    Number.isNaN(dt.getTime()) ||
    dt.getUTCFullYear() !== y ||
    dt.getUTCMonth() !== m - 1 ||
    dt.getUTCDate() !== d
  ) {
    return null;
  }
  dt.setUTCDate(dt.getUTCDate() - ((dt.getUTCDay() + 6) % 7));
  return dt.toISOString().slice(0, 10);
}

/**
 * IBS of one bar, or `undefined` while the bar is the current developing
 * period and evaluation time precedes activation for its timeframe.
 */
export function computeIbs(
  bar: IbsBar,
  timeframe: IbsTimeframe,
  ctx: IbsAvailabilityContext = {},
): number | undefined {
  const now = ctx.now ?? new Date();
  const activateAtEtMin = ctx.activateAtEtMin ?? DEFAULT_ACTIVATE_ET_MIN;
  const activateAtWeekday = ctx.activateAtWeekday ?? DEFAULT_ACTIVATE_WEEKDAY;

  if (bar.date && timeframe === 'D') {
    const et = etParts(now);
    if (bar.date === et.date && et.minutes < activateAtEtMin) return undefined;
  } else if (bar.date && timeframe === 'W') {
    const et = etParts(now);
    // Sunday is the trading week's tail — no session follows the Friday
    // close until Monday, so the current week's bar is complete and IBS
    // is defined. Mapping 0 → 7 keeps the weekday availability rule monotonic
    // (Sat defined, Sun defined, then Mon re-arms for the new week).
    const etWeekday = et.weekday === 0 ? 7 : et.weekday;
    if (weekKey(bar.date) === weekKey(et.date) && etWeekday < activateAtWeekday) return undefined;
  }

  const range = bar.high - bar.low;
  if (range <= 0) return 0.5;
  return (bar.close - bar.low) / range;
}
