/**
 * @topic #553 — Paper Trading Infra · Thread #1059 (task #1079)
 *
 * verify-1079: analysis-dataset end-to-end relay — live dry-run + AMAT
 * replay parity vs the validated prototype. READ-ONLY: both passes run
 * through injected collector `writeDataset` seams — no GCS object, no
 * index doc, no ledger write.
 *
 *   npx tsx scripts/verify/paper-trading-analysis-dataset.ts
 *
 * Part 1 — live snapshot dry-run (real `runLiveSnapshot` against prod):
 *   the whole ledger maps through the real pass into a collector:
 *   one row per trade, cohort split, closed/open split, and a
 *   per-column non-null sample.
 *
 * Part 2 — AMAT replay parity (real `runReplay`, real detector +
 *   exit registry): replays the prototype's bar window — bars
 *   >= 2023-01-01 feed warmup (the prototype sliced before compute)
 *   and barRange.to is frozen at 2026-10-16 so newly-appended SDS
 *   bars can't drift the check. Asserts against the checked-in
 *   prototype CSV (paper-trading-analysis-dataset-amat-prototype.csv):
 *   row count, closed count, %profitable, payoff, and an exact
 *   signal-set diff (signalBarDate|signalType both ways).
 *
 * Part 3 — informational: full-history AMAT replay (no warmup slice),
 *   same frozen `to`. Production-faithful semantic; printed only —
 *   the baseline drifts if SDS backfills older shards.
 *
 * Exits non-zero when any assertion fails.
 */

import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { db } from '../../src/firebase-admin-init';
import { listTrades } from '../../src/paper-trading/repository';
import { getCachedBarsFromSymbolData } from '../../src/st-cloud-function/data-loader';
import { detectAllStTrendRiderSignals } from '../../src/st-cloud-function/strategies/signal-detection';
import { evaluateVariant } from '../../src/paper-trading/exits/registry';
import { runLiveSnapshot } from '../../src/paper-trading/analysis/live-snapshot';
import { runReplay } from '../../src/paper-trading/analysis/replay';
import {
  AnalysisCohort,
  type AnalysisRunParams,
  type TradeAnalysisRow,
} from '@paper-trading/analysis';
import {
  isPaperTrade,
  PaperTradeStatus,
  type PaperTradingDoc,
} from '@paper-trading/contracts';
import {
  PaperTradingKind,
  paperTradingItemsPath,
} from '@paper-trading/ids';

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURE = 'paper-trading-analysis-dataset-amat-prototype.csv';
/** Frozen replay end — the max date the fixture references. Bars past
 *  this can't enter the walk, so appended SDS data can't drift the
 *  parity check. */
const FROZEN_TO = '2026-10-16';

const results: string[] = [];
const ok = (m: string) => { results.push(`  ✔ ${m}`); console.log(`  ✔ ${m}`); };
const fail = (m: string) => { results.push(`  ✖ ${m}`); console.log(`  ✖ ${m}`); };
const warns: string[] = [];
const warn = (m: string) => { warns.push(`  ⚠ ${m}`); console.log(`  ⚠ ${m}`); };

interface Agg { rows: number; closed: number; winrate: number; payoff: number }

function agg(rows: TradeAnalysisRow[]): Agg {
  const closed = rows.filter((r) => r.status === PaperTradeStatus.CLOSED);
  const wins = closed.filter((r) => (r.tradeRetPct ?? 0) > 0);
  const gains = wins.map((r) => r.tradeRetPct!);
  const losses = closed.filter((r) => (r.tradeRetPct ?? 0) <= 0).map((r) => r.tradeRetPct!);
  const payoff = (gains.reduce((a, b) => a + b, 0) / gains.length) /
    Math.abs(losses.reduce((a, b) => a + b, 0) / losses.length);
  return {
    rows: rows.length,
    closed: closed.length,
    winrate: (100 * wins.length) / closed.length,
    payoff,
  };
}

const fmt = (a: Agg) =>
  `rows=${a.rows} closed=${a.closed} winrate=${a.winrate.toFixed(1)}% payoff=${a.payoff.toFixed(2)}`;

// ── Part 1 — live snapshot dry-run ──────────────────────────────────────────

