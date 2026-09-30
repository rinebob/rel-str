/**
 * @topic #553 — Paper Trading Infra (task #667 — live-quote close)
 *
 * Verifies closePaperTrade against the REAL (prod) Firestore + real RH MCP
 * quotes — a full open→close round trip on a scratch equity trade:
 *
 *   1. applyEntryFill → OPEN trade (1 share QQQM, verify-667 ids)
 *   2. wrong-user close → permission-denied (before any quote call)
 *   3. handleClosePaperTrade (prod deps, real MCP) → CLOSED at live quote
 *   4. read-back → exit fill price = quote, governing run EXITED + exitEvent
 *   5. re-close → failed-precondition
 *   6. cleanup → verification docs deleted
 *
 * Usage (from functions/ dir):
 *   npx tsx scripts/verify/paper-trading-close-667.ts
 *
 * Requires ADC + a working RH MCP session (local OAuth — same as the 564
 * verify). Firestore project: rel-str.
 *
 * PASS: every CHECK prints OK and the script exits 0, docs cleaned up.
 * FAIL: a CHECK prints FAIL with detail; exit 1; cleanup still attempted.
 */

import type { Firestore } from 'firebase-admin/firestore';
import { HttpsError } from 'firebase-functions/v2/https';

import { db } from '../../src/firebase-admin-init';
import { TradeSide } from '../../../shared/common';
import {
  PaperTradeSource,
  PaperTradeStatus,
  DEFAULT_TRAILING_STOP_KEY,
  type PaperTrade,
} from '../../../shared/paper-trading-contracts';
import { OptionQuoteSource } from '../../../shared/options-common';
import { executeObservationTool } from '../../src/rh-agent-mcp/tools/robinhood-tool-executor';
import { handleClosePaperTrade } from '../../src/paper-trading/callables';
import { applyEntryFill, applyExitFill } from '../../src/paper-trading/ledger';
import {
  getTrade,
  ledgerDeps,
  updateVariantRun,
} from '../../src/paper-trading/repository';
import { RobinhoodMcpOptionQuoteProvider } from '../../src/paper-trading/engine/quote-providers/rh-mcp-option-quote-provider';

const USER_ID = 'verify-667';
const ACCOUNT_ID = 'acct-verify-667';
const TRADE_ID = `verify-667-QQQM-EQ-${Date.now()}`;
const SYMBOL = 'QQQM';

let passed = 0;
let failed = 0;
function check(name: string, cond: boolean, detail?: unknown) {
  if (cond) { passed++; console.log(`OK   ${name}`); }
  else { failed++; console.log(`FAIL ${name}`, detail ?? ''); }
}

async function cleanup(db: Firestore): Promise<void> {
  await db.doc(`paper-trading/trades/items/${TRADE_ID}`).delete().catch(() => undefined);
  await db.doc(`paper-trading/accounts/items/${ACCOUNT_ID}`).delete().catch(() => undefined);
}

async function main(): Promise<void> {
  const deps = ledgerDeps(db);
  const callTool = async (name: string, args: Record<string, unknown>) => {
    const res = await executeObservationTool(name, args);
    if (!('success' in res) || !res.success) {
      throw new Error(`MCP ${name} failed: ${'error' in res ? res.error : 'unknown'}`);
    }
    return (res as { parsed?: unknown }).parsed ?? {};
  };
  const optionQuotes = new RobinhoodMcpOptionQuoteProvider({ callTool });
  const handlerDeps = {
    getTrade: (id: string) => getTrade(db, id),
    getOptionQuotes: (ids: string[], side: TradeSide) => optionQuotes.getQuotes(ids, side),
    callTool,
    applyExitFill: (input: Parameters<typeof applyExitFill>[0]) => applyExitFill(input, deps),
    updateRun: (tradeId: string, run: Parameters<typeof updateVariantRun>[2]) =>
      updateVariantRun(db, tradeId, run, new Date().toISOString()),
    now: () => new Date(),
  };

  await cleanup(db);

  // 1. Open a scratch equity trade (1 share — minimal cash footprint).
  const entry = await applyEntryFill(
    {
      userId: USER_ID,
      tradeId: TRADE_ID,
      order: { side: TradeSide.LONG, type: 'MARKET', quantity: 1 },
      legs: [
        { kind: 'share', side: TradeSide.LONG, quantity: 1, multiplier: 1, entryMark: 1, lastMark: 1 },
      ],
      fill: {
        fillId: `entry-${TRADE_ID}`,
        role: 'entry',
        date: '2026-09-28',
        price: 1, // scratch fill — the close carries the real quote
        quantity: 1,
        quoteSource: OptionQuoteSource.RH_MCP,
      },
      dims: {
        source: PaperTradeSource.SIGNAL,
        symbol: SYMBOL,
        expression: 'EQ',
        governingVariant: DEFAULT_TRAILING_STOP_KEY,
        variantKeys: [DEFAULT_TRAILING_STOP_KEY],
      },
      now: new Date().toISOString(),
    },
    deps,
  );
  check('scratch trade OPEN', entry.trade.status === PaperTradeStatus.OPEN, entry.trade.status);

  // 2. Wrong-user close → permission-denied.
  try {
    await handleClosePaperTrade(
      { auth: { uid: 'someone-else' }, data: { tradeId: TRADE_ID } },
      handlerDeps,
    );
    check('wrong-user close rejected', false, 'no error thrown');
  } catch (err) {
    check(
      'wrong-user close rejected (permission-denied)',
      err instanceof HttpsError && err.code === 'permission-denied',
      err,
    );
  }

  // 3. Happy-path close at the live quote.
  const res = await handleClosePaperTrade(
    { auth: { uid: USER_ID }, data: { tradeId: TRADE_ID } },
    handlerDeps,
  );
  check('close returns trade id + price', res.tradeId === TRADE_ID && res.exitPrice > 0, res);
  console.log(`     live quote: ${res.exitPrice}  pnl: ${res.realizedPnl}`);

  // 4. Read-back: CLOSED, exit fill recorded, governing run finalized.
  const after = (await getTrade(db, TRADE_ID)) as PaperTrade;
  check('trade CLOSED', after.status === PaperTradeStatus.CLOSED, after.status);
  const exitFill = after.fills.find((f) => f.role === 'exit');
  check('exit fill at the live quote', !!exitFill && exitFill.price === res.exitPrice, exitFill);
  const gov = after.variantRuns.find((r) => r.governing);
  check(
    'governing run EXITED with exitEvent',
    !!gov && gov.state === 'EXITED' && !!gov.exitEvent && gov.exitEvent.price === res.exitPrice,
    gov,
  );

  // 5. Re-close → failed-precondition.
  try {
    await handleClosePaperTrade(
      { auth: { uid: USER_ID }, data: { tradeId: TRADE_ID } },
      handlerDeps,
    );
    check('re-close rejected', false, 'no error thrown');
  } catch (err) {
    check(
      're-close rejected (failed-precondition)',
      err instanceof HttpsError && err.code === 'failed-precondition',
      err,
    );
  }
}

main()
  .catch((err) => { failed++; console.log('FAIL unhandled', err); })
  .finally(async () => {
    try {
      await cleanup(db);
      console.log('cleanup: docs removed');
    } catch (e) {
      console.log('cleanup failed (non-fatal):', e);
    }
    console.log(`\n${passed} passed, ${failed} failed`);
    process.exit(failed > 0 ? 1 : 0);
  });
