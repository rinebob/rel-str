/**
 * @topic #137 — Strategy Manager (task #1714 — position-grain settlement
 *          + held-shares)
 *
 * Verifies the #1714 rewrite against REAL prod data with scratch docs:
 *   1. Seeds a scratch instance + account + four OPEN trades:
 *        a) ZOMBIE shape — expired far-OTM put, NO strategyInstanceId
 *           (the instance-grain loop could never reach these; the sweep
 *           must settle it)
 *        b) SIGNAL-source expired put — must be left untouched (disjoint
 *           from signalSettlementPass)
 *        c) 2-leg put spread, close between the strikes — short leg
 *           ASSIGNED (+shares at its strike), long leg EXPIRED_WORTHLESS
 *        d) expired far-OTM single put on the instance — EXPIRED
 *        e) fully-ITM put spread — BOTH legs assign, deliveries offset to
 *           flat: the account still pays the strike-width cash (the C1
 *           accounting fix — offsetting delivery is not cash-neutral)
 *   2. Runs the real `runSettlementPass` with the injected lister scoped
 *      to the scratch docs (the default sweep is global — the injected
 *      lister keeps the verify off real prod positions; the signal
 *      filter itself runs inside the pass, so (b) still proves
 *      disjointness).
 *   3. Seeds an ASSIGNED held-shares position + runs the real
 *      `runHeldSharesMarkPass` — asserts the mark writes vs the position's
 *      own symbol close.
 *   4. Asserts statuses, per-leg outcomes, marks, account bookkeeping,
 *      then cleans up all scratch docs and verifies deletion.
 *
 * Usage (from functions/ dir):
 *   npx tsx scripts/verify/strat-manage-settlement-1714.ts
 *
 * Requires: ADC (rel-str). No RH MCP needed.
 */

import { db } from '../../src/firebase-admin-init';
import {
  OptionQuoteSource,
  OptionType,
  buildOccContractId,
} from '../../../shared/options-common';
import { TradeSide } from '../../../shared/common';
import {
  PaperTradingKind,
  PaperTradeSource,
  PaperTradeStatus,
} from '../../../shared/paper-trading-contracts';
import type { PaperAccount, PaperTrade, PaperTradeLeg } from '../../../shared/paper-trading-contracts';
import { buildAccountId } from '../../../shared/paper-trading-ids';
import { paperDocRef, paperItemsRef } from '../../src/paper-trading/collections';
import { getMarketDatePT } from '../../src/common/pt-date-utils';
import {
  getUnderlyingCloseForDate,
  getUnderlyingCloseOnOrBefore,
} from '../../src/paper-trading/engine/options-strategy-market-data';
import { runSettlementPass } from '../../src/paper-trading/engine/passes/settlement-pass';
import { runHeldSharesMarkPass } from '../../src/paper-trading/engine/passes/held-shares-pass';
import { strategyInstanceRef } from '../../src/paper-trading/engine/strategy-instance-repository';
import { SHARES_PER_CONTRACT } from '../../src/paper-trading/engine/types';
import { PositionStatus } from '../../src/paper-trading/engine/types';

const USER_ID = 'verify-1714-user';
const INSTANCE_ID = 'verify-1714-inst';
const ACCT_ID = buildAccountId(USER_ID);
const ID_ZOMBIE = 'verify-1714-zombie'; // expired OTM put, no instanceId
const ID_SIGNAL = 'verify-1714-signal'; // signal-source — must be skipped
const ID_SPREAD = 'verify-1714-spread'; // 2-leg put spread, partial assign
const ID_SINGLE = 'verify-1714-single'; // expired OTM put on the instance
const ID_HELD = 'verify-1714-held'; // ASSIGNED position for held-shares mark
const ID_FLAT = 'verify-1714-flat'; // fully-ITM spread — offsetting delivery
const EXPIRY = '2026-09-29'; // Tuesday — SDS bar must exist
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

