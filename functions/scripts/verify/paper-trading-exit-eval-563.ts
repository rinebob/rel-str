/**
 * @topic #553 — Paper Trading Infra (task #563)
 *
 * Real-environment verification for the exit eval pass:
 * seeds namespaced `verify-563-` trades + a matching instance/account, runs
 * `runExitEvalPass` with the production deps, and asserts:
 *
 *   1. Governing variant breach → real closing fill via applyExitFill,
 *      trade → CLOSED, account cash/realized/openCount updated.
 *   2. Shadow variant breach → run EXITED with counterfactual exitEvent,
 *      trade untouched.
 *   3. Non-triggering run → workingState update only.
 *   4. Missing mark for the eval date → trade skipped, nothing fires.
 *   5. `none` sentinel run → inert.
 *   6. Re-run on a CLOSED trade → no second closing fill (backfill-safe).
 *
 * Requires ADC + NODE_OPTIONS ipv4 preload. Run from functions/:
 *   npx tsx scripts/verify/paper-trading-exit-eval-563.ts
 */

import { db } from '../../src/firebase-admin-init';
import { OptionQuoteSource, OptionType } from '../../../shared/options-common';
import { TradeSide } from '../../../shared/common';
import {
  PaperAccount,
  PaperTrade,
  PaperTradeSource,
  PaperTradeStatus,
  PaperTradingKind,
} from '../../../shared/paper-trading-contracts';
import { buildAccountId } from '../../../shared/paper-trading-ids';
import { SHARES_PER_CONTRACT } from '../../src/paper-trading/engine/types';
import { runExitEvalPass, defaultEvalDeps } from '../../src/paper-trading/exits/eval-pass';

const PREFIX = 'verify-563';
const INSTANCE_ID = `${PREFIX}-inst`;
const USER_ID = `${PREFIX}-user`;
const ACCT_ID = buildAccountId(USER_ID);
const DATE = '2026-09-10';

let passed = 0;
let failed = 0;
function check(name: string, cond: boolean, detail?: string) {
  if (cond) { passed++; console.log(`OK   ${name}`); }
  else { failed++; console.log(`FAIL ${name}${detail ? ` — ${detail}` : ''}`); }
}

function tradeDoc(id: string, variantRuns: PaperTrade['variantRuns'], marks: PaperTrade['marks']): Omit<PaperTrade, 'id'> {
  return {
    kind: PaperTradingKind.TRADE,
    status: PaperTradeStatus.OPEN,
    source: PaperTradeSource.MANUAL,
    strategyInstanceId: INSTANCE_ID,
    symbol: 'QQQM',
    expression: 'CSP',
    governingVariant: 'initial-stop-10',
    order: { side: TradeSide.SHORT, type: 'MARKET', quantity: 1 },
    fills: [
      {
        fillId: `entry-${id}`,
        role: 'entry',
        date: '2026-09-01',
        price: 2.0,
        quantity: 1,
        quoteSource: OptionQuoteSource.RH_MCP,
      },
    ],
    legs: [
      {
        kind: 'option',
        side: TradeSide.SHORT,
        quantity: 1,
        multiplier: SHARES_PER_CONTRACT,
        entryMark: 2.0,
        lastMark: 2.0,
        contractID: 'QQQM260926P00097500',
        type: OptionType.PUT,
        strike: 97.5,
        expiration: '2026-09-26',
      },
    ],
    marks,
    variantRuns,
    variantKeys: variantRuns.map((r) => r.variantKey),
    realizedPnl: 0,
    unrealizedPnl: 0,
    createdAt: '2026-09-01T12:00:00Z',
    updatedAt: '2026-09-01T12:00:00Z',
  };
}

const run = (variantKey: string, governing: boolean, workingState: Record<string, number> = {}) => ({
  variantKey, governing, state: 'ACTIVE' as const, workingState,
});

