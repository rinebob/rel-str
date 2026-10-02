/**
 * @topic #553 — Paper Trading Infra (task #724 — engine settlement parity)
 *
 * Verifies the engine `runSettlementPass` fix against REAL prod data:
 * strict `expiration === runDate` left trades OPEN forever when the
 * expiration night was skipped or the two trigger sites disagreed on the
 * date; and weekend/holiday expirations had no SDS bar on the date itself.
 *
 *   1. Seeds a scratch strategy instance + account + two OPEN
 *      strategy-source trades with expired far-OTM QQQM puts:
 *        a) expiration on a past TRADING day (missed-night retry path)
 *        b) expiration on a SATURDAY (walk-back to Friday's close)
 *   2. Runs the real `runSettlementPass` with `getUnderlyingCloseForDate`
 *      (the same reader the nightly orchestrator injects).
 *   3. Asserts: both trades settle EXPIRED, premium realized, governing
 *      run EXITED at 0, marks/leg outcomes dated to the OBSERVED close
 *      (expiration date for (a), prior Friday for (b)), account moved.
 *   4. Cleans up all scratch docs and verifies deletion.
 *
 * Usage (from functions/ dir):
 *   npx tsx scripts/verify/paper-trading-engine-settlement-724.ts
 *
 * Requires: ADC (rel-str). No RH MCP needed — the brokerage outcome
 * checker is optional and a far-OTM put expires worthless either way.
 */

import { db } from '../../src/firebase-admin-init';
import {
  OptionQuoteSource,
  OptionType,
  PositionSpreadType,
  StrategyFrequency,
  buildOccContractId,
} from '../../../shared/options-common';
import { TradeSide } from '../../../shared/common';
import {
  ExitPolicy,
  LifecycleState,
} from '../../../shared/options-strategy-engine-contracts';
import type { StrategyInstanceConfig } from '../../../shared/options-strategy-engine-contracts';
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
import { runSettlementPass } from '../../src/paper-trading/engine/passes/settlement-pass';
import { SHARES_PER_CONTRACT } from '../../src/paper-trading/engine/types';

const USER_ID = 'verify-724-user';
const INSTANCE_ID = 'verify-724-inst';
const ACCT_ID = buildAccountId(USER_ID);
const ID_MISSED = 'verify-724-missed'; // expiration on a past trading day
const ID_WEEKEND = 'verify-724-weekend'; // expiration on a Saturday
const EXPIRY_TRADING = '2026-09-29'; // Tuesday — SDS bar must exist
const EXPIRY_SATURDAY = '2026-09-26'; // Saturday — walks back to Fri 9-25
const EXPIRY_FRIDAY = '2026-09-25';
const ENTRY_PREMIUM = 2.0;

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

const CONFIG: StrategyInstanceConfig = {
  id: INSTANCE_ID,
  symbol: 'QQQM',
  optionType: OptionType.PUT,
  side: TradeSide.SHORT,
  dteMin: 20,
  dteMax: 45,
  targetDelta: 0.3,
  phases: [
    {
      spreadType: PositionSpreadType.CASH_SECURED_PUT,
      targetDelta: 0.3,
      dteMin: 20,
      dteMax: 45,
    },
  ],
  frequency: StrategyFrequency.DAILY,
  openTimePT: '12:00',
  exitPolicies: [{ policy: ExitPolicy.HOLD_TO_EXPIRATION }],
  lifecycleState: LifecycleState.ACTIVE,
  userId: USER_ID,
  createdAt: '2026-09-01T00:00:00Z',
  updatedAt: '2026-09-01T00:00:00Z',
};

