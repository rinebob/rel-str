/**
 * @topic #553 — Paper Trading Infra (task #1575)
 *
 * Verification for the curated signal mint: `backfillSignalTrade` +
 * `generatePaperSignalTrades`. Fixture mints run the REAL ledger
 * (applyEntryFill/applyExitFill) over an in-memory txn store — the walk,
 * the single backfill commit, and the ledger close are checked end to
 * end. Static checks pin the seams the FE contract rides on.
 *
 * Read-only, no env.
 *
 * Run: npx tsx scripts/verify/paper-trading-backfill-signal-trade-1575.ts
 */

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
import { TradeSide } from '../../../shared/common';
import { OptionQuoteSource } from '../../../shared/options-common';
import {
  CURATED_GOVERNING_POLICY,
  CURATED_VARIANT_KEYS,
  GENERATE_PAPER_SIGNAL_TRADES_MAX_ITEMS,
  PaperTradeStatus,
  type PaperAccount,
  type PaperTrade,
  type SignalPick,
} from '../../../shared/paper-trading-contracts';
import {
  buildAccountId,
  buildTradeId,
  signalDedupeKey,
  signalTradeDesc,
} from '../../../shared/paper-trading-ids';
import type { StSignal } from '../../../shared/st-signals';
import type { OhlcBar } from '../../src/common/market-data-types';
import {
  applyEntryFill,
  applyExitFill,
} from '../../src/paper-trading/ledger';
import type { CommitBackfilledTradeUpdate } from '../../src/paper-trading/repository';
import { backfillSignalTrade } from '../../src/paper-trading/passes/backfill-signal-trade';
import { handleGeneratePaperSignalTrades } from '../../src/paper-trading/signal-trade-callables';

let passed = 0;
let failed = 0;
function check(name: string, cond: boolean, detail = ''): void {
  if (cond) { passed++; console.log(`  ✓ ${name}`); }
  else { failed++; console.log(`  ✗ ${name} ${detail}`); }
}
function eq(name: string, actual: unknown, expected: unknown): void {
  check(name, actual === expected, `(got ${String(actual)}, want ${String(expected)})`);
}
function contains(name: string, file: string, needle: string): void {
  const src = readFileSync(resolve(__dirname, '../..', file), 'utf-8');
  check(name, src.includes(needle), `— '${needle}' not in ${file}`);
}

const SYM = 'QQQM';
const BAR_DATE = '2026-01-05';
const SIG_TYPE = 'D_ST_TREND_RIDER_V2_LONG';
const PICK: SignalPick = { symbol: SYM, signalBarDate: BAR_DATE, signalType: SIG_TYPE };
const bar = (d: string, c: number): OhlcBar => ({ d, o: c, h: c, l: c, c });

const SIGNAL: StSignal = {
  symbol: SYM,
  signalType: SIG_TYPE,
  barDate: BAR_DATE,
  marketDate: BAR_DATE,
  direction: TradeSide.LONG,
  timeframe: 'D' as StSignal['timeframe'],
  indicators: { zoneV1: 3 },
  status: 'CONFIRMED' as StSignal['status'],
  sourceRunId: 'run-1',
  runIds: ['run-1'],
  ticketIds: [],
  positionGroupIds: [],
  createdAt: 't',
  updatedAt: 't',
};

function makeDeps(bars: OhlcBar[], signal: StSignal | null = SIGNAL) {
  const trades = new Map<string, PaperTrade>();
  const accounts = new Map<string, PaperAccount>();
  const commits: unknown[] = [];
  const txn = {
    getTrade: async (id: string) => trades.get(id) ?? null,
    getAccount: async (uid: string) => accounts.get(buildAccountId(uid)) ?? null,
    write: async (p: { accountId: string; account: PaperAccount; tradeId: string; trade: PaperTrade }) => {
      accounts.set(p.accountId, p.account);
      trades.set(p.tradeId, p.trade);
    },
  };
  const ledger = { transact: async <T>(cb: (t: typeof txn) => Promise<T>) => cb(txn) };
  return {
    trades,
    commits,
    deps: {
      getSignal: async () => signal,
      getBars: async () => bars,
      getTrade: async (id: string) => trades.get(id) ?? null,
      applyEntryFill: (input: Parameters<typeof applyEntryFill>[0]) => applyEntryFill(input, ledger),
      applyExitFill: (input: Parameters<typeof applyExitFill>[0]) => applyExitFill(input, ledger),
      commitBackfill: async (tradeId: string, update: CommitBackfilledTradeUpdate) => {
        commits.push(update);
        trades.set(tradeId, { ...trades.get(tradeId)!, ...update });
      },
      now: () => new Date('2026-02-01T12:00:00Z'),
    },
  };
}

