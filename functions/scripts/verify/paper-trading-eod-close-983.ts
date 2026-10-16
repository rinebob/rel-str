/**
 * Read-only verification for #983 — the nightly EOD close stamp on
 * signal-source paper trades.
 *
 * For every OPEN signal trade with share legs, compares the persisted
 * `marks[date]` against the SDS daily close (`getUnderlyingCloseForDate`
 * — the same source the stamp writes). Run AFTER a deployed nightly
 * chain completes:
 *
 *   - Before deploy: marks equal the last ~1 PM PT intraday RH quote;
 *     drift vs. the SDS close shows the gap this task fixes.
 *   - After deploy + one nightly run: every share-leg trade's mark
 *     equals the SDS close for that date exactly.
 *
 * Usage (from functions/):
 *   npx tsx scripts/verify/paper-trading-eod-close-983.ts [marketDate]
 *
 * marketDate defaults to today PT. Read-only — never writes.
 */
import { db } from '../../src/firebase-admin-init';
import { listTrades } from '../../src/paper-trading/repository';
import { getUnderlyingCloseForDate } from '../../src/paper-trading/engine/options-strategy-market-data';
import {
  PaperTradeSource,
  PaperTradeStatus,
} from '../../../shared/paper-trading-contracts';

const marketDate =
  process.argv[2] ??
  new Date().toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' });

const trades = await listTrades(db, {
  status: PaperTradeStatus.OPEN,
  source: PaperTradeSource.SIGNAL,
});

let ok = 0;
let drifted = 0;
let noClose = 0;
let nonShare = 0;

console.log(`Checking ${trades.length} open signal trades for ${marketDate}\n`);

for (const t of trades) {
  if (t.legs.some((l) => l.kind !== 'share')) {
    nonShare++;
    continue;
  }
  const close = await getUnderlyingCloseForDate(t.symbol, marketDate);
  const mark = t.marks?.[marketDate];
  if (close === null) {
    noClose++;
    console.log(`${t.id} ${t.symbol} — no SDS bar for ${marketDate}`);
    continue;
  }
  const markVal = mark?.mark;
  const matches = markVal === close;
  if (matches) ok++;
  else drifted++;
  console.log(
    `${t.id} ${t.symbol} — marks[${marketDate}]=${markVal ?? '∅'} ` +
      `sdsClose=${close} uc=${mark?.underlyingClose ?? '∅'} ${matches ? 'MATCH' : 'DRIFT'}`,
  );
}

console.log(
  `\nok=${ok} drifted=${drifted} noClose=${noClose} nonShare=${nonShare} total=${trades.length}`,
);
