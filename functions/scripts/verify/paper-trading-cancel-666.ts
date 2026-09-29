/**
 * @topic #553 — Paper Trading Infra (task #666 — pending cancel)
 *
 * Verifies the pending-cancel seam against the REAL (prod) Firestore:
 *
 *   1. createPendingTrade → PENDING trade doc (no cash movement)
 *   2. handleCancelPaperTrade (prod deps) → CANCELLED, runs finalized EXITED
 *   3. read-back → status CANCELLED, account unchanged
 *   4. re-cancel → failed-precondition (non-PENDING)
 *   5. wrong-user cancel → permission-denied
 *   6. cleanup → verification docs deleted
 *
 * Test docs use `verify-666-` ids / `acct-verify-666` and are deleted in a
 * finally block, so the script is safe to re-run.
 *
 * Usage (from functions/ dir):
 *   npx tsx scripts/verify/paper-trading-cancel-666.ts
 *
 * Requires Application Default Credentials. Firestore project: rel-str.
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
import { cancelPendingTrade, createPendingTrade } from '../../src/paper-trading/ledger';
import { getAccount, getTrade, ledgerDeps } from '../../src/paper-trading/repository';
import { handleCancelPaperTrade } from '../../src/paper-trading/callables';

const USER_ID = 'verify-666';
const ACCOUNT_ID = 'acct-verify-666';
const TRADE_ID = 'verify-666-QQQM-CSP';
const PATH_TRADE = `paper-trading/trades/items/${TRADE_ID}`;
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
  const deps = ledgerDeps(db);

  await cleanup(db);

  // 1. Create a PENDING trade (as the signal fan-out would).
  await createPendingTrade(
    {
      userId: USER_ID,
      tradeId: TRADE_ID,
      order: { side: TradeSide.SHORT, type: 'MARKET', quantity: 1 },
      dims: {
        source: PaperTradeSource.SIGNAL,
        symbol: 'QQQM',
        expression: 'CSP',
        governingVariant: DEFAULT_TRAILING_STOP_KEY,
        variantKeys: [DEFAULT_TRAILING_STOP_KEY],
      },
      now: new Date().toISOString(),
    },
    deps,
  );
  const created = await getTrade(db, TRADE_ID);
  check('pending trade created', created?.status === PaperTradeStatus.PENDING, created?.status);

  const acctBefore = await getAccount(db, ACCOUNT_ID);
  check('account anchor exists before cancel', acctBefore?.id === ACCOUNT_ID, acctBefore?.id);

  const handlerDeps = {
    getTrade: (id: string) => getTrade(db, id),
    cancelPendingTrade: (input: Parameters<typeof cancelPendingTrade>[0]) =>
      cancelPendingTrade(input, deps),
    now: () => new Date(),
  };

  // 2. Wrong-user cancel → permission-denied (before the happy path).
  try {
    await handleCancelPaperTrade(
      { auth: { uid: 'someone-else' }, data: { tradeId: TRADE_ID } },
      handlerDeps,
    );
    check('wrong-user cancel rejected', false, 'no error thrown');
  } catch (err) {
    check(
      'wrong-user cancel rejected (permission-denied)',
      err instanceof HttpsError && err.code === 'permission-denied',
      err,
    );
  }

  // 3. Happy-path cancel.
  const res = await handleCancelPaperTrade(
    { auth: { uid: USER_ID }, data: { tradeId: TRADE_ID } },
    handlerDeps,
  );
  check('cancel returns the trade id', res.tradeId === TRADE_ID, res);

  // 4. Read-back: CANCELLED, runs finalized, no fills/legs ever materialized.
  const after = (await getTrade(db, TRADE_ID)) as PaperTrade;
  check('trade CANCELLED', after.status === PaperTradeStatus.CANCELLED, after.status);
  check(
    'variant runs finalized (no ACTIVE on a never-held trade)',
    after.variantRuns.every((r) => r.state === 'EXITED'),
    after.variantRuns,
  );

  // 5. No cash movement — account untouched by the cancel.
  const acctAfter = await getAccount(db, ACCOUNT_ID);
  check(
    'account cash/count unchanged by cancel',
    !!acctAfter &&
      acctAfter.cash === acctBefore!.cash &&
      acctAfter.openTradeCount === acctBefore!.openTradeCount,
    { before: acctBefore, after: acctAfter },
  );

  // 6. Re-cancel → failed-precondition (cancelled is not pending).
  try {
    await handleCancelPaperTrade(
      { auth: { uid: USER_ID }, data: { tradeId: TRADE_ID } },
      handlerDeps,
    );
    check('re-cancel rejected', false, 'no error thrown');
  } catch (err) {
    check(
      're-cancel rejected (failed-precondition)',
      err instanceof HttpsError && err.code === 'failed-precondition',
      err,
    );
  }

  // 7. Unknown trade → not-found.
  try {
    await handleCancelPaperTrade(
      { auth: { uid: USER_ID }, data: { tradeId: 'verify-666-nope' } },
      handlerDeps,
    );
    check('missing trade rejected', false, 'no error thrown');
  } catch (err) {
    check(
      'missing trade rejected (not-found)',
      err instanceof HttpsError && err.code === 'not-found',
      err,
    );
  }
}

main()
  .catch((err) => {
    failed++;
    console.log('FAIL unhandled', err);
  })
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
