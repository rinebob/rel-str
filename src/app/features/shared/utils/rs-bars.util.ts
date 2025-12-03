import type { OHLCDatum } from '../types/rs.interfaces';

/**
 * compressDailyTo2DayBars
 *
 * Fixed-boundary compression from daily OHLC bars into non-overlapping
 * 2-day bars. Historical groupings are stable: once a bar is formed it
 * never changes when new daily data arrives. The final bar may be a
 * single-day partial bar when the total count is odd.
 */
export function compressDailyTo2DayBars(dailyBars: OHLCDatum[]): OHLCDatum[] {
  if (!Array.isArray(dailyBars) || dailyBars.length === 0) {
    return [];
  }

  if (dailyBars.length === 1) {
    const only = dailyBars[0];
    const date = only.date ?? toYmd(only.x);
    return [
      {
        ...only,
        x: only.x instanceof Date ? only.x : new Date(`${date}T00:00:00.000Z`),
        date,
      },
    ];
  }

  const result: OHLCDatum[] = [];
  const sorted = [...dailyBars].sort((a, b) => {
    const da = (a.date ?? toYmd(a.x)) ?? '';
    const db = (b.date ?? toYmd(b.x)) ?? '';
    return da.localeCompare(db);
  });

  for (let i = 0; i < sorted.length; i += 2) {
    const a = sorted[i];
    const b = sorted[i + 1];

    const aDate = a.date ?? toYmd(a.x);

    if (!b) {
      const x = a.x instanceof Date ? a.x : new Date(`${aDate}T00:00:00.000Z`);
      result.push({
        ...a,
        x,
        date: aDate,
      });
      break;
    }

    const bDate = b.date ?? toYmd(b.x);

    const open = a.open;
    const close = b.close;
    const high = Math.max(a.high, b.high);
    const low = Math.min(a.low, b.low);
    const volume = (a.volume ?? 0) + (b.volume ?? 0);
    const x = new Date(`${bDate}T00:00:00.000Z`);

    result.push({
      x,
      date: bDate,
      open,
      high,
      low,
      close,
      volume,
    });
  }

  return result;
}

function toYmd(d: Date | string): string {
  const date = d instanceof Date ? d : new Date(d);
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  const day = String(date.getUTCDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}