async function seed() {
  const batch = db.batch();

  batch.set(db.collection('paper-trading/instances/items').doc(INSTANCE_ID), {
    kind: PaperTradingKind.INSTANCE,
    symbol: 'QQQM',
    lifecycleState: 'ACTIVE',
    userId: USER_ID,
    paperAccountId: ACCT_ID,
    governingVariant: 'none',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });

  const account: Omit<PaperAccount, 'id'> = {
    kind: PaperTradingKind.ACCOUNT,
    userId: USER_ID,
    cash: 200, // entry premium already credited for both seeded trades
    equity: -200, // cash 200 + open liquidation 2 × (−2.0 × 100)
    realizedPnl: 0,
    openTradeCount: 2,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  batch.set(db.collection('paper-trading/accounts/items').doc(ACCT_ID), account);

  // Trade 1: governing initial-stop-10 + shadow time-9d. Mark 2.2 breaches
  // governing (entry 2.0 + 10% = 2.2); shadow fires too (daysHeld 9 >= 9).
  batch.set(
    db.collection('paper-trading/trades/items').doc(`${PREFIX}-t1`),
    tradeDoc(
      `${PREFIX}-t1`,
      [run('initial-stop-10', true), run('time-9d', false)],
      { [DATE]: { mark: 2.2, underlyingClose: 99.0 } },
    ),
  );

  // Trade 2: governing trailing-20. Mark 1.0 is a new low — no breach, just
  // a working-state update.
  batch.set(
    db.collection('paper-trading/trades/items').doc(`${PREFIX}-t2`),
    tradeDoc(
      `${PREFIX}-t2`,
      [run('trailing-20', true)],
      { [DATE]: { mark: 1.0, underlyingClose: 99.0 } },
    ),
  );

  // Trade 3: no mark for the eval date — gap tolerance.
  batch.set(
    db.collection('paper-trading/trades/items').doc(`${PREFIX}-t3`),
    tradeDoc(`${PREFIX}-t3`, [run('initial-stop-10', true)], {}),
  );

  // Trade 4: 'none' sentinel — inert.
  batch.set(
    db.collection('paper-trading/trades/items').doc(`${PREFIX}-t4`),
    tradeDoc(`${PREFIX}-t4`, [run('none', true)], { [DATE]: { mark: 2.2 } }),
  );

  await batch.commit();
  console.log('seeded verify-563 docs (instance, account, 4 trades)');
}

async function cleanup() {
  for (const anchor of ['instances', 'trades', 'accounts']) {
    const snap = await db.collection(`paper-trading/${anchor}/items`).get();
    const b = db.batch();
    for (const d of snap.docs) if (d.id.includes(PREFIX)) b.delete(d.ref);
    await b.commit();
  }
  console.log('cleanup: verification docs removed');
}

const eq = (a: number, b: number) => Math.abs(a - b) < 1e-9;

async function main(): Promise<void> {
  await seed();

  const summary = await runExitEvalPass(DATE, defaultEvalDeps());
  console.log(
    `eval summary: evaluated=${summary.evaluated} closes=${summary.governingCloses} ` +
      `shadowExits=${summary.shadowExits} updates=${summary.stateUpdates} ` +
      `noMark=${summary.skipsNoMark} errors=${summary.errors.length}`,
  );

  // ── Trade 1: governing close + shadow event ──
  const t1 = (await db.doc(`paper-trading/trades/items/${PREFIX}-t1`).get()).data() as PaperTrade;
  check('t1: trade CLOSED by governing breach', t1.status === PaperTradeStatus.CLOSED);
  const exitFill = t1.fills.find((f) => f.role === 'exit');
  check('t1: closing fill written at the mark', exitFill?.price === 2.2 && exitFill.fillId === `exit-${PREFIX}-t1-initial-stop-10-${DATE}`);
  check('t1: realized P&L = −20 (adverse +10% on 2.0 premium)',
    eq(t1.realizedPnl, -20));
  const govRun = t1.variantRuns.find((r) => r.governing)!;
  check('t1: governing run EXITED with exitEvent',
    govRun.state === 'EXITED' &&
    govRun.exitEvent?.date === DATE &&
    eq(govRun.exitEvent.pnl, -20) &&
    govRun.exitEvent.daysHeld === 9);
  const shadowRun = t1.variantRuns.find((r) => r.variantKey === 'time-9d')!;
  check('t1: shadow run EXITED with counterfactual event',
    shadowRun.state === 'EXITED' &&
    shadowRun.exitEvent?.date === DATE &&
    eq(shadowRun.exitEvent.pnl, -20));

  // ── Account leg of the governing close ──
  const acct = (await db.doc(`paper-trading/accounts/items/${ACCT_ID}`).get()).data() as PaperAccount;
  // exit fill price 2.2 on a SHORT order → cash debits 220 (buyback cost)
  check('account: cash debited by buyback cost (−220)', eq(acct.cash, -20));
  check('account: openTradeCount decremented once', acct.openTradeCount === 1);
  check('account: realizedPnl = −20', eq(acct.realizedPnl, -20));
  // equity = cash −20 + t2's open liquidation at lastMark (−2.0 × 100 = −200)
  check('account: equity = −220 (−20 cash − 200 remaining liability)', eq(acct.equity, -220));

  // ── Trade 2: working-state update only ──
  const t2 = (await db.doc(`paper-trading/trades/items/${PREFIX}-t2`).get()).data() as PaperTrade;
  check('t2: stays OPEN (no breach)', t2.status === PaperTradeStatus.OPEN);
  check('t2: run ACTIVE with new low-water mark',
    t2.variantRuns[0].state === 'ACTIVE' &&
    t2.variantRuns[0].workingState.lowWaterMark === 1.0 &&
    t2.variantRuns[0].exitEvent === undefined);

  // ── Trade 3: mark gap tolerated ──
  const t3 = (await db.doc(`paper-trading/trades/items/${PREFIX}-t3`).get()).data() as PaperTrade;
  check('t3: skipped on missing mark — still OPEN, run untouched',
    t3.status === PaperTradeStatus.OPEN &&
    t3.variantRuns[0].state === 'ACTIVE' &&
    t3.variantRuns[0].exitEvent === undefined);

  // ── Trade 4: 'none' inert ──
  const t4 = (await db.doc(`paper-trading/trades/items/${PREFIX}-t4`).get()).data() as PaperTrade;
  check('t4: none sentinel never fires', t4.status === PaperTradeStatus.OPEN && t4.variantRuns[0].state === 'ACTIVE');

  // ── Idempotent-ish re-run: closed trade must not re-close ──
  const summary2 = await runExitEvalPass(DATE, defaultEvalDeps());
  const t1b = (await db.doc(`paper-trading/trades/items/${PREFIX}-t1`).get()).data() as PaperTrade;
  check('re-run: no second closing fill', t1b.fills.filter((f) => f.role === 'exit').length === 1);
  check('re-run: no new governing closes on verify trades',
    summary2.governingCloses === 0);
  if (summary.errors.length + summary2.errors.length > 0) {
    console.log('eval errors:', [...summary.errors, ...summary2.errors]);
    failed += summary.errors.length + summary2.errors.length;
  }

  await cleanup();
  console.log(`\n=== ${passed} passed, ${failed} failed ===`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch(async (err) => {
  console.error('verification error:', err instanceof Error ? err.message : String(err));
  try { await cleanup(); } catch { /* best effort */ }
  process.exit(1);
});