function optionLeg(
  side: TradeSide,
  strike: number,
  type: OptionType = OptionType.PUT,
): PaperTradeLeg {
  return {
    kind: 'option',
    id: `${type}-${strike}-${EXPIRY}`,
    contractID: buildOccContractId('QQQM', EXPIRY, type, strike),
    type,
    strike,
    expiration: EXPIRY,
    openDate: '2026-09-01',
    side,
    quantity: 1,
    multiplier: SHARES_PER_CONTRACT,
    entryMark: ENTRY_PREMIUM,
    lastMark: ENTRY_PREMIUM,
  };
}

function scratchTrade(
  id: string,
  legs: PaperTradeLeg[],
  overrides: Partial<PaperTrade> = {},
): PaperTrade {
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
    legs,
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
    ...overrides,
  };
}

async function getTrade(id: string): Promise<PaperTrade | null> {
  const snap = await paperDocRef(db, PaperTradingKind.TRADE, id).get();
  return snap.exists
    ? ({ id: snap.id, ...(snap.data() as object) } as PaperTrade)
    : null;
}

const SCRATCH_IDS = [ID_ZOMBIE, ID_SIGNAL, ID_SPREAD, ID_SINGLE, ID_HELD, ID_FLAT];

async function cleanup(): Promise<void> {
  for (const id of SCRATCH_IDS) {
    await paperDocRef(db, PaperTradingKind.TRADE, id).delete();
  }
  await strategyInstanceRef(INSTANCE_ID).delete();
  await paperDocRef(db, PaperTradingKind.ACCOUNT, ACCT_ID).delete();
}