function scratchTrade(id: string, expiration: string, strike: number): PaperTrade {
  return {
    kind: PaperTradingKind.TRADE,
    id,
    status: PaperTradeStatus.OPEN,
    userId: USER_ID,
    source: PaperTradeSource.STRATEGY,
    strategyInstanceId: INSTANCE_ID,
    symbol: 'QQQM',
    expression: 'CSP',
    governingVariant: 'trailing-8',
    order: { side: TradeSide.SHORT, type: 'MARKET', quantity: 1 },
    fills: [
      {
        fillId: 'entry-1',
        role: 'entry',
        date: '2026-09-01',
        price: ENTRY_PREMIUM,
        quantity: 1,
        quoteSource: OptionQuoteSource.RH_MCP,
      },
    ],
    legs: [
      {
        kind: 'option',
        id: `PUT-${strike}-${expiration}`,
        contractID: buildOccContractId('QQQM', expiration, OptionType.PUT, strike),
        type: OptionType.PUT,
        strike,
        expiration,
        openDate: '2026-09-01',
        side: TradeSide.SHORT,
        quantity: 1,
        multiplier: SHARES_PER_CONTRACT,
        entryMark: ENTRY_PREMIUM,
        lastMark: ENTRY_PREMIUM,
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
    createdAt: '2026-09-01T12:00:00Z',
    updatedAt: '2026-09-01T12:00:00Z',
  };
}

async function getTrade(id: string): Promise<PaperTrade | null> {
  const snap = await paperDocRef(db, PaperTradingKind.TRADE, id).get();
  return snap.exists
    ? ({ id: snap.id, ...(snap.data() as object) } as PaperTrade)
    : null;
}

async function cleanup(): Promise<void> {
  await paperDocRef(db, PaperTradingKind.TRADE, ID_MISSED).delete();
  await paperDocRef(db, PaperTradingKind.TRADE, ID_WEEKEND).delete();
  await paperDocRef(db, PaperTradingKind.INSTANCE, INSTANCE_ID).delete();
  await paperDocRef(db, PaperTradingKind.ACCOUNT, ACCT_ID).delete();
}

async function main(): Promise<void> {
  const tueClose = await getUnderlyingCloseForDate('QQQM', EXPIRY_TRADING);
  const friClose = await getUnderlyingCloseForDate('QQQM', EXPIRY_FRIDAY);
  check('SDS bar exists for the trading-day expiration', tueClose !== null, { EXPIRY_TRADING });
  check('SDS bar exists for the Friday walk-back date', friClose !== null, { EXPIRY_FRIDAY });
  check(
    'no SDS bar on the Saturday expiration (walk-back is exercised)',
    (await getUnderlyingCloseForDate('QQQM', EXPIRY_SATURDAY)) === null,
    { EXPIRY_SATURDAY },
  );
  if (tueClose === null || friClose === null) {
    await cleanup();
    return;
  }
  console.log(`  QQQM closes — ${EXPIRY_TRADING}: ${tueClose}, ${EXPIRY_FRIDAY}: ${friClose}`);

  const strike = Math.floor(Math.min(tueClose, friClose)) - 100; // far OTM
  const marketDate = getMarketDatePT();
  check(
    'run date is after both expirations (missed-night shape)',
    marketDate > EXPIRY_TRADING,
    { marketDate },
  );

  await cleanup(); // clear leftovers from a prior run
  const now = new Date().toISOString();
  await paperDocRef(db, PaperTradingKind.INSTANCE, INSTANCE_ID).set({
    kind: PaperTradingKind.INSTANCE,
    symbol: 'QQQM',
    lifecycleState: 'ACTIVE',
    userId: USER_ID,
    paperAccountId: ACCT_ID,
    governingVariant: 'trailing-8',
    createdAt: now,
    updatedAt: now,
  });
  // Honest account: entry premiums already posted (2 × $200 cash), open
  // shorts at mark 2.0 → equity = cash + liquidation = 0.
  const account: PaperAccount = {
    kind: PaperTradingKind.ACCOUNT,
    id: ACCT_ID,
    userId: USER_ID,
    cash: 400,
    equity: 0,
    realizedPnl: 0,
    openTradeCount: 2,
    createdAt: now,
    updatedAt: now,
  };
  await paperDocRef(db, PaperTradingKind.ACCOUNT, ACCT_ID).set(account);
  await paperDocRef(db, PaperTradingKind.TRADE, ID_MISSED).set(
    (({ id: _id, ...d }) => d)(scratchTrade(ID_MISSED, EXPIRY_TRADING, strike)),
  );
  await paperDocRef(db, PaperTradingKind.TRADE, ID_WEEKEND).set(
    (({ id: _id, ...d }) => d)(scratchTrade(ID_WEEKEND, EXPIRY_SATURDAY, strike)),
  );
  check('scratch instance + trades seeded',
    (await getTrade(ID_MISSED)) !== null && (await getTrade(ID_WEEKEND)) !== null);

  const result = await runSettlementPass(INSTANCE_ID, marketDate, CONFIG, {
    getUnderlyingClose: getUnderlyingCloseForDate,
  });
  console.log(
    `  settlement: settled=${result.settled.length} errors=${result.errors.length}`,
  );
  check('pass settled both scratch trades with no errors',
    result.settled.length === 2 && result.errors.length === 0, result.errors);

  // ── Missed-night trade: settled at the EXPIRATION-day close ──
  const missed = await getTrade(ID_MISSED);
  check('missed-night trade status EXPIRED', missed?.status === PaperTradeStatus.EXPIRED, missed?.status);
  check(
    'missed-night realizedPnl = +200 (full premium kept)',
    missed !== null && Math.abs(missed.realizedPnl - 200) < 1e-6,
    missed?.realizedPnl,
  );
  const missedLeg = missed?.legs[0];
  check(
    'missed-night leg closeDate = expiration date',
    missedLeg?.kind === 'option' && missedLeg.closeDate === EXPIRY_TRADING,
    missedLeg,
  );
  check(
    'missed-night mark dated at the expiration close',
    missed?.marks[EXPIRY_TRADING]?.underlyingClose === tueClose,
    missed?.marks,
  );
  const missedRun = missed?.variantRuns.find((r) => r.governing);
  check(
    'missed-night governing run EXITED at 0',
    missedRun?.state === 'EXITED' && missedRun.exitEvent?.price === 0,
    missedRun,
  );

  // ── Weekend trade: walked back to Friday's close ──
  const weekend = await getTrade(ID_WEEKEND);
  check('weekend-expiry trade status EXPIRED', weekend?.status === PaperTradeStatus.EXPIRED, weekend?.status);
  const weekendLeg = weekend?.legs[0];
  check(
    'weekend-expiry leg closeDate = prior Friday (observed close)',
    weekendLeg?.kind === 'option' && weekendLeg.closeDate === EXPIRY_FRIDAY,
    weekendLeg,
  );
  check(
    'weekend-expiry mark carries Friday close',
    weekend?.marks[EXPIRY_FRIDAY]?.underlyingClose === friClose,
    weekend?.marks,
  );

  // ── Account bookkeeping ──
  const acctSnap = await paperDocRef(db, PaperTradingKind.ACCOUNT, ACCT_ID).get();
  const acct = acctSnap.exists ? (acctSnap.data() as PaperAccount) : null;
  check('account doc exists', acct !== null);
  if (acct) {
    check(
      'account realizedPnl = +400 (both premiums kept)',
      Math.abs(acct.realizedPnl - 400) < 1e-6,
      acct.realizedPnl,
    );
    check('account openTradeCount back to 0', acct.openTradeCount === 0, acct.openTradeCount);
  }

  // ── No longer in the OPEN strategy population ──
  const stillOpen = await paperItemsRef(db, PaperTradingKind.TRADE)
    .where('status', '==', PaperTradeStatus.OPEN)
    .where('source', '==', PaperTradeSource.STRATEGY)
    .get();
  const leaked = stillOpen.docs.filter((d) => d.id.startsWith('verify-724'));
  check('settled trades left the OPEN strategy population', leaked.length === 0, leaked.map((d) => d.id));

  await cleanup();
  // Verify deletion — survivors are loud, not silent.
  const survivors = [
    (await getTrade(ID_MISSED)) !== null,
    (await getTrade(ID_WEEKEND)) !== null,
    (await paperDocRef(db, PaperTradingKind.INSTANCE, INSTANCE_ID).get()).exists,
    (await paperDocRef(db, PaperTradingKind.ACCOUNT, ACCT_ID).get()).exists,
  ];
  check('cleanup removed all scratch docs', survivors.every((s) => !s));
}

main()
  .catch((err) => {
    console.error('FATAL', err);
    failed++;
  })
  .finally(async () => {
    await cleanup().catch(() => undefined); // belt-and-suspenders
    console.log(`\n${passed} passed, ${failed} failed`);
    process.exit(failed === 0 ? 0 : 1);
  });