async function main(): Promise<void> {
  console.log('── static seams ──');
  contains('FillDimensions.governingPolicy', 'src/paper-trading/ledger.ts', 'governingPolicy?: GoverningPolicy');
  contains('commitBackfilledTrade seam', 'src/paper-trading/repository.ts', 'commitBackfilledTrade');
  contains('callable registered', 'src/index.ts', "from './paper-trading/signal-trade-callables'");
  contains('SDS_BARS entry provenance', 'src/paper-trading/passes/backfill-signal-trade.ts', 'OptionQuoteSource.SDS_BARS');
  contains('pick ticket auto:false', 'src/paper-trading/passes/backfill-signal-trade.ts', 'auto: false');
  contains('spec registered', 'package.json', 'backfill-signal-trade.test.ts');
  eq('batch cap', GENERATE_PAPER_SIGNAL_TRADES_MAX_ITEMS, 50);
  eq('curated set size', CURATED_VARIANT_KEYS.length, 7);

  console.log('── mint: target close, marks backfilled, one commit ──');
  {
    const bars = [
      ...Array.from({ length: 30 }, (_, i) => bar(`2025-12-${String(i + 1).padStart(2, '0')}`, 100)),
      bar(BAR_DATE, 100),
      bar('2026-01-06', 110),
      bar('2026-01-07', 130),
      bar('2026-01-08', 155), // target-50 fires
      bar('2026-01-09', 160),
    ];
    const { deps, trades, commits } = makeDeps(bars);
    const res = await backfillSignalTrade(PICK, deps);
    eq('status created', res.status, 'created');
    eq('signalId', res.signalId, signalDedupeKey(SYM, SIG_TYPE, BAR_DATE));
    const tid = res.tradeId!;
    eq('deterministic tradeId', tid, buildTradeId(new Date(`${BAR_DATE}T12:00:00Z`), 'sig', SYM, signalTradeDesc(SIG_TYPE)));
    const t = trades.get(tid)!;
    eq('policy marker on doc', t.governingPolicy, CURATED_GOVERNING_POLICY);
    eq('status CLOSED', t.status, PaperTradeStatus.CLOSED);
    eq('mirror names closer', t.governingVariant, 'target-50');
    const entry = t.fills.find((f) => f.role === 'entry')!;
    eq('entry at signal-bar close', entry.price, 100);
    eq('entry SDS_BARS', entry.quoteSource, OptionQuoteSource.SDS_BARS);
    check('no rawQuoteRef on stored-bar fill', entry.rawQuoteRef === undefined);
    const exit = t.fills.find((f) => f.role === 'exit')!;
    eq('exit at firing bar', exit.price, 155);
    eq('exit date', exit.date, '2026-01-08');
    eq('exit SDS_BARS', exit.quoteSource, OptionQuoteSource.SDS_BARS);
    eq('one backfill commit', commits.length, 1);
    check('marks end at the firing bar', t.marks['2026-01-09'] === undefined);
    check('post-entry marks landed', t.marks['2026-01-06']?.mark === 110 && t.marks['2026-01-08']?.mark === 155);
    const target = t.variantRuns.find((r) => r.variantKey === 'target-50')!;
    eq('closing run EXITED', target.state, 'EXITED');
    eq('exitEvent price', target.exitEvent?.price, 155);
    check('all curated runs seeded', t.variantRuns.length === CURATED_VARIANT_KEYS.length);
    eq('realizedPnl', t.realizedPnl, 55);
  }

  console.log('── mint: dedupe, error paths ──');
  {
    const bars = [bar(BAR_DATE, 100), bar('2026-01-06', 101)];
    const { deps } = makeDeps(bars);
    await backfillSignalTrade(PICK, deps);
    eq('re-mint dedupes', (await backfillSignalTrade(PICK, deps)).status, 'deduped');
  }
  {
    const { deps } = makeDeps([bar(BAR_DATE, 100)], null);
    const res = await backfillSignalTrade(PICK, deps);
    eq('missing signal doc → error', res.status, 'error');
  }
  {
    const { deps } = makeDeps([bar('2026-01-04', 99)]);
    const res = await backfillSignalTrade(PICK, deps);
    eq('missing signal bar → error', res.status, 'error');
  }

  console.log('── callable: auth + validation ──');
  {
    const deps = { mint: async () => ({ signalId: 'x', status: 'created' as const }), getBars: async () => [] as OhlcBar[] };
    let code = '';
    try {
      await handleGeneratePaperSignalTrades({ data: { items: [PICK] } }, deps);
    } catch (e) { code = (e as { code?: string }).code ?? ''; }
    eq('unauthenticated', code, 'unauthenticated');
    code = '';
    try {
      await handleGeneratePaperSignalTrades(
        { data: { items: Array.from({ length: 51 }, () => PICK) }, auth: { uid: 'u' } },
        deps,
      );
    } catch (e) { code = (e as { code?: string }).code ?? ''; }
    eq('over-cap invalid-argument', code, 'invalid-argument');
  }

  console.log(failed === 0 ? `\nAll ${passed} checks passed.` : `\n${failed} check(s) FAILED (${passed} passed).`);
  process.exit(failed === 0 ? 0 : 1);
}

void main();
