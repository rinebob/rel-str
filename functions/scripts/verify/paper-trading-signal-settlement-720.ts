/**
 * @topic #553 — Paper Trading Infra (task #720 — signal-trade settlement)
 *
 * Verifies `runSignalSettlementPass` against REAL prod data:
 *
 *   1. Seeds two scratch OPEN signal trades with expired option legs on a
 *      real symbol (QQQM) — one far-OTM short put (worthless path), one
 *      ITM short put (intrinsic cash settlement path).
 *   2. Runs the real pass (SDS underlying close for the expiration date).
 *   3. Asserts: OTM → EXPIRED + full premium realized + governing run
 *      EXITED at 0; ITM → CLOSED + exit fill at intrinsic + governing run
 *      EXITED at intrinsic; account bookkeeping moved accordingly.
 *   4. Asserts the two trades no longer appear in the OPEN signal query.
 *   5. Cleans up all scratch docs and verifies deletion.
 *
 * Usage (from functions/ dir):
 *   npx tsx scripts/verify/paper-trading-signal-settlement-720.ts
 *
 * Requires: ADC (rel-str). No RH MCP needed — settlement resolves from
 * SDS daily bars, not live quotes.
 */

import { db } from '../../src/firebase-admin-init';
import { OptionQuoteSource, OptionType, buildOccContractId } from '../../../shared/options-common';
import { TradeSide } from '../../../shared/common';
import {
  PaperTradingKind,
  PaperTradeSource,
  PaperTradeStatus,
} from '../../../shared/paper-trading-contracts';
import type { PaperAccount, PaperTrade } from '../../../shared/paper-trading-contracts';
import { buildAccountId } from '../../../shared/paper-trading-ids';
import { paperDocRef, paperItemsRef } from '../../src/paper-trading/collections';
import { getMarketDatePT } from '../../src/common/pt-date-utils';
import { getUnderlyingCloseForDate } from '../../src/paper-trading/engine/options-strategy-market-data';
import {
  defaultSignalSettlementDeps,
  runSignalSettlementPass,
} from '../../src/paper-trading/passes/signal-settlement-pass';

const USER_ID = 'verify-720-user';
const EXPIRATION = '2026-09-29'; // past trading day — SDS bar must exist
const ID_OTM = 'verify-720-otm';
const ID_ITM = 'verify-720-itm';
const ACCT_ID = buildAccountId(USER_ID);

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

function scratchTrade(id: string, strike: number): PaperTrade {
  const now = new Date().toISOString();
  return {
    kind: PaperTradingKind.TRADE,
    id,
    status: PaperTradeStatus.OPEN,
    userId: USER_ID,
    source: PaperTradeSource.SIGNAL,
    symbol: 'QQQM',
    expression: 'CSP',
    governingVariant: 'trailing-8',
    order: { side: TradeSide.SHORT, type: 'MARKET', quantity: 1 },
    fills: [
      {
        fillId: 'entry-1',
        role: 'entry',
        date: '2026-09-15',
        price: 2.0,
        quantity: 1,
        quoteSource: OptionQuoteSource.RH_MCP,
      },
    ],
    legs: [
      {
        kind: 'option',
        contractID: buildOccContractId('QQQM', EXPIRATION, OptionType.PUT, strike),
        type: OptionType.PUT,
        strike,
        expiration: EXPIRATION,
        side: TradeSide.SHORT,
        quantity: 1,
        multiplier: 100,
        entryMark: 2.0,
        lastMark: 2.0,
      },
    ],
    marks: {},
    variantRuns: [
      {
        variantKey: 'trailing-8',
        governing: true,
        state: 'ACTIVE',
        workingState: {},
      },
    ],
    variantKeys: ['trailing-8'],
    realizedPnl: 0,
    unrealizedPnl: 0,
    createdAt: now,
    updatedAt: now,
  };
}

async function getTrade(id: string): Promise<PaperTrade | null> {
  const snap = await paperDocRef(db, PaperTradingKind.TRADE, id).get();
  return snap.exists
    ? ({ id: snap.id, ...(snap.data() as object) } as PaperTrade)
    : null;
}

async function cleanup(): Promise<void> {
  await paperDocRef(db, PaperTradingKind.TRADE, ID_OTM).delete();
  await paperDocRef(db, PaperTradingKind.TRADE, ID_ITM).delete();
  await paperDocRef(db, PaperTradingKind.ACCOUNT, ACCT_ID).delete();
}