async function liveDryRun(): Promise<void> {
  console.log('── Part 1: live snapshot dry-run (real pass, collector writeDataset)\n');

  const rows: TradeAnalysisRow[] = [];
  let writeCalls = 0;
  let enumerated = 0;
  const params: AnalysisRunParams = {
    origin: 'live',
    symbolScope: [],
    signalTypes: [],
    exitRule: 'trailing-8',
    barRange: { from: '0000-01-01', to: '9999-12-31' },
    entryConvention: 'signal-bar-close',
  };
  const n = await runLiveSnapshot(params, 'verify-1079-dryrun', {
    // #1007 transitional: working-tree collections.ts routes TRADE to
    // `st-paper-trading/trades/items`, which stays empty until the
    // rename migration runs (deploy → migrate per its runbook). When the
    // canonical path enumerates zero, fall back to the legacy path so
    // the dry-run still exercises the real pass — flagged as a warn.
    // Self-healing: once canonical has docs the legacy read never fires.
    listTrades: async () => {
      const trades = await listTrades(db);
      if (trades.length > 0) { enumerated = trades.length; return trades; }
      const legacy = await db.collection(
        paperTradingItemsPath(PaperTradingKind.TRADE),
      ).get();
      warn(`canonical trades empty — #1007 migration pending; read ${legacy.size} docs from legacy path`);
      const fallback = legacy.docs
        .map((d) => ({ id: d.id, ...(d.data() as object) }) as PaperTradingDoc)
        .filter(isPaperTrade);
      enumerated = fallback.length;
      return fallback;
    },
    loadDailyBars: async (s, asOf) =>
      (await getCachedBarsFromSymbolData(s, asOf)).dailyBars,
    writeDataset: async (r) => { writeCalls++; rows.push(...r); },
  });

  // rows vs the independently-enumerated ledger count — comparing to the
  // pass's own return would be tautological and can't catch scope drops.
  if (rows.length === enumerated && enumerated > 0) {
    ok(`one row per trade — ${rows.length} rows (${enumerated} enumerated)`);
  } else {
    fail(`row count ${rows.length} != enumerated ledger ${enumerated} (pass returned ${n})`);
  }

  if (writeCalls === 1) ok('single final writeDataset call (collector — nothing persisted)');
  else fail(`writeDataset called ${writeCalls} times — expected 1`);

  const sig = rows.filter((r) => r.analysisCohort === AnalysisCohort.SIGNAL_EQUITY);
  const exc = rows.filter((r) => r.analysisCohort === AnalysisCohort.EXCLUDED);
  ok(`cohorts — ${sig.length} signal-equity, ${exc.length} excluded`);
  const closed = rows.filter((r) => r.status === PaperTradeStatus.CLOSED);
  ok(`lifecycle — ${closed.length} closed, ${rows.length - closed.length} open/other`);

  // Column sample — non-null counts across all emitted fields.
  console.log('\n  column non-null sample (of ' + rows.length + ' rows):');
  if (rows.length > 0) {
    const keys = Object.keys(rows[0]) as (keyof TradeAnalysisRow)[];
    for (const k of keys) {
      const nn = rows.filter((r) => r[k] !== null && r[k] !== undefined).length;
      console.log(`    ${String(k).padEnd(20)} ${nn}`);
    }
  }
}

// ── Part 2 — AMAT replay parity vs the prototype ────────────────────────────

interface Proto { stats: Agg; keys: Set<string> }

function loadPrototype(): Proto {
  const lines = readFileSync(resolve(__dirname, FIXTURE), 'utf-8').trim().split('\n');
  const head = lines[0].split(',');
  const iDate = head.indexOf('signalBarDate');
  const iType = head.indexOf('signalType');
  const iStatus = head.indexOf('status');
  const iRet = head.indexOf('tradeRetPct');
  const closed = lines.slice(1).filter((l) => l.split(',')[iStatus] === 'CLOSED');
  const wins = closed.filter((l) => Number(l.split(',')[iRet]) > 0)
    .map((l) => Number(l.split(',')[iRet]));
  const losses = closed.filter((l) => Number(l.split(',')[iRet]) <= 0)
    .map((l) => Number(l.split(',')[iRet]));
  return {
    stats: {
      rows: lines.length - 1,
      closed: closed.length,
      winrate: (100 * wins.length) / closed.length,
      payoff: (wins.reduce((a, b) => a + b, 0) / wins.length) /
        Math.abs(losses.reduce((a, b) => a + b, 0) / losses.length),
    },
    keys: new Set(lines.slice(1).map((l) => {
      const c = l.split(',');
      return `${c[iDate]}|${c[iType]}`;
    })),
  };
}

