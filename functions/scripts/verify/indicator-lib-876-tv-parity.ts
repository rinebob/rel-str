/**
 * Parity check for Task #876 - ST Trigger Bands engine vs the TradingView
 * Pine script (rb-st-trigger-bands.pine).
 *
 * Input is a TradingView "Export chart data" CSV with the script applied. It
 * carries both the bars (time, open, high, low, close) and the script's plots
 * (Upper, Lower, longPullbackState, longBreakout, shortPullbackState,
 * shortBreakout). The engine is run on the CSV's OWN bars, so any difference
 * is a logic difference, not a data-feed difference.
 *
 * Pine plots the state/breakout flags as constants when true (5, 10, -5, -10)
 * and na (empty cell) otherwise; "true" below means a non-empty cell.
 *
 * Run from the functions/ directory:
 *   npx tsx scripts/verify/indicator-lib-876-tv-parity.ts "<path-to-csv>" [WARMUP_BARS]
 *
 * No Firestore access needed. WARMUP_BARS (default 30) skips the first bars,
 * where the Pine state carries history the export does not contain.
 */

import { readFileSync } from 'node:fs';
import { computeStTriggerBands } from '../../src/indicators/st-trigger-bands';
import type { OHLCV } from '../../src/indicators/st-trend-bands';

const TOL = 0.005;

function main(): void {
  const path = process.argv[2];
  const warmup = Number(process.argv[3] ?? 30);
  if (!path) {
    console.error('usage: tsx scripts/verify/indicator-lib-876-tv-parity.ts "<csv>" [WARMUP_BARS]');
    process.exit(2);
  }

  const lines = readFileSync(path, 'utf8').split(/\r?\n/).filter((l) => l.trim().length > 0);
  const header = lines[0].split(',');
  const col = (name: string): number => {
    const i = header.indexOf(name);
    if (i < 0) throw new Error(`column "${name}" not found in CSV header`);
    return i;
  };
  const c = {
    time: col('time'), open: col('open'), high: col('high'), low: col('low'), close: col('close'),
    upper: col('Upper'), lower: col('Lower'),
    lps: col('longPullbackState'), lbk: col('longBreakout'),
    sps: col('shortPullbackState'), sbk: col('shortBreakout'),
  };
  const rows = lines.slice(1).map((l) => l.split(','));
  const bars: OHLCV[] = rows.map((r) => ({
    open: Number(r[c.open]), high: Number(r[c.high]), low: Number(r[c.low]), close: Number(r[c.close]),
  }));
  const date = (i: number): string => new Date(Number(rows[i][c.time]) * 1000).toISOString().slice(0, 10);
  const flag = (i: number, k: number): boolean => rows[i][k] !== undefined && rows[i][k] !== '';

  const r = computeStTriggerBands(bars);
  const n = bars.length;
  console.log(`=== Task #876 parity: engine vs TradingView export ===`);
  console.log(`${n} bars, ${date(0)} .. ${date(n - 1)}; skipping first ${warmup} bars\n`);

  const mismatches: string[] = [];
  const counts = { lps: 0, lbk: 0, sps: 0, sbk: 0 };
  let bandChecked = 0;
  for (let i = warmup; i < n; i++) {
    const pairs: [string, boolean, boolean][] = [
      ['longPullbackState', r.longPullbackState[i], flag(i, c.lps)],
      ['longBreakout', r.longBreakout[i], flag(i, c.lbk)],
      ['shortPullbackState', r.shortPullbackState[i], flag(i, c.sps)],
      ['shortBreakout', r.shortBreakout[i], flag(i, c.sbk)],
    ];
    for (const [name, eng, tv] of pairs) {
      if (eng !== tv) mismatches.push(`${date(i)} idx ${i} ${name}: engine ${eng} TV ${tv}`);
    }
    counts.lps += flag(i, c.lps) ? 1 : 0;
    counts.lbk += flag(i, c.lbk) ? 1 : 0;
    counts.sps += flag(i, c.sps) ? 1 : 0;
    counts.sbk += flag(i, c.sbk) ? 1 : 0;
    const tu = Number(rows[i][c.upper]);
    const tl = Number(rows[i][c.lower]);
    bandChecked++;
    if (Math.abs((r.upper[i] as number) - tu) > TOL) mismatches.push(`${date(i)} idx ${i} upper: engine ${r.upper[i]} TV ${tu}`);
    if (Math.abs((r.lower[i] as number) - tl) > TOL) mismatches.push(`${date(i)} idx ${i} lower: engine ${r.lower[i]} TV ${tl}`);
  }

  console.log(`Compared ${n - warmup} bars (${bandChecked} band pairs, 4 flags each)`);
  console.log(`TV flag counts: longPullbackState ${counts.lps}, longBreakout ${counts.lbk}, shortPullbackState ${counts.sps}, shortBreakout ${counts.sbk}`);
  if (counts.lbk === 0 || counts.sbk === 0) console.log('WARNING: no breakouts on one side - the comparison is weak');
  if (mismatches.length === 0) {
    console.log('\nPASS: bands and all four plotted flags match on every compared bar');
    process.exit(0);
  }
  console.log(`\nFAIL: ${mismatches.length} mismatch(es)`);
  for (const m of mismatches.slice(0, 40)) console.log(`  ${m}`);
  if (mismatches.length > 40) console.log(`  ... ${mismatches.length - 40} more`);
  process.exit(1);
}

main();