async function main(): Promise<void> {
  const ulClose = await getUnderlyingCloseForDate('QQQM', EXPIRATION);
  check('SDS bar exists for expiration date', ulClose !== null, { EXPIRATION });
  if (ulClose === null) {
    await cleanup();
    return;
  }
  console.log(`  QQQM close on ${EXPIRATION}: ${ulClose}`);

  // OTM: put strike far below close. ITM: put strike far above close.
  const otmStrike = Math.floor(ulClose) - 100;
  const itmStrike = Math.ceil(ulClose) + 100;
  const intrinsic = itmStrike - ulClose;

  await cleanup(); // clear any leftovers from a prior run
  await paperDocRef(db, PaperTradingKind.TRADE, ID_OTM).set(
    (({ id: _id, ...d }) => d)(scratchTrade(ID_OTM, otmStrike)),
  );
  await paperDocRef(db, PaperTradingKind.TRADE, ID_ITM).set(
    (({ id: _id, ...d }) => d)(scratchTrade(ID_ITM, itmStrike)),
  );
  // Seed the account the honest way: real trades post entry bookkeeping via
  // applyEntryFill, so scratch seeds must start with an account that already
  // holds the two open positions — otherwise settle assertions lean on the
  // lazy create-on-exit path (and doc-id ordering).
  await paperDocRef(db, PaperTradingKind.ACCOUNT, ACCT_ID).set({
    kind: PaperTradingKind.ACCOUNT,
    id: ACCT_ID,
    userId: USER_ID,
    cash: 400, // two × $200 entry credits
    // Honest equity: cash minus the two open short liabilities marked 2.0.
    equity: 0,
    realizedPnl: 0,
    openTradeCount: 2,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });
  check('scratch trades seeded', (await getTrade(ID_OTM)) !== null && (await getTrade(ID_ITM)) !== null);

  const marketDate = getMarketDatePT();
  const summary = await runSignalSettlementPass(marketDate, defaultSignalSettlementDeps(db));
  console.log(
    `  pass summary: settled=${summary.settled} skipped=${summary.skipped} errors=${summary.errors.length}`,
  );
  // Scope the error-free assertion to the scratch trades — an unrelated
  // real signal trade erroring tonight isn't this verify's failure.
  const scratchErrors = summary.errors.filter((e) => e.tradeId.startsWith('verify-720'));
  check('pass ran with no errors on scratch trades', scratchErrors.length === 0, scratchErrors);
  console.log(`  (population errors: ${summary.errors.length})`);
  // >=, not ===: a real expired signal trade in prod would settle here too
  // (that's the pass doing its job, not a verify failure).
  check('both scratch trades settled', summary.settled >= 2);

  // ── OTM trade: EXPIRED, premium realized, governing run EXITED at 0 ──
  const otm = await getTrade(ID_OTM);
  check('OTM trade status EXPIRED', otm?.status === PaperTradeStatus.EXPIRED, otm?.status);
  check(
    'OTM realizedPnl = +200 (full premium kept)',
    otm !== null && Math.abs(otm.realizedPnl - 200) < 1e-6,
    otm?.realizedPnl,
  );
  const otmRun = otm?.variantRuns.find((r) => r.governing);
  check(
    'OTM governing run EXITED at 0',
    otmRun?.state === 'EXITED' && otmRun.exitEvent?.price === 0,
    otmRun,
  );

  // ── ITM trade: CLOSED at intrinsic, governing run EXITED ──
  const itm = await getTrade(ID_ITM);
  check('ITM trade status CLOSED', itm?.status === PaperTradeStatus.CLOSED, itm?.status);
  const exitFill = itm?.fills.find((f) => f.role === 'exit');
  check(
    'ITM exit fill at intrinsic',
    exitFill !== undefined && Math.abs(exitFill.price - intrinsic) < 1e-6,
    { exitPrice: exitFill?.price, intrinsic },
  );
  const itmRun = itm?.variantRuns.find((r) => r.governing);
  check(
    'ITM governing run EXITED at intrinsic',
    itmRun?.state === 'EXITED' && Math.abs((itmRun.exitEvent?.price ?? -1) - intrinsic) < 1e-6,
    itmRun,
  );

  // ── Account moved for both (verify-720-user account) ──
  const acctSnap = await paperDocRef(db, PaperTradingKind.ACCOUNT, ACCT_ID).get();
  const acct = acctSnap.exists ? (acctSnap.data() as PaperAccount) : null;
  check('account doc exists', acct !== null);
  if (acct) {
    // OTM: +200 premium realized. ITM: cash −(intrinsic×100), realized = 200 − intrinsic×100.
    const expectedPnl = 200 + (200 - intrinsic * 100);
    check(
      'account realizedPnl reflects both settlements',
      Math.abs(acct.realizedPnl - expectedPnl) < 1e-6,
      { realized: acct.realizedPnl, expected: expectedPnl },
    );
    check('account openTradeCount back to 0', acct.openTradeCount === 0, acct.openTradeCount);
  }

  // ── No longer in the OPEN signal population ──
  const stillOpen = await paperItemsRef(db, PaperTradingKind.TRADE)
    .where('status', '==', PaperTradeStatus.OPEN)
    .where('source', '==', PaperTradeSource.SIGNAL)
    .get();
  const leaked = stillOpen.docs.filter((d) => d.id.startsWith('verify-720'));
  check('settled trades left the OPEN signal population', leaked.length === 0, leaked.map((d) => d.id));

  await cleanup();
  // Verify deletion — survivors are loud, not silent.
  const survivors = [
    (await getTrade(ID_OTM)) !== null,
    (await getTrade(ID_ITM)) !== null,
    (await paperDocRef(db, PaperTradingKind.ACCOUNT, ACCT_ID).get()).exists,
  ];
  check('cleanup removed all scratch docs', survivors.every((s) => !s));
}

main()
  .catch(async (err) => {
    failed++;
    console.log('FAIL unhandled', err);
    await cleanup().catch(() => undefined);
  })
  .finally(() => {
    console.log(`\n${passed} passed, ${failed} failed`);
    process.exit(failed > 0 ? 1 : 0);
  });
