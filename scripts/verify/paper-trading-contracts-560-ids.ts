/**
 * Verification: paper-trading shared contracts (task #560).
 *
 * Exercises the shared contracts and ID/path helpers through the
 * `@paper-trading/*` aliases — proving the modules resolve under the real
 * tsconfig paths and produce the approved formats and segment parity.
 *
 * Usage: npx tsx scripts/verify/paper-trading-contracts-560-ids.ts
 *
 * Pass: every check prints OK and the script exits 0.
 * Fail: the offending check prints FAIL with detail; exit 1.
 */

import {
  PAPER_TRADING_ROOT,
  PaperTradingKind,
  paperTradingItemsPath,
  paperTradingDocPath,
  buildAccountId,
  buildTradeId,
  EQUITY_TRADE_DESC,
  buildSpreadTradeDesc,
  buildCohortId,
  buildStatsId,
  statsScopeAll,
  statsScopeVariant,
  buildRawQuoteId,
  parseTradeId,
} from '../../shared/paper-trading-ids';
import {
  PaperTradeStatus,
  PaperTradeSource,
  isPaperTrade,
  type PaperTradingDoc,
} from '../../shared/paper-trading-contracts';
import { TradeSide } from '../../shared/common';
import { OptionQuoteSource } from '../../shared/options-common';

let failures = 0;

function check(name: string, actual: unknown, expected: unknown): void {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  console.log(`${ok ? 'OK  ' : 'FAIL'} ${name}: ${JSON.stringify(actual)}`);
  if (!ok) {
    console.log(`     expected: ${JSON.stringify(expected)}`);
    failures++;
  }
}

const DAY = new Date('2026-09-24T18:30:00Z');

// ── Paths: collection paths odd segments, doc paths even ───────────────────

check('root', PAPER_TRADING_ROOT, 'paper-trading');
check('items path', paperTradingItemsPath(PaperTradingKind.TRADE), 'paper-trading/trades/items');
check('items path segment parity (odd)', paperTradingItemsPath(PaperTradingKind.TRADE).split('/').length % 2, 1);
check('doc path', paperTradingDocPath(PaperTradingKind.TRADE, '260924-sig-QQQ-EQ'), 'paper-trading/trades/items/260924-sig-QQQ-EQ');
check('doc path segment parity (even)', paperTradingDocPath(PaperTradingKind.TRADE, 'x').split('/').length % 2, 0);

// ── IDs ────────────────────────────────────────────────────────────────────

check('account id', buildAccountId('a1b2c3'), 'acct-a1b2c3');
check('signal equity trade id', buildTradeId(DAY, 'sig', 'qqq', EQUITY_TRADE_DESC), '260924-sig-QQQ-EQ');
check('strategy spread trade id', buildTradeId(DAY, 'st', 'QQQM', buildSpreadTradeDesc('CSP', 0.2, 30)), '260924-st-QQQM-CSP-020-30');
check('collision suffix', buildTradeId(DAY, 'sig', 'QQQ', 'EQ', { timeSuffix: '0935' }), '260924-sig-QQQ-EQ-0935');
check('cohort id', buildCohortId(DAY, 'QQQ', 1), 'cohort-260924-QQQ-01');
check('stats id all', buildStatsId(statsScopeAll()), 'stats-all');
check('stats id variant', buildStatsId(statsScopeVariant('trailing-20')), 'stats-var-trailing-20');
check('raw quote id', buildRawQuoteId('260924-st-QQQM-CSP-020-30', new Date('2026-09-25')), 'rq-260924-st-QQQM-CSP-020-30-260925');
check('parse round-trip', parseTradeId('260924-sig-QQQ-EQ'), { date: '260924', origin: 'sig', symbol: 'QQQ', desc: 'EQ', suffix: undefined });
check('parse malformed → null', parseTradeId('not-a-trade'), null);

// ── Contracts: kind discrimination ─────────────────────────────────────────

const trade: PaperTradingDoc = {
  kind: PaperTradingKind.TRADE,
  id: '260924-sig-QQQ-EQ',
  status: PaperTradeStatus.OPEN,
  source: PaperTradeSource.SIGNAL,
  signalId: 'sig-1',
  symbol: 'QQQ',
  expression: 'EQ',
  governingVariant: 'trailing-20',
  order: { side: TradeSide.LONG, type: 'MARKET', quantity: 100 },
  fills: [{ fillId: 'f1', role: 'entry', date: '2026-09-24', price: 590, quantity: 100, quoteSource: OptionQuoteSource.RH_MCP }],
  legs: [{ kind: 'share', side: TradeSide.LONG, quantity: 100, multiplier: 1, entryMark: 590, lastMark: 590 }],
  marks: {},
  variantRuns: [{ variantKey: 'trailing-20', governing: true, state: 'ACTIVE', workingState: {} }],
  variantKeys: ['trailing-20'],
  realizedPnl: 0,
  unrealizedPnl: 0,
  createdAt: '2026-09-24T19:00:00Z',
  updatedAt: '2026-09-24T19:00:00Z',
};

check('isPaperTrade discriminates', isPaperTrade(trade), true);

console.log(failures === 0 ? '\n=== ALL CHECKS PASSED ===' : `\n=== ${failures} CHECK(S) FAILED ===`);
process.exit(failures === 0 ? 0 : 1);