async function main(): Promise<void> {
  const close = await getUnderlyingCloseForDate('QQQM', EXPIRY);
  check('SDS bar exists for the expiration', close !== null, { EXPIRY });
  if (close === null) {
    await cleanup();
    return;
  }
  console.log(`  QQQM close on ${EXPIRY}: ${close}`);

  const otmStrike = Math.floor(close) - 100; // far OTM → expires worthless
  const shortItmStrike = Math.ceil(close) + 50; // ITM → short leg assigns
  const longOtmStrike = Math.floor(close) - 50; // OTM → long leg worthless
  const midItmStrike = Math.ceil(close) + 20; // ITM → long leg exercises
  const marketDate = getMarketDatePT();
  check('run date is after the expiration (missed-night shape)', marketDate > EXPIRY, { marketDate });

  await cleanup(); // clear leftovers from a prior run
  const now = new Date().toISOString();
  await strategyInstanceRef(INSTANCE_ID).set({
    kind: PaperTradingKind.INSTANCE,
    symbol: 'QQQM',
    lifecycleState: 'ACTIVE',
    userId: USER_ID,
    paperAccountId: ACCT_ID,
    governingVariant: 'trailing-8',
    createdAt: now,
    updatedAt: now,
  });
  // Account: entry premium posted on 2 sellable scratch trades only
  // (zombie/signal/spread legs are scratch bookkeeping — keep it simple:
  // assert the account moves for the positions it owns).
  const account: PaperAccount = {
    kind: PaperTradingKind.ACCOUNT,
    id: ACCT_ID,
    userId: USER_ID,
    cash: 400,
    equity: 0,
    realizedPnl: 0,
    openTradeCount: 4,
    createdAt: now,
    updatedAt: now,
  };
  await paperDocRef(db, PaperTradingKind.ACCOUNT, ACCT_ID).set(account);

  const zombie = scratchTrade(ID_ZOMBIE, [optionLeg(TradeSide.SHORT, otmStrike)], {
    strategyInstanceId: undefined, // the 260819-* zombie shape
  });
  const signal = scratchTrade(ID_SIGNAL, [optionLeg(TradeSide.SHORT, otmStrike)], {
    source: PaperTradeSource.SIGNAL,
    strategyInstanceId: undefined,
  });
  const spread = scratchTrade(
    ID_SPREAD,
    [optionLeg(TradeSide.SHORT, shortItmStrike), optionLeg(TradeSide.LONG, longOtmStrike)],
    { expression: 'BPS' },
  );
  const single = scratchTrade(ID_SINGLE, [optionLeg(TradeSide.SHORT, otmStrike)]);
  // Fully-ITM put spread: short assigns +1, long exercises −1 → flat.
  // Real cash moves −(width×100) even though no shares remain (C1 fix).
  const flat = scratchTrade(
    ID_FLAT,
    [optionLeg(TradeSide.SHORT, shortItmStrike), optionLeg(TradeSide.LONG, midItmStrike)],
    { expression: 'BPS' },
  );
  const held = scratchTrade(ID_HELD, [], {
    status: PaperTradeStatus.ASSIGNED,
    legacyStatus: PositionStatus.ASSIGNED_HOLDING_SHARES,
    assignment: { strikePrice: shortItmStrike, underlyingCloseAtExpiration: close, assignedAt: EXPIRY },
    shares: { quantity: 1, costBasis: shortItmStrike },
  });

  for (const t of [zombie, signal, spread, single, held, flat]) {
    await paperDocRef(db, PaperTradingKind.TRADE, t.id).set(
      (({ id: _id, ...d }) => d)(t),
    );
  }
  check('scratch docs seeded', (await getTrade(ID_ZOMBIE)) !== null);

  // ── Settlement sweep ────────────────────────────────────────────────────
  const result = await runSettlementPass(marketDate, {
    // Scoped lister — the real sweep is global; this keeps the verify off
    // real prod positions while exercising the pass's own signal filter.
    listOpenOptionTrades: async () => [zombie, signal, spread, single, flat],
    getUnderlyingClose: getUnderlyingCloseForDate,
  });
  console.log(
    `  settlement: settled=${result.settled.length} ` +
      `skippedNotExpired=${result.skippedNotExpired} errors=${result.errors.length}`,
  );
  check('sweep settled 4 trades with no errors',
    result.settled.length === 4 && result.errors.length === 0, result.errors);

  const zombieDoc = await getTrade(ID_ZOMBIE);
  check('zombie trade (no instanceId) settled EXPIRED',
    zombieDoc?.status === PaperTradeStatus.EXPIRED, zombieDoc?.status);

  const signalDoc = await getTrade(ID_SIGNAL);
  check('signal-source trade left OPEN (disjoint from signalSettlementPass)',
    signalDoc?.status === PaperTradeStatus.OPEN, signalDoc?.status);
  check('signal trade legs carry no outcome',
    signalDoc?.legs[0]?.outcome === undefined, signalDoc?.legs[0]);

  const spreadDoc = await getTrade(ID_SPREAD);
  check('spread settled ASSIGNED (net long delivery)',
    spreadDoc?.status === PaperTradeStatus.ASSIGNED, spreadDoc?.status);
  const spreadLegs = spreadDoc?.legs ?? [];
  const shortLeg = spreadLegs.find((l) => l.side === TradeSide.SHORT);
  const longLeg = spreadLegs.find((l) => l.side === TradeSide.LONG);
  check('spread short leg outcome ASSIGNED',
    shortLeg?.outcome === 'ASSIGNED', shortLeg);
  check('spread long leg outcome EXPIRED_WORTHLESS',
    longLeg?.outcome === 'EXPIRED_WORTHLESS', longLeg);
  check('spread shares record at the SHORT strike basis',
    spreadDoc?.shares?.quantity === 1 && spreadDoc?.shares?.costBasis === shortItmStrike,
    spreadDoc?.shares);

  const singleDoc = await getTrade(ID_SINGLE);
  check('instance trade settled EXPIRED',
    singleDoc?.status === PaperTradeStatus.EXPIRED, singleDoc?.status);
  check('instance trade realizedPnl = +200 (premium kept)',
    singleDoc !== null && Math.abs(singleDoc.realizedPnl - 200) < 1e-6,
    singleDoc?.realizedPnl);

  // Fully-ITM spread (C1): deliveries offset to flat but the strike-width
  // cash differential is real — cash −width×100, realized premium−width×100,
  // governing run exits at the spread's net intrinsic (not a fake 0).
  const width = shortItmStrike - midItmStrike;
  const flatDoc = await getTrade(ID_FLAT);
  check('flat spread settled EXPIRED (offsetting deliveries)',
    flatDoc?.status === PaperTradeStatus.EXPIRED, flatDoc?.status);
  check('flat spread holds no shares record',
    flatDoc?.shares === undefined, flatDoc?.shares);
  const flatLegs = flatDoc?.legs ?? [];
  check('flat spread legs both ASSIGNED',
    flatLegs.every((l) => l.outcome === 'ASSIGNED'), flatLegs);
  check('flat spread realizedPnl = premium − width×100 (not premium-only)',
    flatDoc !== null &&
      Math.abs(flatDoc.realizedPnl - (200 - width * SHARES_PER_CONTRACT)) < 1e-6,
    flatDoc?.realizedPnl);
  check('flat spread governing run exits at net intrinsic, not 0',
    Math.abs(
      (flatDoc?.variantRuns.find((r) => r.governing)?.exitEvent?.price ?? 0) -
        width,
    ) < 1e-6,
    flatDoc?.variantRuns);
  // Account proof: cash moves by the REAL delivery totals — flat spread
  // −width×100 plus the assigned spread's share purchase −strike×100.
  const acctSnap = await paperDocRef(db, PaperTradingKind.ACCOUNT, ACCT_ID).get();
  const acct = acctSnap.data() as PaperAccount | undefined;
  const expectedCash =
    400 - width * SHARES_PER_CONTRACT - shortItmStrike * SHARES_PER_CONTRACT;
  check('account cash debited by real delivery totals',
    acct !== undefined && Math.abs(acct.cash - expectedCash) < 1e-6,
    { cash: acct?.cash, expectedCash });

  // ── Held-shares mark ───────────────────────────────────────────────────
  // Held positions mark at the RUN DATE's close (not the assignment close).
  // The run date may be a holiday (no bar) — walk back to the last trading
  // day so the verify works on non-trading days too.
  const runCloseBar = await getUnderlyingCloseOnOrBefore('QQQM', marketDate);
  check('SDS bar exists on or before the run date', runCloseBar !== null,
    { marketDate });
  if (runCloseBar === null) {
    await cleanup();
    return;
  }
  const heldDate = runCloseBar.date;
  const runClose = runCloseBar.price;
  const heldResult = await runHeldSharesMarkPass(heldDate, {
    listAssignedTrades: async () => [held],
    getUnderlyingClose: getUnderlyingCloseForDate,
  });
  console.log(
    `  held-shares: marked=${heldResult.marked.length} errors=${heldResult.errors.length}`,
  );
  check('held-shares pass marked the ASSIGNED position',
    heldResult.marked.length === 1 && heldResult.errors.length === 0,
    heldResult.errors);
  const expectedPnl = (runClose - shortItmStrike) * SHARES_PER_CONTRACT;
  check('held-shares unrealizedPnl = (run close − basis) × 100 × qty',
    heldResult.marked.length === 1 &&
      Math.abs(heldResult.marked[0].unrealizedPnl - expectedPnl) < 1e-6,
    heldResult.marked[0]);
  const heldDoc = await getTrade(ID_HELD);
  check('held-shares mark written for the run date',
    heldDoc?.marks[heldDate]?.underlyingClose === runClose, heldDoc?.marks);

  // ── Sweep reachability report (read-only) ──────────────────────────────
  const openTrades = await paperItemsRef(db, PaperTradingKind.TRADE)
    .where('status', '==', PaperTradeStatus.OPEN)
    .get();
  const zombieReach = openTrades.docs.filter(
    (d) => (d.data() as PaperTrade).strategyInstanceId === undefined &&
      (d.data() as PaperTrade).source !== PaperTradeSource.SIGNAL,
  );
  console.log(
    `  reachability: ${openTrades.docs.length} OPEN trades in corpus, ` +
      `${zombieReach.length} without strategyInstanceId (zombie-sweep candidates)`,
  );
  check('scratch OPEN trades left only the untouched signal doc',
    openTrades.docs.filter((d) => d.id.startsWith('verify-1714'))
      .every((d) => d.id === ID_SIGNAL),
    openTrades.docs.filter((d) => d.id.startsWith('verify-1714')).map((d) => d.id));

  await cleanup();
  // Verify deletion — survivors are loud, not silent.
  const survivors = [
    ...(await Promise.all(SCRATCH_IDS.map((id) => getTrade(id)))).map(
      (t) => t !== null,
    ),
    (await strategyInstanceRef(INSTANCE_ID).get()).exists,
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
