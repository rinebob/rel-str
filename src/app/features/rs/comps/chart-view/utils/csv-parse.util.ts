/**
 * Utility for parsing OHLC CSV data for chart components.
 * Accepts CSV text and returns an array of candle objects.
 *
 * @param csv - CSV string (header + rows)
 * @returns Array of CandleWithRSColor
 */
import type { CandleWithRSColor } from '../chart-two/chart-two.component';

export function parseOhlcCsv(csv: string): CandleWithRSColor[] {
  const lines = csv.split('\n').filter(Boolean);
  lines.shift(); // Remove header
  return lines.map(line => {
    const [timestamp, open, high, low, close] = line.split(',');
    return {
      x: new Date(Number(timestamp) * 1000),
      open: +open,
      high: +high,
      low: +low,
      close: +close
    };
  });
}
