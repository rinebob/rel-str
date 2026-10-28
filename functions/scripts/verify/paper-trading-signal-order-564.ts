/**
 * @topic #553 — Paper Trading Infra (task #564)
 *
 * Real-environment verification of the signal→paper path on prod:
 *
 *   1. Seeds a real order-ticket doc — canonical `st-order-tickets`
 *      post-#1003 (the reader is canonical-first; the legacy path remains
 *      as fallback).
 *   2. Runs `handlePaperSignalOrder` with production deps + the real RH MCP
 *      observation tool — equity trade filled at the live acceptance quote,
 *      cohort doc, STAGED expression tickets (no PENDING trades, #1005).
 *   3. Cancels one staged ticket via `handleCancelPaperTrade` — the ticket
 *      flips `cancelled`, no trade is involved (#1005).
 *   4. Runs `runExpressionFillPass` — real chains → instruments → quotes →
 *      delta/DTE selection → the remaining tickets MINT contract-bearing
 *      `{SYM}-{YYMMDD}-sig-{expr}-{exp}-{strike}-{NN}` trades → OPEN.
 *   5. Asserts no place_\* / review_\* tool calls occurred anywhere.
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
  PaperTradingKind,
  SIGNAL_EXPRESSION_TEMPLATES,
} from '../../../shared/paper-trading-contracts';
import { buildAccountId } from '../../../shared/paper-trading-ids';
import { paperItemsRef, paperTradingDocPathFor } from '../../src/paper-trading/collections';
import { executeObservationTool } from '../../src/rh-agent-mcp/tools/robinhood-tool-executor';
import {
  handleCancelPaperTrade,
  handlePaperSignalOrder,
  paperSignalOrderProdDeps,
} from '../../src/paper-trading/callables';
import { applyEntryFill, applyPendingFill, cancelPendingTrade } from '../../src/paper-trading/ledger';
import { getTrade, ledgerDeps, listTrades, listTradeDocIdsByPrefix } from '../../src/paper-trading/repository';
import { ledgerDepsWithCapture } from '../../src/paper-trading/screenshot-lifecycle';
import { StOrderTicketWriter } from '../../src/order-tickets/st-order-ticket-writer';
import { StPositionGroupWriter } from '../../src/position-groups/st-position-group-writer';
import { stTicketId } from '../../../shared/st-ids';
import type { StOrderTicket } from '../../../shared/st-order-tickets';
import { getStorage } from 'firebase-admin/storage';
import {
  ST_ORDER_TICKETS_ROOT,
  ST_POSITION_GROUPS_ROOT,
} from '../../src/common/st-collections';
import type { StPositionGroup } from '../../../shared/st-position-groups';
import { ST_SCREENSHOTS_COLLECTION } from '@screenshot-capture/contracts';
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
  // Canonical ticket doc (#1003 reader cutover) — the shape
  // StOrderTicketWriter/the migration emits.
  await db.doc(`${ST_ORDER_TICKETS_ROOT}/pap_${TICKET_ID}`).set({
    id: `pap_${TICKET_ID}`,
    origin: { type: 'signal', signalId: SIGNAL_ID },
    auto: true,
    mode: 'paper',
    terms: {
      symbol: SYMBOL,
      side: 'buy',
      instrument: 'equity',
      quantity: 1,
      orderType: 'market',
      timeInForce: 'gfd',
      marketHours: 'regular_hours',
    },
    state: 'submitted',
    refId: REF_ID,
    accountTarget: 'paper-verify',
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
    submittedAt: new Date().toISOString(),
  });
  console.log(`seeded canonical order ticket pap_${TICKET_ID}`);
}

async function cleanup(
  cohortIds: string[],
  tradeIds: string[],
  groupIds: string[] = [],
  ticketIds: string[] = [],
): Promise<void> {
  // #1004 — canonical group docs for the accept.
  for (const id of groupIds) {
    await db.doc(`${ST_POSITION_GROUPS_ROOT}/${id}`).delete().catch(() => undefined);
  }
  // Belt-and-suspenders: groups minted by this run's accepts share the
  // verify day+symbol — seq-scan can't see which are ours, so only the
  // tracked ids are removed above.
  const gSnap = await db.collection(ST_POSITION_GROUPS_ROOT).get().catch(() => null);
  for (const d of gSnap?.docs ?? []) {
    const g = d.data() as StPositionGroup;
    if (g.userId === USER_ID) await d.ref.delete().catch(() => undefined);
  }
  await db.doc(`${ST_ORDER_TICKETS_ROOT}/pap_${TICKET_ID}`).delete().catch(() => undefined);
  // Staged expression tickets + minted-trade tickets (#1005).
  for (const id of ticketIds) {
    await db.doc(`${ST_ORDER_TICKETS_ROOT}/${id}`).delete().catch(() => undefined);
  }
  // Legacy order-intents cleanup line removed in #1013 — collection retired.
  for (const id of cohortIds) {
    await db.doc(paperTradingDocPathFor(PaperTradingKind.COHORT, id)).delete().catch(() => undefined);
  }
  for (const id of tradeIds) {
    await db.doc(paperTradingDocPathFor(PaperTradingKind.TRADE, id)).delete().catch(() => undefined);
    // #1002 emission writes pap_{tradeId} tickets per action — drop them too
    // or the #1003 parity audit reports them as legacy-less canonical docs.
    await db.doc(`${ST_ORDER_TICKETS_ROOT}/pap_${id}`).delete().catch(() => undefined);
  }
  // belt-and-suspenders: any verify-564 leftovers
  for (const kind of [PaperTradingKind.COHORT, PaperTradingKind.TRADE, PaperTradingKind.ACCOUNT]) {
    const snap = await paperItemsRef(db, kind).get();
    const b = db.batch();
    for (const d of snap.docs) if (d.id.includes(PREFIX)) b.delete(d.ref);
    await b.commit();
  }
  await db
    .doc(paperTradingDocPathFor(PaperTradingKind.ACCOUNT, buildAccountId(USER_ID)))
    .delete()
    .catch(() => undefined);
  // Screenshot lifecycle: the equity fill's capture (wired via
  // ledgerDepsWithCapture) writes st-screenshots index docs + Storage
  // artifacts keyed by carrier.docPath — drop both or they accumulate.
  const bucket = getStorage().bucket('rel-str.appspot.com');
  for (const id of tradeIds) {
    const snap = await db
      .collection(ST_SCREENSHOTS_COLLECTION)
      .where('carrier.docPath', '==', paperTradingDocPathFor(PaperTradingKind.TRADE, id))
      .get()
      .catch(() => null);
    for (const d of snap?.docs ?? []) {
      const { svgPath, pngPath } = d.data() as { svgPath?: string; pngPath?: string };
      if (svgPath) await bucket.file(svgPath).delete().catch(() => undefined);
      if (pngPath) await bucket.file(pngPath).delete().catch(() => undefined);
      await d.ref.delete().catch(() => undefined);
    }
  }
  console.log('cleanup: verification docs removed');
}

async function main(): Promise<void> {
  const cohortIds: string[] = [];
  const tradeIds: string[] = [];
  const groupIds: string[] = [];
  const ticketIds: string[] = []; // pap_ docs beyond pap_{tradeId} (seeds, minted trades)
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
    tradeIds.push(res.equityTradeId);
    // expressionTradeIds are staged-TICKET seeds post-#1005 — the pap_
    // docs are the pending expressions; trades only exist after the fill pass.
    ticketIds.push(...res.expressionTradeIds.map((s) => stTicketId('paper', s)));

    const templates = SIGNAL_EXPRESSION_TEMPLATES[TradeSide.LONG];
    check('response: equity + one staged-ticket seed per template',
      res.expressionTradeIds.length === templates.length);
    check('ticket seeds carry sig origin',
      [res.equityTradeId, ...res.expressionTradeIds].every((id) => id.includes('-sig-')));

    const eqTrade = (await db.doc(paperTradingDocPathFor(PaperTradingKind.TRADE, res.equityTradeId)).get()).data() as PaperTrade;
    check('equity trade: OPEN with entry fill at a real price',
      eqTrade.status === PaperTradeStatus.OPEN && eqTrade.fills.length === 1 && eqTrade.fills[0].price > 0);
    check('equity trade: share leg, sig provenance + cohort dim',
      eqTrade.legs[0]?.kind === 'share' &&
      eqTrade.signalId === SIGNAL_ID &&
      eqTrade.cohortId === res.cohortId);
    check('equity trade: userId + single governing trailing-8 run (#652)',
      eqTrade.userId === USER_ID &&
      eqTrade.variantRuns.length === 1 &&
      eqTrade.variantRuns[0].governing === true &&
      eqTrade.variantRuns[0].variantKey === 'trailing-8');

    // #1005 — no PENDING trades; the staged pap_ tickets ARE the pending expressions.
    const stagedTickets = await Promise.all(
      res.expressionTradeIds.map(
        async (s) =>
          (await db.doc(`${ST_ORDER_TICKETS_ROOT}/${stTicketId('paper', s)}`).get()).data() as
            | StOrderTicket
            | undefined,
      ),
    );
    check('staged tickets: all staged with expressionTemplate recipes',
      stagedTickets.length === templates.length &&
      stagedTickets.every(
        (t) =>
          t?.state === 'staged' &&
          !!t.terms.expressionTemplate &&
          t.mode === 'paper' &&
          t.cohortId === res.cohortId,
      ));
    check('staged templates match direction config',
      JSON.stringify(stagedTickets.map((t) => t!.terms.expressionTemplate!.key).sort()) ===
        JSON.stringify(templates.map((t) => t.key).sort()));
    check('no PENDING expression trades written (seeds have no trade docs)',
      (
        await Promise.all(
          res.expressionTradeIds.map(
            async (s) => (await db.doc(paperTradingDocPathFor(PaperTradingKind.TRADE, s)).get()).exists,
          ),
        )
      ).every((exists) => !exists));

    const cohort = (await db.doc(paperTradingDocPathFor(PaperTradingKind.COHORT, res.cohortId)).get()).data() as PaperCohort;
    check('cohort: equity trade + template keys only (expressions are tickets)',
      cohort.signalId === SIGNAL_ID &&
      cohort.direction === TradeSide.LONG &&
      cohort.tradeIds.length === 1 &&
      cohort.tradeIds[0] === res.equityTradeId &&
      cohort.expressionTemplates.length === templates.length);

    // #1004 — canonical position group (dual-write alongside the cohort).
    check('response: canonical positionGroupId minted',
      typeof res.positionGroupId === 'string' && /-grp-\d{2,}$/.test(res.positionGroupId));
    if (res.positionGroupId) {
      groupIds.push(res.positionGroupId);
      check('retry returns the same positionGroupId', retry.positionGroupId === res.positionGroupId);
      const group = (await db.doc(`${ST_POSITION_GROUPS_ROOT}/${res.positionGroupId}`).get()).data() as StPositionGroup;
      check('group: paper mode + owning userId + open status',
        group.mode === 'paper' && group.userId === USER_ID && group.status === 'open');
      check('group: equity trade + all pap_ member tickets (expressions join at fill)',
        group.memberTradeIds.length === 1 &&
          group.memberTradeIds[0] === res.equityTradeId &&
          group.memberTicketIds.length === 1 + templates.length &&
          group.rollups.openCount === 1);
      check('equity trade stamped positionGroupId at mint',
        eqTrade.positionGroupId === res.positionGroupId);
      const memberTickets = await Promise.all(
        group.memberTicketIds.map(
          async (id) =>
            (await db.doc(`${ST_ORDER_TICKETS_ROOT}/${id}`).get()).data() as
              | { origin?: { positionGroupId?: string } }
              | undefined,
        ),
      );
      check('member tickets carry origin.positionGroupId',
        memberTickets.every((t) => t?.origin?.positionGroupId === res.positionGroupId));
    }

    const acct = (await db.doc(paperTradingDocPathFor(PaperTradingKind.ACCOUNT, buildAccountId(USER_ID))).get()).data() as PaperAccount;
    check('account: debited by equity fill, openTradeCount 1',
      acct.cash === -eqTrade.fills[0].price && acct.openTradeCount === 1);

    check('no broker mutation tools invoked on the accept path',
      mcpCalls.every((n) => !/place_|review_/.test(n)));

    // ── 2. cancel — the staged ticket is the pending expression (#1005) ──
    const cancelSeed = res.expressionTradeIds[0];
    const cancelRes = await handleCancelPaperTrade(
      { auth: { uid: USER_ID }, data: { tradeId: cancelSeed } },
      {
        getTrade: (tradeId) => getTrade(db, tradeId),
        cancelPendingTrade: (input) => cancelPendingTrade(input, ledgerDeps(db)),
        now: () => new Date(),
        tickets: new StOrderTicketWriter(),
        listTradesByTicketId: (ticketId) => listTrades(db, { ticketId }),
      },
    );
    check('cancel: resolves the staged ticket', cancelRes.tradeId === cancelSeed);
    const cancelledTicket = (
      await db.doc(`${ST_ORDER_TICKETS_ROOT}/${stTicketId('paper', cancelSeed)}`).get()
    ).data() as StOrderTicket;
    check('cancel: ticket flipped to cancelled, no trade minted',
      cancelledTicket.state === 'cancelled' &&
        !(await db.doc(paperTradingDocPathFor(PaperTradingKind.TRADE, cancelSeed)).get()).exists);
    const liveSeeds = res.expressionTradeIds.slice(1);

    // ── 3. expression-fill pass — staged tickets mint contract-bearing trades ──
    const marketDate = getMarketDatePT();
    const ticketsWriter = new StOrderTicketWriter();
    const summary = await runExpressionFillPass(marketDate, {
      listStagedExpressionTickets: () =>
        ticketsWriter.listStagedExpressionTickets().then((ts) =>
          ts.filter((t) => t.userId === USER_ID),
        ),
      listPendingTrades: () =>
        listTrades(db, { status: PaperTradeStatus.PENDING }).then((ts) =>
          ts.filter((t) => t.userId === USER_ID),
        ),
      getTrade: (tradeId) => getTrade(db, tradeId),
      listTradesByTicketId: (ticketId) => listTrades(db, { ticketId }),
      listTradeDocIdsByPrefix: (prefix) => listTradeDocIdsByPrefix(db, prefix),
      callTool: realCallTool,
      applyPendingFill: (input) => applyPendingFill(input, ledgerDeps(db)),
      applyEntryFill: (input) => applyEntryFill(input, ledgerDepsWithCapture(db)),
      getTicket: (ticketId) => ticketsWriter.get(ticketId),
      recordTicketError: (ticketId, error, now) => ticketsWriter.noteError(ticketId, error, now),
      markTicketFilled: (ticketId, fill, now) => ticketsWriter.markFilled(ticketId, fill, now),
      markTicketCancelled: (ticketId, now) => ticketsWriter.markCancelled(ticketId, now),
      groups: new StPositionGroupWriter(),
      now: () => new Date(),
    });
    console.log(`fill summary: filled=${summary.filled} skipped=${summary.skipped} errors=${summary.errors.length}`);
    check('fill pass: no errors', summary.errors.length === 0, JSON.stringify(summary.errors));
    check('fill pass: all live seeds accounted for (filled or skipped)',
      summary.filled + summary.skipped === liveSeeds.length);
    check('no broker mutation tools invoked on the fill path',
      mcpCalls.every((n) => !/place_|review_/.test(n)));

    if (summary.filled > 0) {
      // Minted trades are discovered via the ticket.ticketId back-stamp —
      // canonical ids ({SYM}-{YYMMDD}-sig-{expr}-{exp}-{strike}-{NN}) only
      // exist after contract resolution.
      const minted = (
        await Promise.all(liveSeeds.map((s) => listTrades(db, { ticketId: stTicketId('paper', s) })))
      ).flat();
      tradeIds.push(...minted.map((t) => t.id));
      const filled = minted.find((t) => t.status === PaperTradeStatus.OPEN);
      check('minted expression trade: OPEN with real contract leg + entry fill',
        !!filled &&
          filled.legs[0]?.kind === 'option' &&
          !!filled.fills[0] &&
          filled.fills[0].price > 0);
      check('minted trade: canonical contract-bearing id + lineage stamps',
        !!filled &&
          new RegExp(`^${SYMBOL}-\\d{6}-sig-[A-Z]+-\\d{6}-[\\d.]+-\\d{2,}$`).test(filled.id) &&
          !!filled.strike && !!filled.expiration && !!filled.optionType &&
          filled.cohortId === res.cohortId &&
          filled.positionGroupId === res.positionGroupId &&
          !!filled.ticket?.ticketId);
      const filledTicket = (
        await db.doc(`${ST_ORDER_TICKETS_ROOT}/${filled?.ticket?.ticketId}`).get()
      ).data() as StOrderTicket | undefined;
      check('source ticket marked filled', filledTicket?.state === 'filled');
      if (res.positionGroupId) {
        const groupAfter = (
          await db.doc(`${ST_POSITION_GROUPS_ROOT}/${res.positionGroupId}`).get()
        ).data() as StPositionGroup;
        check('minted trade joined the group (memberTradeIds + openCount)',
          minted.every((t) => groupAfter.memberTradeIds.includes(t.id)) &&
            groupAfter.rollups.openCount === 1 + minted.length);
      }
    } else {
      console.log('WARN: no staged expression filled (market closed / no candidates?) — skip assertions bypassed');
    }

    check('no broker mutation tools anywhere in the run',
      mcpCalls.every((n) => !/place_|review_/.test(n)));
  } finally {
    await cleanup(cohortIds, tradeIds, groupIds, ticketIds);
  }

  console.log(`\n=== ${passed} passed, ${failed} failed ===`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error('verification error:', err instanceof Error ? err.message : String(err));
  process.exit(1);
});
