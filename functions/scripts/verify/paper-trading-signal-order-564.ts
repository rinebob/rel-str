/**
 * @topic #553 — Paper Trading Infra (task #564)
 *
 * Real-environment verification of the signal→paper path on prod:
 *
 *   1. Seeds a real order-ticket doc (savant-trader/data/order-intents).
 *   2. Runs `handlePaperSignalOrder` with production deps + the real RH MCP
 *      observation tool — equity trade filled at the live acceptance quote,
 *      cohort doc, PENDING expression trades seeded.
 *   3. Runs `runExpressionFillPass` — real chains → instruments → quotes →
 *      delta/DTE selection → applyPendingFill → OPEN (or a documented skip
 *      when no contract is selectable).
 *   4. Asserts no place_\* / review_\* tool calls occurred anywhere.
 *
 * Requires ADC + local RH MCP OAuth + NODE_OPTIONS ipv4 preload.
 * Run from functions/:
 *   npx tsx scripts/verify/paper-trading-signal-order-564.ts
 */

import { db } from '../../src/firebase-admin-init';
import { TradeSide } from '../../../shared/common';
import {
  PaperAccount,
  PaperCohort,
  PaperTrade,
  PaperTradeStatus,
  SIGNAL_EXPRESSION_TEMPLATES,
} from '../../../shared/paper-trading-contracts';
import { buildAccountId } from '../../../shared/paper-trading-ids';
import { executeObservationTool } from '../../src/rh-agent-mcp/tools/robinhood-tool-executor';
import {
  handlePaperSignalOrder,
  paperSignalOrderProdDeps,
} from '../../src/paper-trading/callables';
import { applyPendingFill } from '../../src/paper-trading/ledger';
import { ledgerDeps, listTrades } from '../../src/paper-trading/repository';
import { ST_ORDER_INTENTS_COLLECTION } from '../../src/common/st-collections';
import { getMarketDatePT } from '../../src/common/pt-date-utils';
import { runExpressionFillPass } from '../../src/paper-trading/passes/expression-fill-pass';

const PREFIX = 'verify-564';
const USER_ID = `${PREFIX}-user`;
const TICKET_ID = `${PREFIX}-ticket`;
const REF_ID = `${PREFIX}-ref`;
const SIGNAL_ID = `${PREFIX}-sig`;
const SYMBOL = 'QQQM';

let passed = 0;
let failed = 0;
function check(name: string, cond: boolean, detail?: string) {
  if (cond) { passed++; console.log(`OK   ${name}`); }
  else { failed++; console.log(`FAIL ${name}${detail ? ` — ${detail}` : ''}`); }
}

const mcpCalls: string[] = [];
async function realCallTool(name: string, args: Record<string, unknown>): Promise<unknown> {
  mcpCalls.push(name);
  const result = await executeObservationTool(name, args);
  if (!('success' in result) || !result.success) {
    throw new Error(`MCP ${name} failed: ${'error' in result ? result.error : 'unknown'}`);
  }
  return (result as { parsed?: unknown }).parsed ?? {};
}

// Production wiring — the same deps the onCall wrapper uses, parameterized
// on the real observation-tool caller so the verify exercises the actual path.
function callDeps() {
  return paperSignalOrderProdDeps(realCallTool);
}

async function seed(): Promise<void> {
  await db.doc(`${ST_ORDER_INTENTS_COLLECTION}/${TICKET_ID}`).set({
    id: TICKET_ID,
    refId: REF_ID,
    source: 'SIGNAL_PIPELINE',
    status: 'SUBMITTED',
    accountNumber: 'paper-verify',
    side: 'buy',
    orderType: 'market',
    timeInForce: 'gfd',
    marketHours: 'regular_hours',
    symbol: SYMBOL,
    quantity: '1',
    userId: USER_ID,
    signalContext: {
      signalType: 'verify-564',
      barDate: getMarketDatePT(),
      timeframe: 'D',
      direction: 'long',
      decisionId: `${PREFIX}-decision`,
    },
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });
  console.log(`seeded order ticket ${TICKET_ID}`);
}

async function cleanup(cohortIds: string[], tradeIds: string[]): Promise<void> {
  await db.doc(`${ST_ORDER_INTENTS_COLLECTION}/${TICKET_ID}`).delete().catch(() => undefined);
  for (const id of cohortIds) {
    await db.doc(`paper-trading/cohorts/items/${id}`).delete().catch(() => undefined);
  }
  for (const id of tradeIds) {
    await db.doc(`paper-trading/trades/items/${id}`).delete().catch(() => undefined);
  }
  // belt-and-suspenders: any verify-564 leftovers
  for (const anchor of ['cohorts', 'trades', 'accounts']) {
    const snap = await db.collection(`paper-trading/${anchor}/items`).get();
    const b = db.batch();
    for (const d of snap.docs) if (d.id.includes(PREFIX)) b.delete(d.ref);
    await b.commit();
  }
  await db
    .doc(`paper-trading/accounts/items/${buildAccountId(USER_ID)}`)
    .delete()
    .catch(() => undefined);
  console.log('cleanup: verification docs removed');
}

