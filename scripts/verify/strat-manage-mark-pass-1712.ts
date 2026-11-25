/**
 * Verification: unified position-grain mark pass (task #1712).
 *
 * Exercises the REAL pass end-to-end with only I/O faked at the declared
 * seams (`listOpenOptionTrades`, `quoteProvider`, `markPositionLegs`) —
 * selection (`isOpenOptionPosition`), per-leg side-grouped quoting, signed
 * netMark → currentValue/unrealizedPnl via shared/options-position-math,
 * the order-exit-price `marks[date]` convention, the raw-quote write shape,
 * and per-position error isolation all run through production code.
 * Also pins `tradeToPosition`'s signed `currentValue` and the
 * `runUnifiedMarkPass` orchestrator wiring.
 *
 * Importing the modules runs `firebase-admin-init` (parameterless
 * `initializeApp()` — no credentials needed; no Firestore call is made).
 *
 * Usage: npx tsx scripts/verify/strat-manage-mark-pass-1712.ts
 *
 * Pass: every check prints OK and the script exits 0.
 * Fail: the offending check prints FAIL with detail; exit 1.
 */

import { runMarkPass } from '../../functions/src/paper-trading/engine/passes/mark-pass';
import type { BatchQuoteProvider } from '../../functions/src/paper-trading/engine/passes/mark-pass';
import { runUnifiedMarkPass } from '../../functions/src/paper-trading/engine/options-strategy-pass-orchestrators';
import { tradeToPosition } from '../../functions/src/paper-trading/engine/trade-adapter';
import type {
  PositionMarkUpdate,
  RawQuote,
} from '../../functions/src/paper-trading/engine/types';
import { getMarketDatePT } from '../../functions/src/common/pt-date-utils';
import { OptionType, OptionQuoteSource } from '@options/common';
import { TradeSide } from '@common';
import {
  PaperTradingKind,
  PaperTradeSource,
  PaperTradeStatus,
} from '@paper-trading/contracts';
import type {
  PaperTrade,
  PaperTradeLeg,
} from '@paper-trading/contracts';
import type { OptionQuote } from '@options-strategy-engine/contracts';

let failures = 0;
function check(name: string, actual: unknown, expected: unknown): void {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  console.log(`${ok ? 'OK  ' : 'FAIL'} ${name}: ${JSON.stringify(actual)}`);
  if (!ok) {
    console.log(`     expected: ${JSON.stringify(expected)}`);
    failures++;
  }
}
function near(a: number, b: number): boolean {
  return Math.abs(a - b) < 1e-9;
}
function checkNear(name: string, actual: number, expected: number): void {
  const ok = near(actual, expected);
  console.log(`${ok ? 'OK  ' : 'FAIL'} ${name}: ${actual}`);
  if (!ok) {
    console.log(`     expected ~${expected}`);
    failures++;
  }
}

// ── Fixtures ────────────────────────────────────────────────────────────

function optionLeg(
  overrides: Partial<Extract<PaperTradeLeg, { kind: 'option' }>> = {},
): PaperTradeLeg {
  return {
    kind: 'option',
    id: 'leg-1',
    contractID: 'SPY250817P00100000',
    type: OptionType.PUT,
    side: TradeSide.SHORT,
    strike: 100,
    expiration: '2025-08-17',
    quantity: 1,
    multiplier: 100,
    entryMark: 0.5,
    lastMark: 0.5,
    openDate: '2025-08-15',
    ...overrides,
  };
}

function shareLeg(
  overrides: Partial<Extract<PaperTradeLeg, { kind: 'share' }>> = {},
): PaperTradeLeg {
  return {
    kind: 'share',
    id: 'shares',
    side: TradeSide.LONG,
    quantity: 100,
    multiplier: 1,
    entryMark: 100,
    lastMark: 102,
    openDate: '2025-08-15',
    ...overrides,
  };
}

function trade(overrides: Partial<PaperTrade> = {}): PaperTrade {
  return {
    kind: PaperTradingKind.TRADE,
    id: 'trade-1',
    status: PaperTradeStatus.OPEN,
    source: PaperTradeSource.STRATEGY,
    symbol: 'SPY',
    expression: 'CSP',
    governingVariant: 'trailing-8',
    strategyInstanceId: 'inst-1',
    order: { side: TradeSide.SHORT, type: 'MARKET', quantity: 1 },
    fills: [],
    legs: [optionLeg()],
    marks: {},
    variantRuns: [],
    variantKeys: [],
    realizedPnl: 0,
    unrealizedPnl: 0,
    createdAt: '2025-08-15T00:00:00Z',
    updatedAt: '2025-08-15T00:00:00Z',
    ...overrides,
  };
}

function quote(overrides: Partial<OptionQuote> = {}): OptionQuote {
  return {
    contractID: 'SPY250817P00100000',
    symbol: 'SPY',
    expiration: '2025-08-17',
    strike: 100,
    type: OptionType.PUT,
    side: TradeSide.SHORT,
    mark: 0.4,
    source: OptionQuoteSource.RH_MCP,
    asOf: '2025-08-15T18:00:00Z',
    ...overrides,
  };
}

