/**
 * @topic #1098 — RH Scanner | @task #1308
 *
 * Wire → chart transforms for the scanner popup's untracked candle chart.
 *
 * - `historicalsToBars` maps `get_equity_historicals` wire bars
 *   (string-priced OHLCV, `begins_at` ISO) into FlexChart `PriceBar`s
 *   through the canonical `equityWireBarToOhlc`/`ohlcToPriceBar` pair
 *   (#1259's transform — the popup charts the same wire). Malformed
 *   rows — unparseable dates, non-finite or empty prices — are dropped
 *   BEFORE conversion (the canonical coercion produces NaN silently);
 *   absent input is `[]` (no data ≠ an error).
 * - `smaOverlays` computes aligned SMA series per period — one point per
 *   bar with a `null` warmup head, so the rendered line starts at the
 *   first full window instead of ramping from partial means.
 * - `volumeColumns` builds the lower-pane volume histogram — one column
 *   per bar, up/down coloured to match the candle.
 */
import type { EquityHistoricalBar } from '@robinhood-mcp/contracts';
import type { PriceBar } from '../../shared/components/flex-chart/flex-chart.types';
import { equityWireBarToOhlc } from '../services/rh-chart.service';
import { ohlcToPriceBar } from './utils';

/** One SMA line aligned to the bars — `y` is null through the warmup. */
export interface SmaOverlay {
  period: number;
  points: { x: Date; y: number | null }[];
}

/** Price validity — `Number('') === 0` is the JS footgun: an empty wire
 *  string is malformed data, not a zero price. */
const validPrice = (v: string): boolean =>
  !(typeof v === 'string' && v.trim() === '') && Number.isFinite(Number(v));

/** Wire bars → chart bars; malformed rows drop, absent → []. */
export function historicalsToBars(
  raw: EquityHistoricalBar[] | null | undefined,
): PriceBar[] {
  if (!raw) return [];
  const out: PriceBar[] = [];
  for (const b of raw) {
    const begins = new Date(b.begins_at);
    if (
      !Number.isFinite(begins.getTime()) ||
      !validPrice(b.open_price) ||
      !validPrice(b.high_price) ||
      !validPrice(b.low_price) ||
      !validPrice(b.close_price)
    ) {
      continue;
    }
    out.push(ohlcToPriceBar(equityWireBarToOhlc(b)));
  }
  // RhChartService precedent: the wire is captured ascending, but sorting
  // is one line of insurance against server-side reordering — the
  // category axis inherits bar order.
  out.sort((a, b) => a.date.localeCompare(b.date));
  return out;
}

/**
 * One SMA series per requested period, each point aligned to its bar's
 * `x`. The first `period - 1` points carry `null` — warmup — so the
 * consumer can skip them rather than plot a fake partial-window ramp.
 */
export function smaOverlays(
  bars: readonly PriceBar[],
  periods: readonly number[],
): SmaOverlay[] {
  return periods.map((period) => {
    let windowSum = 0;
    const points = bars.map((b, i) => {
      windowSum += b.close;
      if (i >= period) windowSum -= bars[i - period].close;
      const y = i >= period - 1 ? windowSum / period : null;
      return { x: b.x, y };
    });
    return { period, points };
  });
}

/** Volume columns are emitted in millions — the popup's small lower axis
 *  can't label raw share counts (`{value}` has no per-pane format hook). */
const VOL_MILLIONS = 1e6;
/** Light-vocab candle literals — the chart palette lifts per-point
 *  `color` through colorRemap (#1216 exception, same as the SMA hexes). */
const VOL_UP_COLOR = '#26a69a';
const VOL_DOWN_COLOR = '#ef5350';

/**
 * One volume column per bar for the popup's lower pane — `y` in
 * millions, `color` tracking the candle direction (close ≥ open → up).
 * Absent/non-finite/negative volumes emit no point: a gap is honest,
 * a zero column isn't.
 */
export function volumeColumns(
  bars: readonly PriceBar[],
): { x: Date; y: number; color: string }[] {
  const out: { x: Date; y: number; color: string }[] = [];
  for (const b of bars) {
    const v = b.volume;
    if (v === undefined || !Number.isFinite(v) || v < 0) continue;
    out.push({
      x: b.x,
      y: v / VOL_MILLIONS,
      color: b.close >= b.open ? VOL_UP_COLOR : VOL_DOWN_COLOR,
    });
  }
  return out;
}
