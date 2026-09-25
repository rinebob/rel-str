/**
 * @topic #553 — Paper Trading Infra (task #561 — Ledger core)
 *
 * Verifies the paper-trading ledger seam and repository against the REAL
 * (prod) Firestore — no emulator. Runs a complete fill lifecycle:
 *
 *   1. applyEntryFill  → trade doc + account doc written atomically
 *   2. repository read-back (getTrade / getAccount / listTrades)
 *   3. appendMark      → marks map entry lands
 *   4. applyExitFill   → trade CLOSED, realized P&L, cash delta applied
 *   5. resolveTradeId  → collision suffix behavior (live doc exists)
 *   6. cleanup         → all verification docs deleted
 *
 * Test docs use `verify-561-` ids / the `acct-verify-561` account and are
 * deleted in a finally block, so the script is safe to re-run.
 *
 * Usage (from functions/ dir):
 *   npx tsx scripts/verify/paper-trading-ledger-561.ts
 *
 * Requires Application Default Credentials (`gcloud auth application-default
 * login` or GOOGLE_APPLICATION_CREDENTIALS). Firestore project: rel-str.
 *
 * PASS: every CHECK prints OK and the script exits 0, docs cleaned up.
 * FAIL: a CHECK prints FAIL with detail; exit 1; cleanup still attempted.
 *
 * NOTE: this script lives under functions/scripts/verify/ (not the repo-root
 * scripts/verify/) because firebase-admin is a functions/ dependency.
 */

import { initializeApp, applicationDefault, getApp } from 'firebase-admin/app';
import { getFirestore, type Firestore } from 'firebase-admin/firestore';

import { TradeSide } from '../../../shared/common';
import { OptionQuoteSource, OptionType } from '../../../shared/options-common';
import { PaperTradeSource, PaperTradeStatus } from '../../../shared/paper-trading-contracts';
import { applyEntryFill, applyExitFill } from '../../src/paper-trading/ledger';
import {
  appendMark,
  getAccount,
  getTrade,
  ledgerDeps,
  listTrades,
  resolveTradeId,
} from '../../src/paper-trading/repository';

const USER_ID = 'verify-561';
const ACCOUNT_ID = 'acct-verify-561';
const BASE_TRADE_ID = 'verify-561-QQQM-CSP';
const PATH_TRADE = `paper-trading/trades/items/${BASE_TRADE_ID}`;
const PATH_ACCOUNT = `paper-trading/accounts/items/${ACCOUNT_ID}`;

let passed = 0;
let failed = 0;

function check(name: string, cond: boolean, detail?: unknown): void {
  if (cond) {
    passed++;
    console.log(`OK   ${name}`);
  } else {
    failed++;
    console.log(`FAIL ${name}`, detail ?? '');
  }
}

async function cleanup(db: Firestore): Promise<void> {
  await db.doc(PATH_TRADE).delete().catch(() => undefined);
  await db.doc(PATH_ACCOUNT).delete().catch(() => undefined);
}

async function main(): Promise<void> {
  const app = initializeApp({ credential: applicationDefault(), projectId: 'rel-str' });
  const db = getFirestore(app);
  const deps = ledgerDeps(db);

  await cleanup(db); // clean slate if a prior run left docs

  const entry = await applyEntryFill(
    {
      userId: USER_ID,
      tradeId: BASE_TRADE_ID,
      order: { side: TradeSide.SHORT, type: 'MARKET', quantity: 1 },
      legs: [
        {
          kind: 'option',
          contractID: 'QQQM251120P00570000',
          type: OptionType.PUT,
          strike: 570,
          expiration: '2026-11-20',
          side: TradeSide.SHORT,
          quantity: 1,
          multiplier: 100,
          entryMark: 2.1,
          lastMark: 2.1,
        },
      ],
      fill: {
        fillId: 'verify-f1',
        role: 'entry',
        date: '2026-09-25',
        price: 2.1,
        quantity: 1,
        quoteSource: OptionQuoteSource.RH_MCP,
      },
      dims: {
        source: PaperTradeSource.MANUAL,
        symbol: 'QQQM',
        expression: 'CSP',
        governingVariant: 'trailing-20',
        variantKeys: ['trailing-20', 'time-30d'],
      },
      underlyingClose: 600,
      now: '2026-09-25T19:00:00.000Z',
    },
    deps,
  );
  check('entry fill returned cash delta +210', entry.cashDelta === 210, entry.cashDelta);

  const account = await getAccount(db, ACCOUNT_ID);
  check('account doc created at accounts/items anchor', account !== null);
  check('account cash credited +210', account?.cash === 210, account?.cash);
  check('account equity flat at entry (cash→asset swap)', account?.equity === 0, account?.equity);
  check('account openTradeCount = 1', account?.openTradeCount === 1);

  const trade = await getTrade(db, BASE_TRADE_ID);
  check('trade doc created at trades/items anchor', trade !== null);
  check('trade status OPEN', trade?.status === PaperTradeStatus.OPEN);
  check('trade entry fill recorded', trade?.fills[0]?.price === 2.1);
  check('trade entry mark seeded', trade?.marks['2026-09-25']?.mark === 2.1);
  check('variantRuns seeded (1 governing + 1 shadow)', trade?.variantRuns.length === 2);

  const open = await listTrades(db, { status: PaperTradeStatus.OPEN, symbol: 'QQQM' });
  check('listTrades filter finds the open trade', open.some((t) => t.id === BASE_TRADE_ID));

  await appendMark(db, BASE_TRADE_ID, '2026-09-26', { mark: 1.8, underlyingClose: 602 }, '2026-09-26T20:00:00.000Z');
  const marked = await getTrade(db, BASE_TRADE_ID);
  check('appendMark lands marks.2026-09-26', marked?.marks['2026-09-26']?.mark === 1.8);

  const resolved = await resolveTradeId(db, BASE_TRADE_ID, '1200');
  check('resolveTradeId suffixes a taken id', resolved === `${BASE_TRADE_ID}-1200`, resolved);

  const exit = await applyExitFill(
    {
      userId: USER_ID,
      tradeId: BASE_TRADE_ID,
      fill: {
        fillId: 'verify-f2',
        role: 'exit',
        date: '2026-09-26',
        price: 0.5,
        quantity: 1,
        quoteSource: OptionQuoteSource.RH_MCP,
      },
      now: '2026-09-26T20:30:00.000Z',
    },
    deps,
  );
  check('exit fill cash delta -50 (buy-to-close)', exit.cashDelta === -50, exit.cashDelta);

  const closedAccount = await getAccount(db, ACCOUNT_ID);
  check('account cash after close = 160', closedAccount?.cash === 160, closedAccount?.cash);
  check('account realizedPnl = 160', closedAccount?.realizedPnl === 160);
  check('account openTradeCount back to 0', closedAccount?.openTradeCount === 0);

  const closedTrade = await getTrade(db, BASE_TRADE_ID);
  check('trade status CLOSED', closedTrade?.status === PaperTradeStatus.CLOSED);
  check('trade realizedPnl = 160', closedTrade?.realizedPnl === 160);
  check('trade has entry + exit fills', closedTrade?.fills.length === 2);
}

main()
  .catch((err) => {
    console.error('Fatal:', err);
    failed++;
  })
  .finally(async () => {
    try {
      await cleanup(getFirestore(getApp()));
      console.log('cleanup: verification docs removed');
    } catch {
      console.log('cleanup: skipped');
    }
    console.log(`\n=== ${passed} passed, ${failed} failed ===`);
    process.exit(failed > 0 ? 1 : 0);
  });