async function replayAmat(barsFrom: string, to: string, dsId: string): Promise<TradeAnalysisRow[]> {
  const rows: TradeAnalysisRow[] = [];
  const params: AnalysisRunParams = {
    origin: 'replay',
    symbolScope: ['AMAT'],
    signalTypes: [],
    exitRule: 'trailing-8',
    barRange: { from: barsFrom, to },
    entryConvention: 'signal-bar-close',
  };
  await runReplay(params, dsId, {
    listSymbols: async () => ['AMAT'],
    loadDailyBars: async (s) =>
      (await getCachedBarsFromSymbolData(s, '9999-12-31')).dailyBars
        .filter((b) => b.d >= barsFrom),
    detectSignals: detectAllStTrendRiderSignals,
    evaluateExit: evaluateVariant,
    writeDataset: async (r) => { rows.push(...r); },
  });
  return rows;
}

async function replayParity(): Promise<void> {
  console.log('\n── Part 2: AMAT replay parity (prototype window, frozen to 2026-10-16)\n');

  const proto = loadPrototype();
  const rows = await replayAmat('2023-01-01', FROZEN_TO, 'verify-1079-parity');
  const mine = agg(rows);

  console.log(`  expected (prototype CSV): ${fmt(proto.stats)}`);
  console.log(`  actual   (this replay)  : ${fmt(mine)}\n`);

  if (mine.rows === proto.stats.rows) ok(`row count — ${mine.rows}`);
  else fail(`row count ${mine.rows} != ${proto.stats.rows}`);
  if (mine.closed === proto.stats.closed) ok(`closed count — ${mine.closed}`);
  else fail(`closed count ${mine.closed} != ${proto.stats.closed}`);
  if (Math.abs(mine.winrate - proto.stats.winrate) <= 0.5) {
    ok(`%profitable — ${mine.winrate.toFixed(1)}% vs ${proto.stats.winrate.toFixed(1)}% (tol ±0.5pp)`);
  } else {
    fail(`%profitable ${mine.winrate.toFixed(1)}% != ${proto.stats.winrate.toFixed(1)}% (tol ±0.5pp)`);
  }
  if (Math.abs(mine.payoff - proto.stats.payoff) <= 0.02) {
    ok(`payoff — ${mine.payoff.toFixed(2)} vs ${proto.stats.payoff.toFixed(2)} (tol ±0.02)`);
  } else {
    fail(`payoff ${mine.payoff.toFixed(2)} != ${proto.stats.payoff.toFixed(2)} (tol ±0.02)`);
  }

  // Exact signal-set diff — catches signal churn the aggregates mask.
  const mineKeys = new Set(rows.map((r) => `${r.signalBarDate}|${r.signalType}`));
  const extra = [...mineKeys].filter((k) => !proto.keys.has(k)).sort();
  const missing = [...proto.keys].filter((k) => !mineKeys.has(k)).sort();
  if (extra.length === 0 && missing.length === 0) {
    ok(`signal set identical — ${mineKeys.size} signals, zero diff`);
  } else {
    for (const k of extra) console.log(`    + not in prototype: ${k}`);
    for (const k of missing) console.log(`    - missing vs prototype: ${k}`);
    fail(`signal-set diff — ${extra.length} extra, ${missing.length} missing`);
  }
}

// ── Part 3 — informational full-history baseline ────────────────────────────

async function fullHistoryBaseline(): Promise<void> {
  console.log('\n── Part 3: informational — full-history AMAT (no warmup slice, frozen to 2026-10-16)\n');
  const rows = await replayAmat('0000-01-01', FROZEN_TO, 'verify-1079-fullhist');
  console.log(`  full-history baseline: ${fmt(agg(rows))}`);
  console.log('  (not asserted — production-faithful semantic; drifts if SDS backfills older shards)');
}

async function main(): Promise<void> {
  console.log('verify-1079: analysis-dataset relay → real prod (read-only)\n');
  await liveDryRun();
  await replayParity();
  await fullHistoryBaseline();
  const failed = results.filter((r) => r.startsWith('  ✖')).length;
  const warnSuffix = warns.length > 0 ? ` (${warns.length} warn)` : '';
  console.log(
    failed === 0
      ? `\n=== ALL CHECKS PASSED${warnSuffix} ===`
      : `\n=== ${failed} CHECKS FAILED${warnSuffix} ===`,
  );
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
