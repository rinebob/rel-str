/**
 * Verification script for Task #1074 — deterministic CSV codec.
 *
 * Proves `serializeDataset` + `COLUMN_TYPES` against REAL prod trade docs:
 * pulls live signal-source paper trades (real stamped `signalIndicators`
 * → `ind.*` cells), projects them into TradeAnalysisRow, then checks:
 *   - header = manifest order, rows sorted by tradeId
 *   - serialize(shuffled) === serialize(sorted) — byte-identical
 *   - round-trip through a minimal RFC-4180 parse + COLUMN_TYPES coercion
 *     deep-equals the projected rows
 *   - no 'undefined'/'null'/'NaN' literal cells anywhere
 *   - every stamped ind.* value emits a formatted (quoted-or-plain) cell
 *
 * Read-only against prod — no writes.
 *
 * Requires ADC. Run from functions/:
 *   npx tsx scripts/verify/paper-trading-analysis-1074-csv-codec.ts
 *
 * Pass: every check prints ✔, exit 0. Fail: ✖ lines + exit 1.
 */

import { db } from '../../src/firebase-admin-init';
import {
  ANALYSIS_COLUMNS,
  AnalysisCohort,
  type TradeAnalysisRow,
} from '@paper-trading/analysis';
import { COLUMN_TYPES, serializeDataset } from '@paper-trading/analysis-csv';
import { TradeSide } from '@common';
import {
  PaperTradeSource,
  type PaperTrade,
} from '@paper-trading/contracts';
import { listTrades } from '../../src/paper-trading/repository';

let checks = 0;
let failed = 0;

function check(label: string, condition: boolean, detail = ''): void {
  checks++;
  console.log(`  ${condition ? '✔' : '✖'} ${label}${detail ? ` — ${detail}` : ''}`);
  if (!condition) failed++;
}

const num = (v: unknown): number | null => {
  const n = typeof v === 'string' ? Number(v) : v;
  return typeof n === 'number' && Number.isFinite(n) ? n : null;
};
const str = (v: unknown): string | null =>
  typeof v === 'string' && v !== '' ? v : null;

/** Codec-scope projection — full row derivation belongs to #1076. */
function project(trade: PaperTrade, datasetId: string): TradeAnalysisRow {
  const ind = trade.signalIndicators ?? {};
  const entry = trade.fills?.find((f) => f.role === 'entry');
  const exit = trade.fills?.find((f) => f.role === 'exit');
  return {
    datasetId,
    tradeId: trade.id,
    signalId: str(trade.signalId),
    signalType: str(trade.signalType),
    cohortId: str(trade.cohortId),
    positionGroupId: str(trade.positionGroupId),
    symbol: trade.symbol,
    direction: trade.order?.side ?? TradeSide.LONG,
    expression: trade.expression ?? 'EQ',
    captureList: str(trade.captureList),
    sector: str(trade.sector),
    industry: str(trade.industry),
    capTier: str(trade.marketCapTier),
    source: 'live',
    analysisCohort:
      trade.source === PaperTradeSource.SIGNAL
        ? AnalysisCohort.SIGNAL_EQUITY
        : AnalysisCohort.EXCLUDED,
    status: trade.status,
    signalStatus: str(trade.signalStatus) as TradeAnalysisRow['signalStatus'],
    signalBarDate: str(trade.signalBarDate),
    entryDate: str(entry?.date),
    entryPrice: num(entry?.price),
    exitDate: str(exit?.date),
    exitPrice: num(exit?.price),
    qty: num(trade.order?.quantity),
    daysHeld: null,
    exitReason: null,
    tradeRetPct: null,
    symbolMovePct: null,
    realizedPnl: num(trade.realizedPnl),
    capitalRequired: null,
    mfePct: null,
    maePct: null,
    mfeDate: null,
    maeDate: null,
    daysToMfe: null,
    givebackRatio: null,
    excursionSource: 'marks',
    'ind.delta': num(ind.delta),
    'ind.windowV2': num(ind.windowV2),
    'ind.zoneV1': num(ind.zoneV1),
    'ind.zoneV1Prev': num(ind.zoneV1Prev),
    'ind.zoneV2': num(ind.zoneV2),
    'ind.zoneV2Prev': num(ind.zoneV2Prev),
    'strength.diPlus': null,
    'strength.diMinus': null,
    'strength.diHist': null,
    'strength.adx': null,
  };
}

/** Minimal RFC-4180 parser — papaparse-equivalent for the round-trip. */
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  const push = () => {
    row.push(cell);
    cell = '';
    quoted = false;
  };
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (ch === '"') {
        quoted = false;
      } else {
        cell += ch;
      }
    } else if (ch === '"') {
      quoted = true;
    } else if (ch === ',') {
      push();
    } else if (ch === '\n') {
      push();
      rows.push(row);
      row = [];
    } else {
      cell += ch;
    }
  }
  return rows;
}

async function main(): Promise<void> {
  console.log('verify-1074: CSV codec → real trade data round-trip\n');

  const trades = await listTrades(db, { source: PaperTradeSource.SIGNAL });
  check('fetched live signal trades', trades.length >= 5, `${trades.length} docs`);

  // Query order is unspecified — take stamped trades first so the ind.*
  // path gets real data, then fill the sample with unstamped docs.
  const ordered = [...trades].sort(
    (a, b) =>
      Number(!!b.signalIndicators && Object.keys(b.signalIndicators).length > 0) -
      Number(!!a.signalIndicators && Object.keys(a.signalIndicators).length > 0),
  );
  const rows = ordered.slice(0, 25).map((t) => project(t, 'verify-1074'));
  const stamped = rows.filter((r) =>
    ['ind.delta', 'ind.windowV2', 'ind.zoneV1', 'ind.zoneV1Prev', 'ind.zoneV2', 'ind.zoneV2Prev']
      .some((k) => r[k as keyof TradeAnalysisRow] !== null),
  );
  check('some rows carry stamped ind.* values', stamped.length > 0,
    `${stamped.length}/${rows.length}`);

  const csv = serializeDataset(rows);

  // Header + ordering
  const lines = csv.split('\n').filter((l) => l.length > 0);
  check('header = manifest order',
    lines[0] === ANALYSIS_COLUMNS.map((c) => c.key).join(','));
  const parsed = parseCsv(csv);
  const ids = parsed.slice(1).map((r) => r[1]);
  check('rows sorted by tradeId', ids.every((v, i) => i === 0 || ids[i - 1] <= v));

  // Determinism
  const shuffled = [...rows].reverse();
  check('serialize(shuffled) byte-identical', serializeDataset(shuffled) === csv);

  // No forbidden literal cells
  const cells = parsed.flat();
  check('no "undefined"/"null"/"NaN" literal cells',
    !cells.some((c) => c === 'undefined' || c === 'null' || c === 'NaN'));

  // Round-trip — coerce via COLUMN_TYPES like the FE will
  const header = parsed[0];
  const back = parsed.slice(1).map((r) =>
    Object.fromEntries(
      header.map((k, i) => {
        const raw = r[i] ?? '';
        const kind = COLUMN_TYPES[k as keyof TradeAnalysisRow & string];
        return [k, raw === '' ? null : kind === 'number' ? Number(raw) : raw];
      }),
    ),
  );
  check('round-trip deep-equals projected rows',
    JSON.stringify(back) === JSON.stringify(rows),
    `${back.length} rows`);

  console.log(`\n${failed === 0 ? '=== ALL CHECKS PASSED' : `=== ${failed}/${checks} FAILED`} ===`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error('verify-1074 crashed:', err);
  process.exit(1);
});
