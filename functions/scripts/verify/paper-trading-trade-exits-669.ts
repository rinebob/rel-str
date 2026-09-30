/**
 * @topic #553 — Paper Trading Infra (task #669 — trade-exits composed verify)
 *
 * Verifies the composed exit seam against the REAL (prod) Firestore:
 *
 *   1. Prod-data seeding audit — every existing trade's variantRuns obey
 *      the #668 invariants (parseable keys, ≤1 governing run, terminal
 *      governing key or legacy 'none', no ACTIVE runs on terminal
 *      statuses, variantKeys mirror runs).
 *   2. Instance-resolution round trips — scratch instance docs with
 *      governingVariant 'trailing-15' / 'time-30d' / 'none' →
 *      createPosition seeds 'trailing-15' / 'trailing-8' / 'trailing-8'
 *      as the single governing run.
 *   3. Seed guards — createPendingTrade rejects 'none'/'time-30d'/'bogus'
 *      governing keys and unparseable variantKeys; nothing is written.
 *   4. Cancel path — seeded PENDING trade → CANCELLED, runs EXITED.
 *   5. Close-path guards — missing trade → not-found, CANCELLED trade →
 *      failed-precondition (guards fire before the quote fetch, so no RH
 *      creds needed here; the live-quote close is covered by -667).
 *
 * Test docs use `verify-669-` ids / `acct-verify-669` and are deleted in a
 * finally block, so the script is safe to re-run.
 *
 * Usage (from functions/ dir):
 *   npx tsx scripts/verify/paper-trading-trade-exits-669.ts
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
import { OptionType, PositionSpreadType, StrategyFrequency } from '../../../shared/options-common';
import {
  LifecycleState,
} from '../../../shared/options-strategy-engine-contracts';
import {
  PaperTradingKind,
  PaperTradeSource,
  PaperTradeStatus,
  DEFAULT_TRAILING_STOP_KEY,
  NONE_VARIANT_KEY,
  type PaperStrategyInstance,
  type PaperTrade,
  type VariantRun,
} from '../../../shared/paper-trading-contracts';
import {
  cancelPendingTrade,
  createPendingTrade,
} from '../../src/paper-trading/ledger';
import { getTrade, ledgerDeps } from '../../src/paper-trading/repository';
import { handleCancelPaperTrade, handleClosePaperTrade } from '../../src/paper-trading/callables';
import { paperItemsRef } from '../../src/paper-trading/collections';
import { isTerminalVariantKey, parseVariantKey } from '../../src/paper-trading/exits/registry';
import { createPosition } from '../../src/paper-trading/engine/position-repository';
import type { PositionLeg } from '../../src/paper-trading/engine/types';
import { PositionStatus } from '../../src/paper-trading/engine/types';

const USER_ID = 'verify-669';
const ACCOUNT_ID = 'acct-verify-669';
const POS_TRAILING = 'verify-669-pos-t15';
const POS_NONTERMINAL = 'verify-669-pos-time';
const POS_NONE = 'verify-669-pos-none';
const PENDING_ID = 'verify-669-pending';
const INST_T15 = 'verify-669-inst-t15';
const INST_TIME = 'verify-669-inst-time';
const INST_NONE = 'verify-669-inst-none';
const TODAY = new Date().toISOString().slice(0, 10);

const TERMINAL_STATUSES: readonly string[] = [
  PaperTradeStatus.CLOSED,
  PaperTradeStatus.CANCELLED,
  PaperTradeStatus.EXPIRED,
  PaperTradeStatus.ASSIGNED,
];

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

function scratchInstance(id: string, governingVariant: string): PaperStrategyInstance {
  const now = new Date().toISOString();
  return {
    kind: PaperTradingKind.INSTANCE,
    id,
    paperAccountId: ACCOUNT_ID,
    governingVariant,
    symbol: 'QQQM',
    optionType: OptionType.PUT,
    side: TradeSide.SHORT,
    targetDelta: 0.3,
    dteMin: 30,
    dteMax: 60,
    phases: [
      {
        spreadType: PositionSpreadType.CASH_SECURED_PUT,
        targetDelta: 0.3,
        dteMin: 30,
        dteMax: 60,
      },
    ],
    frequency: StrategyFrequency.DAILY,
    // '99:99' can never equal a computed open slot — belt-and-suspenders
    // on top of STOPPED so a leaked scratch instance can never feed the
    // selection/open passes (a stray ACTIVE instance would write
    // daily-analysis docs and could launch a real ledger-managed trade).
    openTimePT: '99:99',
    exitPolicies: [],
    lifecycleState: LifecycleState.STOPPED,
    userId: USER_ID,
    createdAt: now,
    updatedAt: now,
  };
}

function scratchLeg(): PositionLeg {
  return {
    id: `${POS_TRAILING}-leg`,
    type: OptionType.PUT,
    side: TradeSide.SHORT,
    strike: 500,
    expiration: '2026-11-20',
    openDate: TODAY,
    premium: 1.0,
  };
}

async function cleanup(firestoreDb: Firestore): Promise<void> {
  const tradeIds = [
    POS_TRAILING,
    POS_NONTERMINAL,
    POS_NONE,
    PENDING_ID,
    // Guard-rejection ids — nothing is written today, but if a regression
    // ever lets a rejected seed persist, cleanup removes it instead of
    // leaving a corrupt doc in prod.
    ...['none', 'time-30d', 'bogus', 'trailing-0', 'trailing-150', 'vk'].map(
      (s) => `verify-669-guard-${s}`,
    ),
  ];
  const instIds = [INST_T15, INST_TIME, INST_NONE];
  for (const id of tradeIds) {
    await firestoreDb.doc(`paper-trading/trades/items/${id}`).delete().catch(() => undefined);
  }
  for (const id of instIds) {
    await firestoreDb.doc(`paper-trading/instances/items/${id}`).delete().catch(() => undefined);
  }
  await firestoreDb.doc(`paper-trading/accounts/items/${ACCOUNT_ID}`).delete().catch(() => undefined);
  // Raw quotes are only written for the createPosition/pending ids — the
  // guard ids never reach writeRawQuote.
  const rq = await paperItemsRef(firestoreDb, PaperTradingKind.RAW_QUOTE)
    .where('tradeId', 'in', [POS_TRAILING, POS_NONTERMINAL, POS_NONE, PENDING_ID])
    .get()
    .catch(() => null);
  if (rq) {
    const batch = firestoreDb.batch();
    rq.docs.forEach((d) => batch.delete(d.ref));
    await batch.commit(); // surfaced to callers — a swallowed failure left orphans
  }
  // A stray scratch instance that ever ran a stats pass leaves stats docs
  // — both the generalized `stats-inst-{id}` scope and the engine's legacy
  // `stats-{id}` doc. Delete both.
  for (const inst of instIds) {
    for (const statId of [`stats-inst-${inst}`, `stats-${inst}`]) {
      await firestoreDb
        .doc(`paper-trading/stats/items/${statId}`)
        .delete()
        .catch(() => undefined);
    }
  }
}

// ── 1. Prod-data seeding audit ──────────────────────────────────────────────

async function auditProdTrades(firestoreDb: Firestore): Promise<void> {
  const snap = await paperItemsRef(firestoreDb, PaperTradingKind.TRADE).get();
  const trades = snap.docs.map((d) => d.data() as PaperTrade);
  console.log(`\n  auditing ${trades.length} prod trade docs`);

  check('audit found trade docs', trades.length > 0, trades.length);

  const badRuns: string[] = [];
  const multiGoverning: string[] = [];
  const badGoverningKey: string[] = [];
  const activeOnTerminal: string[] = [];
  const keysMismatch: string[] = [];
  for (const t of trades) {
    const runs: VariantRun[] = t.variantRuns ?? [];
    for (const r of runs) {
      if (r.variantKey !== NONE_VARIANT_KEY && !parseVariantKey(r.variantKey)) {
        badRuns.push(`${t.id}:${r.variantKey}`);
      }
    }
    const governing = runs.filter((r) => r.governing);
    if (governing.length > 1) multiGoverning.push(t.id);
    const g = governing[0];
    if (g && g.variantKey !== NONE_VARIANT_KEY && !isTerminalVariantKey(g.variantKey)) {
      badGoverningKey.push(`${t.id}:${g.variantKey}`);
    }
    if (
      TERMINAL_STATUSES.includes(t.status) &&
      runs.some((r) => r.state === 'ACTIVE')
    ) {
      activeOnTerminal.push(`${t.id}:${t.status}`);
    }
    // Top-level governingVariant must mirror the governing run's key —
    // a doc with a stored key but no run (or vice versa) is a seeding bug.
    if (g && t.governingVariant !== g.variantKey) {
      badGoverningKey.push(`${t.id}:field=${t.governingVariant}≠run=${g.variantKey}`);
    }
    // A real stored key with no governing run means the seed dropped it.
    // ('none' with no runs is the legacy-inert shape — fine.)
    if (!g && t.governingVariant && t.governingVariant !== NONE_VARIANT_KEY) {
      badGoverningKey.push(`${t.id}:field=${t.governingVariant} but no governing run`);
    }
    const runKeys = runs.map((r) => r.variantKey).sort();
    const listed = [...(t.variantKeys ?? [])].sort();
    if (JSON.stringify(runKeys) !== JSON.stringify(listed)) keysMismatch.push(t.id);
  }

  check('all seeded run keys parse or are legacy none', badRuns.length === 0, badRuns);
  check('no trade has more than one governing run', multiGoverning.length === 0, multiGoverning);
  check('governing keys are terminal or legacy none', badGoverningKey.length === 0, badGoverningKey);
  check('terminal trades carry no ACTIVE runs', activeOnTerminal.length === 0, activeOnTerminal);
  check('variantKeys mirror variantRuns', keysMismatch.length === 0, keysMismatch);
}

// ── 2. Instance-resolution round trips ──────────────────────────────────────

async function verifyInstanceSeeding(firestoreDb: Firestore): Promise<void> {
  const rawQuote = { date: TODAY, rawResponse: { verify: true } };
  const positionBase = {
    instanceId: '',
    symbol: 'QQQM',
    status: PositionStatus.OPEN,
    premiumCollected: 100,
    capitalRequired: 50_000,
    openDate: TODAY,
    currentValue: 100,
    currentValueAsOf: new Date().toISOString(),
    unrealizedPnl: 0,
  };

  const cases: Array<{ inst: string; pos: string; gv: string; expect: string }> = [
    { inst: INST_T15, pos: POS_TRAILING, gv: 'trailing-15', expect: 'trailing-15' },
    { inst: INST_TIME, pos: POS_NONTERMINAL, gv: 'time-30d', expect: DEFAULT_TRAILING_STOP_KEY },
    { inst: INST_NONE, pos: POS_NONE, gv: NONE_VARIANT_KEY, expect: DEFAULT_TRAILING_STOP_KEY },
  ];
  for (const c of cases) {
    await paperItemsRef(firestoreDb, PaperTradingKind.INSTANCE)
      .doc(c.inst)
      .set(scratchInstance(c.inst, c.gv));
    await createPosition(
      { ...positionBase, instanceId: c.inst },
      [scratchLeg()],
      rawQuote,
      c.pos,
    );
    const trade = await getTrade(firestoreDb, c.pos);
    const runs = trade?.variantRuns ?? [];
    check(
      `instance '${c.gv}' seeds '${c.expect}' as the single governing run`,
      trade?.governingVariant === c.expect &&
        runs.length === 1 &&
        runs[0].variantKey === c.expect &&
        runs[0].governing === true &&
        runs[0].state === 'ACTIVE',
      { governing: trade?.governingVariant, runs },
    );
  }
}

// ── 3. Seed guards ──────────────────────────────────────────────────────────

async function verifySeedGuards(firestoreDb: Firestore): Promise<void> {
  const deps = ledgerDeps(firestoreDb);
  const baseInput = {
    userId: USER_ID,
    tradeId: 'verify-669-guard',
    order: { side: TradeSide.SHORT, type: 'MARKET', quantity: 1 },
    dims: {
      source: PaperTradeSource.SIGNAL,
      symbol: 'QQQM',
      expression: 'CSP',
      governingVariant: 'x',
      variantKeys: [] as string[],
    },
    now: new Date().toISOString(),
  };

  for (const gv of [NONE_VARIANT_KEY, 'time-30d', 'bogus', 'trailing-0', 'trailing-150']) {
    try {
      await createPendingTrade(
        { ...baseInput, tradeId: `verify-669-guard-${gv}`, dims: { ...baseInput.dims, governingVariant: gv, variantKeys: [gv] } },
        deps,
      );
      check(`governing '${gv}' rejected`, false, 'no error thrown');
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      check(`governing '${gv}' rejected`, /terminal|recognized/i.test(msg), msg);
    }
    const leaked = await getTrade(firestoreDb, `verify-669-guard-${gv}`);
    check(`no doc written for rejected '${gv}'`, !leaked, leaked?.id);
  }

  try {
    await createPendingTrade(
      { ...baseInput, tradeId: 'verify-669-guard-vk', dims: { ...baseInput.dims, governingVariant: DEFAULT_TRAILING_STOP_KEY, variantKeys: ['garbage'] } },
      deps,
    );
    check("unparseable variantKeys rejected", false, 'no error thrown');
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    check("unparseable variantKeys rejected", /recognized/i.test(msg), msg);
  }
  const leakedVk = await getTrade(firestoreDb, 'verify-669-guard-vk');
  check("no doc written for rejected variantKeys", !leakedVk, leakedVk?.id);
}

// ── 4. Cancel path ──────────────────────────────────────────────────────────

async function verifyCancelPath(firestoreDb: Firestore): Promise<void> {
  const deps = ledgerDeps(firestoreDb);
  await createPendingTrade(
    {
      userId: USER_ID,
      tradeId: PENDING_ID,
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
  const seeded = await getTrade(firestoreDb, PENDING_ID);
  check(
    'pending trade seeded with one ACTIVE governing run',
    seeded?.status === PaperTradeStatus.PENDING &&
      seeded.variantRuns.length === 1 &&
      seeded.variantRuns[0].governing &&
      seeded.variantRuns[0].state === 'ACTIVE',
    seeded?.variantRuns,
  );

  const handlerDeps = {
    getTrade: (id: string) => getTrade(firestoreDb, id),
    cancelPendingTrade: (input: Parameters<typeof cancelPendingTrade>[0]) =>
      cancelPendingTrade(input, deps),
    now: () => new Date(),
  };
  const res = await handleCancelPaperTrade(
    { auth: { uid: USER_ID }, data: { tradeId: PENDING_ID } },
    handlerDeps,
  );
  check('cancel returns the trade id', res.tradeId === PENDING_ID, res);
  const after = await getTrade(firestoreDb, PENDING_ID);
  check(
    'cancelled trade carries no ACTIVE runs',
    after?.status === PaperTradeStatus.CANCELLED &&
      (after.variantRuns ?? []).every((r) => r.state === 'EXITED'),
    after?.status,
  );
}

// ── 5. Close-path guards (no RH creds — guards precede the quote fetch) ─────

async function verifyCloseGuards(firestoreDb: Firestore): Promise<void> {
  const closeDeps = {
    getTrade: (id: string) => getTrade(firestoreDb, id),
    getOptionQuotes: async () => {
      throw new Error('should not reach quotes in guard checks');
    },
    callTool: async () => {
      throw new Error('should not reach callTool in guard checks');
    },
    applyExitFill: async () => {
      throw new Error('should not reach applyExitFill in guard checks');
    },
    updateRun: async () => {
      throw new Error('should not reach updateRun in guard checks');
    },
    now: () => new Date(),
  };

  try {
    await handleClosePaperTrade(
      { auth: { uid: USER_ID }, data: { tradeId: 'verify-669-nonexistent' } },
      closeDeps,
    );
    check('close missing trade → not-found', false, 'no error thrown');
  } catch (err) {
    check(
      'close missing trade → not-found',
      err instanceof HttpsError && err.code === 'not-found',
      err,
    );
  }

  try {
    await handleClosePaperTrade(
      { auth: { uid: USER_ID }, data: { tradeId: PENDING_ID } },
      closeDeps,
    );
    check('close CANCELLED trade → failed-precondition', false, 'no error thrown');
  } catch (err) {
    check(
      'close CANCELLED trade → failed-precondition',
      err instanceof HttpsError && err.code === 'failed-precondition',
      err,
    );
  }
}

// ── Run ─────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  await cleanup(db);
  await auditProdTrades(db);
  await verifyInstanceSeeding(db);
  await verifySeedGuards(db);
  await verifyCancelPath(db);
  await verifyCloseGuards(db);
}

async function verifyDeleted(firestoreDb: Firestore): Promise<boolean> {
  const tradeIds = [
    POS_TRAILING, POS_NONTERMINAL, POS_NONE, PENDING_ID,
    ...['none', 'time-30d', 'bogus', 'trailing-0', 'trailing-150', 'vk'].map(
      (s) => `verify-669-guard-${s}`,
    ),
  ];
  const paths = [
    ...tradeIds.map((id) => `paper-trading/trades/items/${id}`),
    `paper-trading/instances/items/${INST_T15}`,
    `paper-trading/instances/items/${INST_TIME}`,
    `paper-trading/instances/items/${INST_NONE}`,
    `paper-trading/accounts/items/${ACCOUNT_ID}`,
    ...[INST_T15, INST_TIME, INST_NONE].flatMap((i) => [
      `paper-trading/stats/items/stats-inst-${i}`,
      `paper-trading/stats/items/stats-${i}`,
    ]),
  ];
  const survivors: string[] = [];
  for (const p of paths) {
    // A failed read is NOT a successful delete — count it as suspect.
    const snap = await firestoreDb.doc(p).get().catch((e) => {
      survivors.push(`${p} (read error: ${e instanceof Error ? e.message : e})`);
      return null;
    });
    if (snap?.exists) survivors.push(p);
  }
  // Raw quotes — written per createPosition id; a swallowed batch commit
  // must not leave orphans undetected.
  const rq = await paperItemsRef(firestoreDb, PaperTradingKind.RAW_QUOTE)
    .where('tradeId', 'in', [POS_TRAILING, POS_NONTERMINAL, POS_NONE, PENDING_ID])
    .get()
    .catch((e) => {
      survivors.push(`raw-quotes query failed: ${e instanceof Error ? e.message : e}`);
      return null;
    });
  rq?.docs.forEach((d) => survivors.push(d.ref.path));
  if (survivors.length) {
    failed++;
    console.log('FAIL post-cleanup survivors — delete manually:', survivors);
    return false;
  }
  return true;
}

main()
  .catch((err) => {
    failed++;
    console.log('FAIL unhandled', err);
  })
  .finally(async () => {
    try {
      await cleanup(db);
      if (await verifyDeleted(db)) {
        console.log('cleanup: docs removed (verified)');
      }
    } catch (e) {
      failed++;
      console.log('cleanup failed:', e);
    }
    console.log(`\n${passed} passed, ${failed} failed`);
    process.exit(failed > 0 ? 1 : 0);
  });
