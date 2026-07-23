/**
 * Build a test matrix of OCC-style QQQ option contract IDs from a monthly
 * underlying CSV/TSV. The output is a JSON file that can be fed directly into
 * the V2 historical-options endpoint validator.
 *
 * Usage (from the functions/ directory):
 *   npx tsx scripts/build-options-contract-matrix.ts [path-to-input.csv]
 *
 * Default input:  scripts/qqq-monthly.csv
 * Output:         scripts/options-contract-matrix.json
 *
 * The input file must have a header row with at least `time` and `close`
 * columns. The `time` column is expected to be Unix epoch seconds (as provided
 * in the user's monthly QQQ dump).
 */

import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_INPUT = path.join(__dirname, 'qqq-monthly.csv');
const OUTPUT = path.join(__dirname, 'options-contract-matrix.json');

const START_TEST = '2019-01-01';
const END_TEST = '2025-12-31';

interface MonthlyBar {
  date: string;
  close: number;
  time: number;
}

interface ContractCase {
  symbol: string;
  contractID: string;
  expiration: string;
  type: 'call' | 'put';
  strike: number;
  entryDate: string;
  startDate: string;
  endDate: string;
  durationLabel: string;
  underlyingClose: number;
}

function parseIso(date: string): number {
  return new Date(`${date}T00:00:00Z`).getTime();
}

function thirdFridayOf(year: number, month: number): string {
  const first = new Date(Date.UTC(year, month - 1, 1));
  const dow = first.getUTCDay(); // 0=Sun ... 5=Fri
  const firstFriday = 1 + ((5 - dow + 7) % 7);
  const day = firstFriday + 14;
  return new Date(Date.UTC(year, month - 1, day)).toISOString().slice(0, 10);
}

function buildContractId(
  symbol: string,
  expiration: string,
  type: 'C' | 'P',
  strike: number,
): string {
  const [y, m, d] = expiration.split('-');
  const yy = y.slice(-2);
  const padded = Math.round(strike * 1000).toString().padStart(8, '0');
  return `${symbol}${yy}${m}${d}${type}${padded}`;
}

function loadMonthlyBars(filePath: string): MonthlyBar[] {
  if (!fs.existsSync(filePath)) {
    throw new Error(`Input file not found: ${filePath}`);
  }
  const raw = fs.readFileSync(filePath, 'utf-8').trim();
  const lines = raw.split(/\r?\n/).filter(Boolean);
  if (lines.length < 2) {
    throw new Error('Input file must contain a header and at least one data row');
  }

  const headerLine = lines[0];
  const delimiter = headerLine.includes('\t') ? '\t' : ',';
  const headers = headerLine.split(delimiter).map(h => h.trim().toLowerCase());
  const timeIdx = headers.indexOf('time');
  const closeIdx = headers.indexOf('close');
  if (timeIdx === -1 || closeIdx === -1) {
    throw new Error(`Input must contain 'time' and 'close' columns. Found: ${headers.join(', ')}`);
  }

  const bars: MonthlyBar[] = [];
  for (let i = 1; i < lines.length; i++) {
    const row = lines[i].split(delimiter);
    const time = Number(row[timeIdx].trim());
    const close = Number(row[closeIdx].trim());
    if (!Number.isFinite(time) || !Number.isFinite(close)) {
      continue;
    }
    const date = new Date(time * 1000).toISOString().slice(0, 10);
    bars.push({ date, close, time });
  }
  return bars;
}

function buildMatrix(bars: MonthlyBar[]): ContractCase[] {
  const startTs = parseIso(START_TEST);
  const endTs = parseIso(END_TEST);
  const cases: ContractCase[] = [];

  for (const bar of bars) {
    const barTs = bar.time * 1000;
    if (barTs < startTs || barTs > endTs) continue;

    const entryDate = bar.date;
    const [yearStr, monthStr] = entryDate.split('-');
    const year = Number(yearStr);
    const month = Number(monthStr);

    // Third Friday of the next month => "1 month" contract.
    const nextMonth = month === 12 ? 1 : month + 1;
    const nextYear = month === 12 ? year + 1 : year;
    const oneMonthExpiry = thirdFridayOf(nextYear, nextMonth);
    if (parseIso(oneMonthExpiry) > parseIso(entryDate)) {
      const callStrike = Math.round(bar.close);
      cases.push({
        symbol: 'QQQ',
        contractID: buildContractId('QQQ', oneMonthExpiry, 'C', callStrike),
        expiration: oneMonthExpiry,
        type: 'call',
        strike: callStrike,
        entryDate,
        startDate: entryDate,
        endDate: oneMonthExpiry,
        durationLabel: '1M',
        underlyingClose: bar.close,
      });
    }

    // LEAPS: third Friday January of (year + 2), and (year + 3) for 2019 entries.
    const leapTargets: number[] = [];
    leapTargets.push(year + 2);
    if (year === 2019) {
      leapTargets.push(year + 3);
    }

    for (const leapYear of leapTargets) {
      if (leapYear > 2025) continue;
      const leapExpiry = thirdFridayOf(leapYear, 1);
      if (parseIso(leapExpiry) <= barTs) continue;
      const leapEnd = leapExpiry <= END_TEST ? leapExpiry : END_TEST;
      const callStrike = Math.round(bar.close);
      cases.push({
        symbol: 'QQQ',
        contractID: buildContractId('QQQ', leapExpiry, 'C', callStrike),
        expiration: leapExpiry,
        type: 'call',
        strike: callStrike,
        entryDate,
        startDate: entryDate,
        endDate: leapEnd,
        durationLabel: `LEAP-${leapYear}`,
        underlyingClose: bar.close,
      });
    }
  }

  return cases;
}

function main() {
  const inputPath = process.argv[2] || DEFAULT_INPUT;
  console.log(`Loading monthly bars from: ${inputPath}`);
  const bars = loadMonthlyBars(inputPath);
  console.log(`Loaded ${bars.length} monthly bars`);

  const matrix = buildMatrix(bars);
  fs.writeFileSync(OUTPUT, JSON.stringify(matrix, null, 2));
  console.log(`Wrote ${matrix.length} test contracts to: ${OUTPUT}`);

  const byLabel = matrix.reduce((acc, c) => {
    acc[c.durationLabel] = (acc[c.durationLabel] || 0) + 1;
    return acc;
  }, {} as Record<string, number>);
  console.log('Counts by duration:', byLabel);

  console.log('\nFirst 3 contract cases:');
  for (const c of matrix.slice(0, 3)) {
    console.log(`  ${c.contractID} (${c.durationLabel}, entry ${c.entryDate}, strike ${c.strike})`);
  }

  console.log('\nSample curl (run `gcloud auth print-identity-token` first):');
  const first = matrix[0];
  const url = `https://us-central1-alpha-vantage-proxy-api.cloudfunctions.net/partnerHistoricalOptionsContractV2?symbol=${first.symbol}&contractID=${first.contractID}&startDate=${first.startDate}&endDate=${first.endDate}`;
  console.log(`  curl -H "Authorization: Bearer <TOKEN>" "${url}"`);
}

main();