async function main(): Promise<void> {
  const cohortIds: string[] = [];
  const tradeIds: string[] = [];
  try {
    await seed();

    // ── 1. paperSignalOrder — real quote, real ledger ──
    const res = await handlePaperSignalOrder(
      {
        auth: { uid: USER_ID },
        data: {
          signalId: SIGNAL_ID,
          symbol: SYMBOL,
          direction: TradeSide.LONG,
          quantity: 1,
          refId: REF_ID,
        },
      },
      callDeps(),
    );

    // Idempotent retry — second call returns the same cohort, no new writes.
    const retry = await handlePaperSignalOrder(
      {
        auth: { uid: USER_ID },
        data: {
          signalId: SIGNAL_ID,
          symbol: SYMBOL,
          direction: TradeSide.LONG,
          quantity: 1,
          refId: REF_ID,
        },
      },
      callDeps(),
    );
    check('retry is idempotent — same cohort + trade ids, no duplication',
      retry.cohortId === res.cohortId &&
        retry.equityTradeId === res.equityTradeId &&
        retry.expressionTradeIds.length === res.expressionTradeIds.length);
    cohortIds.push(res.cohortId);
    tradeIds.push(res.equityTradeId, ...res.expressionTradeIds);

    const templates = SIGNAL_EXPRESSION_TEMPLATES[TradeSide.LONG];
    check('response: equity + one pending id per template',
      res.expressionTradeIds.length === templates.length);
    check('trade ids carry sig origin',
      [res.equityTradeId, ...res.expressionTradeIds].every((id) => id.includes('-sig-')));

    const eqTrade = (await db.doc(`paper-trading/trades/items/${res.equityTradeId}`).get()).data() as PaperTrade;
    check('equity trade: OPEN with entry fill at a real price',
      eqTrade.status === PaperTradeStatus.OPEN && eqTrade.fills.length === 1 && eqTrade.fills[0].price > 0);
    check('equity trade: share leg, sig provenance + cohort dim',
      eqTrade.legs[0]?.kind === 'share' &&
      eqTrade.signalId === SIGNAL_ID &&
      eqTrade.cohortId === res.cohortId);
    check('equity trade: userId + variant runs seeded (none governs)',
      eqTrade.userId === USER_ID &&
      eqTrade.variantRuns.length === 4 &&
      eqTrade.variantRuns.filter((r) => r.governing).length === 1 &&
      eqTrade.variantRuns.find((r) => r.governing)?.variantKey === 'none');

    const pendings = await Promise.all(
      res.expressionTradeIds.map(
        async (id) => (await db.doc(`paper-trading/trades/items/${id}`).get()).data() as PaperTrade,
      ),
    );
    check('pending trades: all PENDING with templates, no fills/legs',
      pendings.length === templates.length &&
      pendings.every(
        (t) =>
          t.status === PaperTradeStatus.PENDING &&
          !!t.expressionTemplate &&
          t.fills.length === 0 &&
          t.legs.length === 0 &&
          t.cohortId === res.cohortId,
      ));
    check('pending templates match direction config',
      JSON.stringify(pendings.map((t) => t.expressionTemplate!.key).sort()) ===
        JSON.stringify(templates.map((t) => t.key).sort()));

    const cohort = (await db.doc(`paper-trading/cohorts/items/${res.cohortId}`).get()).data() as PaperCohort;
    check('cohort: groups all member trades + template keys',
      cohort.signalId === SIGNAL_ID &&
      cohort.direction === TradeSide.LONG &&
      cohort.tradeIds.length === 1 + templates.length &&
      cohort.expressionTemplates.length === templates.length);

    const acct = (await db.doc(`paper-trading/accounts/items/${buildAccountId(USER_ID)}`).get()).data() as PaperAccount;
    check('account: debited by equity fill, openTradeCount 1',
      acct.cash === -eqTrade.fills[0].price && acct.openTradeCount === 1);

    check('no broker mutation tools invoked on the accept path',
      mcpCalls.every((n) => !/place_|review_/.test(n)));

    // ── 2. expression-fill pass — real chains/instruments/quotes ──
    const marketDate = getMarketDatePT();
    const summary = await runExpressionFillPass(marketDate, {
      listPendingTrades: () =>
        listTrades(db, { status: PaperTradeStatus.PENDING }).then((ts) =>
          ts.filter((t) => t.userId === USER_ID),
        ),
      callTool: realCallTool,
      applyPendingFill: (input) => applyPendingFill(input, ledgerDeps(db)),
      now: () => new Date(),
    });
    console.log(`fill summary: filled=${summary.filled} skipped=${summary.skipped} errors=${summary.errors.length}`);
    check('fill pass: no errors', summary.errors.length === 0, JSON.stringify(summary.errors));
    check('fill pass: all pending accounted for (filled or skipped)',
      summary.filled + summary.skipped === templates.length);
    check('no broker mutation tools invoked on the fill path',
      mcpCalls.every((n) => !/place_|review_/.test(n)));

    if (summary.filled > 0) {
      const filled = (
        await Promise.all(
          res.expressionTradeIds.map(
            async (id) => (await db.doc(`paper-trading/trades/items/${id}`).get()).data() as PaperTrade,
          ),
        )
      ).find((t) => t.status === PaperTradeStatus.OPEN);
      check('filled expression: OPEN with real contract leg + entry fill',
        !!filled &&
          filled.legs[0]?.kind === 'option' &&
          !!filled.fills[0] &&
          filled.fills[0].price > 0);
    } else {
      console.log('WARN: no pending expression filled (market closed / no candidates?) — skip assertions bypassed');
    }

    check('no broker mutation tools anywhere in the run',
      mcpCalls.every((n) => !/place_|review_/.test(n)));
  } finally {
    await cleanup(cohortIds, tradeIds);
  }

  console.log(`\n=== ${passed} passed, ${failed} failed ===`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error('verification error:', err instanceof Error ? err.message : String(err));
  process.exit(1);
});