interface Write {
  positionId: string;
  update: PositionMarkUpdate;
  rawQuote: RawQuote;
}

async function run(
  trades: PaperTrade[],
  provider: BatchQuoteProvider,
): Promise<{ result: Awaited<ReturnType<typeof runMarkPass>>; writes: Write[] }> {
  const writes: Write[] = [];
  const result = await runMarkPass({
    listOpenOptionTrades: async () => trades,
    quoteProvider: provider,
    markPositionLegs: async (positionId, update, rawQuote) => {
      writes.push({ positionId, update, rawQuote });
    },
  });
  return { result, writes };
}

const echoProvider = (
  quotes: OptionQuote[],
  calls?: { ids: string[]; side: TradeSide }[],
): BatchQuoteProvider => ({
  getQuotes: async (ids, side) => {
    calls?.push({ ids, side });
    return quotes.filter((q) => ids.includes(q.contractID));
  },
});

async function main(): Promise<void> {
  // ── Selection: messy corpus → only OPEN + option-leg trades mark ────────
  const csp = trade({ id: 'csp' });
  const stockOnly = trade({
    id: 'sig-stock',
    source: PaperTradeSource.SIGNAL,
    legs: [shareLeg()],
  });
  const closed = trade({
    id: 'closed',
    status: PaperTradeStatus.CLOSED,
    legs: [optionLeg()],
  });
  const sel = await run(
    [csp, stockOnly, closed],
    echoProvider([quote()]),
  );
  check(
    'selection marks only OPEN option trades',
    sel.result.positions.map((p) => p.positionId),
    ['csp'],
  );
  check('selection produced no errors', sel.result.errors.length, 0);

  // ── Single-leg SHORT — legacy parity (mark space + P&L) ─────────────────
  const s = sel.result.positions[0];
  checkNear('single-leg netMark (signed liquidation)', s.netMark, -40);
  checkNear('single-leg marks[] mark (exit price)', s.mark, 0.4);
  checkNear('single-leg unrealizedPnl', s.unrealizedPnl, 10);
  check('single-leg legMarks', sel.writes[0].update.legMarks, {
    SPY250817P00100000: 0.4,
  });
  check('raw-quote date is PT market date', sel.writes[0].rawQuote.date, getMarketDatePT());

  // ── Credit spread — each leg's own mark, signed net, premium + net ──────
  const bcs = trade({
    id: 'bcs',
    expression: 'BCS',
    legs: [
      optionLeg({ id: 's', contractID: 'S-ID', entryMark: 0.6 }),
      optionLeg({ id: 'l', contractID: 'L-ID', side: TradeSide.LONG, strike: 95, entryMark: 0.35 }),
    ],
  });
  const bcsQuotes = [
    quote({ contractID: 'S-ID', mark: 0.5 }),
    quote({ contractID: 'L-ID', side: TradeSide.LONG, mark: 0.3 }),
  ];
  const bcsRun = await run([bcs], echoProvider(bcsQuotes));
  const bcsPos = bcsRun.result.positions[0];
  checkNear('credit-spread netMark', bcsPos.netMark, -20);
  checkNear('credit-spread marks[] mark', bcsPos.mark, 0.2);
  checkNear('credit-spread unrealizedPnl', bcsPos.unrealizedPnl, 5);
  check('credit-spread per-leg marks', bcsRun.writes[0].update.legMarks, {
    'S-ID': 0.5,
    'L-ID': 0.3,
  });
  check(
    'raw quote carries all leg quotes',
    (bcsRun.writes[0].rawQuote.rawResponse as OptionQuote[]).map((q) => q.contractID).sort(),
    ['L-ID', 'S-ID'],
  );

  // ── Debit spread — positive netMark, positive exit-price mark ──────────
  const cds = trade({
    id: 'cds',
    expression: 'CDS',
    // A debit spread is a BUY — the order-level exit price is the proceeds
    // to sell (+0.40), signed by orderPriceForLiquidationValue.
    order: { side: TradeSide.LONG, type: 'MARKET', quantity: 1 },
    legs: [
      optionLeg({ id: 'l', contractID: 'L-C', type: OptionType.CALL, side: TradeSide.LONG, entryMark: 0.5 }),
      optionLeg({ id: 's', contractID: 'S-C', type: OptionType.CALL, strike: 105, entryMark: 0.25 }),
    ],
  });
  const cdsRun = await run(
    [cds],
    echoProvider([
      quote({ contractID: 'L-C', type: OptionType.CALL, side: TradeSide.LONG, mark: 0.7 }),
      quote({ contractID: 'S-C', type: OptionType.CALL, mark: 0.3 }),
    ]),
  );
  const cdsPos = cdsRun.result.positions[0];
  checkNear('debit-spread netMark', cdsPos.netMark, 40);
  checkNear('debit-spread marks[] mark', cdsPos.mark, 0.4);
  checkNear('debit-spread unrealizedPnl', cdsPos.unrealizedPnl, 15);

  // ── Side-grouped quoting — quotes carry their leg's side ───────────────
  const sideCalls: { ids: string[]; side: TradeSide }[] = [];
  await run([bcs], echoProvider(bcsQuotes, sideCalls));
  check(
    'side-grouped quote calls',
    sideCalls.map((c) => `${c.side}:${c.ids.join(',')}`).sort(),
    [`${TradeSide.LONG}:L-ID`, `${TradeSide.SHORT}:S-ID`],
  );

  // ── Mixed stock+option — share leg rides its stored mark ───────────────
  const cc = trade({
    id: 'cc',
    expression: 'CC',
    legs: [
      shareLeg({ entryMark: 100, lastMark: 102 }),
      optionLeg({
        id: 'call',
        contractID: 'CALL-ID',
        type: OptionType.CALL,
        side: TradeSide.SHORT,
        strike: 105,
        entryMark: 0.75,
      }),
    ],
  });
  const ccRun = await run(
    [cc],
    echoProvider([quote({ contractID: 'CALL-ID', type: OptionType.CALL, mark: 2.0 })]),
  );
  const ccPos = ccRun.result.positions[0];
  checkNear('covered-call netMark', ccPos.netMark, 10000);
  checkNear('covered-call unrealizedPnl', ccPos.unrealizedPnl, 75);
  check('only the option leg marked', ccRun.writes[0].update.legMarks, {
    'CALL-ID': 2.0,
  });

  // ── Per-position error isolation ────────────────────────────────────────
  const bad = trade({
    id: 'bad',
    legs: [optionLeg({ contractID: 'BAD-ID' })],
  });
  const good = trade({ id: 'good' });
  const iso = await run([bad, good], {
    getQuotes: async (ids) => {
      if (ids.includes('BAD-ID')) throw new Error('MCP exploded');
      return ids.map((id) => quote({ contractID: id }));
    },
  });
  check('isolation: good position still marks', iso.result.positions.map((p) => p.positionId), ['good']);
  check('isolation: one error recorded', iso.result.errors.length, 1);
  check('isolation: error names the position', iso.result.errors[0].positionId, 'bad');

  // ── Missing leg quote → whole-position error, no partial write ──────────
  const gapRun = await run([bcs], echoProvider([quote({ contractID: 'S-ID' })]));
  check('missing leg quote → error', gapRun.result.errors.length, 1);
  check('missing leg quote → error contractID', gapRun.result.errors[0].contractID, 'L-ID');
  check('missing leg quote → no write', gapRun.writes.length, 0);

  // ── Missing contractID → error, no write ────────────────────────────────
  const noId = await run(
    [trade({ id: 'noid', legs: [optionLeg({ contractID: '' })] })],
    echoProvider([]),
  );
  check('missing contractID → error', noId.result.errors.length, 1);
  check('missing contractID → no write', noId.writes.length, 0);

  // ── tradeToPosition: signed currentValue on the Position view ───────────
  const view = tradeToPosition(
    trade({
      legs: [
        optionLeg({ contractID: 'S-ID', lastMark: 0.5 }),
        optionLeg({ id: 'l', contractID: 'L-ID', side: TradeSide.LONG, strike: 95, lastMark: 0.3 }),
      ],
    }),
  );
  checkNear('Position.currentValue is signed netMark', view.currentValue, -20);

  // ── runUnifiedMarkPass: one sweep, summary shape, error capture ─────────
  const summary = await runUnifiedMarkPass(echoProvider([]), async (deps) => {
    if (!deps.quoteProvider) throw new Error('no provider');
    return {
      markedAt: new Date().toISOString(),
      positions: [
        { positionId: 'a', trade: trade({ id: 'a', strategyInstanceId: undefined }), contractIDs: ['X'], netMark: -40, mark: 0.4, unrealizedPnl: 10, interpolatedClose: false, asOf: 't' },
        { positionId: 'b', trade: trade({ id: 'b', strategyInstanceId: undefined }), contractIDs: ['Y'], netMark: 40, mark: -0.4, unrealizedPnl: 15, interpolatedClose: false, asOf: 't' },
      ],
      errors: [{ positionId: 'c', contractID: 'Z', error: 'e' }],
    };
  });
  // No strategyInstanceId on the fake trades → shadow-eval skips both
  // (evaluated 0, no fires, no eval errors) — marks still succeed.
  check('orchestrator summary', summary, { positions: 2, errors: 1, evaluated: 0, fires: 0, evalErrors: 0 });
  const failed = await runUnifiedMarkPass(echoProvider([]), async () => {
    throw new Error('firestore down');
  });
  check('orchestrator captures pass failure', failed, { error: 'firestore down' });

  console.log(failures === 0 ? '\nALL CHECKS PASSED' : `\n${failures} CHECK(S) FAILED`);
  process.exit(failures === 0 ? 0 : 1);
}

void main();
