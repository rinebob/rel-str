/**
 * Read-only parity audit for #1003 — verifies the order-intents →
 * st-order-tickets migration: every legacy `savant-trader/data/order-intents`
 * doc must have a canonical counterpart carrying the mapped contract.
 *
 *   FAIL (drives exit 1):
 *   - mappable legacy doc with no `{liv|pap}_{id}` counterpart
 *   - refId not preserved verbatim (the RH idempotency key)
 *   - origin.type contradicts mapOrderSourceToOriginType(legacy.source)
 *   - mode contradicts the id prefix, or state contradicts the mapped
 *     status (paper-settled terminal states are legal: a paper intent
 *     whose linked trade closed may read 'filled'/'cancelled'/'expired')
 *   - terms.symbol/side drift from the legacy doc
 *   - legacy tracking fields not nested under ticket.tracking
 *   - accountTarget/userId/createdAt drift
 *
 *   WARN (reported, does not fail):
 *   - legacy doc the mapper marks malformed (skipped by design — each
 *     is listed so the tally can't hide a real gap)
 *   - canonical doc with no legacy parent (post-#1002 emissions —
 *     expected, informational)
 *   - legacy doc still carrying fields the canonical model drops
 *     (sourceRef on non-management tickets, status enum leftovers)
 *
 * Usage (from functions/):
 *   npx tsx scripts/verify/data-pipeline-st-order-tickets-migration-1003.ts
 *
 * Read-only — never writes. Exit 0 on clean audit; nonzero on any FAIL.
 */
import { db } from '../../src/firebase-admin-init';
import {
  ST_ORDER_INTENTS_COLLECTION,
  ST_ORDER_TICKETS_ROOT,
} from '../../src/common/st-collections';
import {
  mapLegacyTicketStatus,
  mapOrderSourceToOriginType,
  type StOrderTicket,
} from '../../../shared/st-order-tickets';
import {
  deepEqual,
  legacyIntentToTicket,
  TERMINAL_STATES,
  type LegacyIntentMapResult,
} from '../../src/order-tickets/legacy-order-intents';

interface Finding {
  tier: 'FAIL' | 'WARN';
  docId: string;
  detail: string;
}

const findings: Finding[] = [];
const fail = (docId: string, detail: string) => findings.push({ tier: 'FAIL', docId, detail });
const warn = (docId: string, detail: string) => findings.push({ tier: 'WARN', docId, detail });

const isStr = (v: unknown): v is string => typeof v === 'string' && v.length > 0;

/** States a paper ticket may hold post-settle — the linked trade's
 *  lifecycle decides (paperTradeStateSettle). */
const SETTLED_PAPER_STATES = new Set(['submitted', 'filled', 'cancelled', 'expired']);

const TRACKING_KEYS = ['role', 'linkedPositionId', 'signalId', 'lastSeenState', 'capturedEvents'] as const;

function auditPair(
  intentId: string,
  legacy: Record<string, unknown>,
  mapped: LegacyIntentMapResult,
  ticket: StOrderTicket | null,
): void {
  const statusMap = mapLegacyTicketStatus(isStr(legacy.status) ? legacy.status : undefined);
  const originType = mapOrderSourceToOriginType(isStr(legacy.source) ? legacy.source : undefined);
  if (!mapped.ticket || !statusMap || !originType) {
    warn(intentId, `legacy doc unmappable (${(mapped.malformed ?? ['unknown']).join('; ')}) — migration skips by design`);
    return;
  }
  if (!ticket) {
    fail(intentId, `mappable legacy doc has no canonical ${mapped.ticket.id} counterpart`);
    return;
  }

  const docId = ticket.id;
  const prefix = statusMap.mode === 'live' ? 'liv_' : 'pap_';
  if (!docId.startsWith(prefix)) fail(docId, `doc id lacks expected '${prefix}' prefix`);
  if (ticket.mode !== statusMap.mode) fail(docId, `mode '${ticket.mode}' ≠ mapped '${statusMap.mode}'`);

  // State: live must match the mapper exactly except mirror-legal
  // suppression (canonical terminal + mapped non-terminal, or a canonical
  // fill beating a legacy cancel/expire — the trigger's terminal-wins
  // doctrine); paper may hold any settle outcome (linked trade decides).
  if (statusMap.mode === 'live' && ticket.state !== statusMap.state) {
    // Same doctrine as suppressTerminalRegression: canonical terminal under
    // a non-terminal rewrite, or canonical 'filled' under ANY non-filled
    // rewrite (fill always wins — incl. a legacy 'failed' rewrite).
    const suppressed =
      (TERMINAL_STATES.has(ticket.state) && !TERMINAL_STATES.has(statusMap.state))
      || (ticket.state === 'filled' && statusMap.state !== 'filled');
    const detail = `state '${ticket.state}' ≠ mapped '${statusMap.state}' (legacy '${String(legacy.status)}')`;
    if (suppressed) warn(docId, `${detail} — terminal suppression, legal during soak`);
    else fail(docId, detail);
  }
  if (statusMap.mode === 'paper' && !SETTLED_PAPER_STATES.has(ticket.state)) {
    fail(docId, `paper state '${ticket.state}' outside the settle set ${[...SETTLED_PAPER_STATES].join('|')}`);
  }

  if (ticket.refId !== (isStr(legacy.refId) ? legacy.refId : intentId)) {
    fail(docId, `refId '${ticket.refId}' ≠ legacy '${String(legacy.refId)}' — idempotency key not preserved`);
  }
  if (ticket.origin?.type !== originType) {
    fail(docId, `origin.type '${ticket.origin?.type}' ≠ mapped '${originType}' (legacy source '${String(legacy.source)}')`);
  }
  // Whole-terms compare against the mapper's output — covers symbol/side
  // plus quantity/dollarAmount/instrument/orderType in one structural diff.
  if (!deepEqual(ticket.terms, mapped.ticket.terms)) {
    fail(docId, `terms drift — mapped ${JSON.stringify(mapped.ticket.terms)} vs stored ${JSON.stringify(ticket.terms)}`);
  }
  if (ticket.accountTarget !== legacy.accountNumber) fail(docId, `accountTarget '${ticket.accountTarget}' ≠ '${String(legacy.accountNumber)}'`);
  if (ticket.userId !== legacy.userId) fail(docId, `userId '${ticket.userId}' ≠ '${String(legacy.userId)}'`);
  if (ticket.createdAt !== legacy.createdAt) fail(docId, `createdAt '${ticket.createdAt}' ≠ '${String(legacy.createdAt)}'`);

  // Tracking fields must survive under ticket.tracking.
  const tracking = (ticket.tracking ?? {}) as Record<string, unknown>;
  for (const k of TRACKING_KEYS) {
    const lv = legacy[k];
    if (lv !== undefined && !deepEqual(tracking[k], lv)) {
      fail(docId, `tracking.${k} not preserved (legacy ${JSON.stringify(lv)} → ${JSON.stringify(tracking[k])})`);
    }
  }

  // Signal lineage: decisionIds must survive via signalContext.
  const sc = legacy.signalContext as Record<string, unknown> | undefined;
  if (sc?.decisionId && ticket.signalContext?.decisionId !== sc.decisionId) {
    fail(docId, `signalContext.decisionId not preserved`);
  }

  // sourceRef lineage: management tickets carry it as positionGroupId;
  // signal tickets survive via signalContext.decisionId(s). Any other
  // sourceRef is a dropped link — surfaced, not failed.
  const sourceRef = legacy.sourceRef as Record<string, unknown> | undefined;
  if (isStr(sourceRef?.id) && originType === 'management' && ticket.origin?.positionGroupId !== sourceRef.id) {
    fail(docId, `management sourceRef '${sourceRef.id}' not carried to origin.positionGroupId`);
  }
  if (
    isStr(sourceRef?.id) && originType !== 'management'
    && sourceRef.id !== sc?.decisionId
    && !(Array.isArray(sc?.decisionIds) && (sc.decisionIds as unknown[]).includes(sourceRef.id))
  ) {
    warn(docId, `sourceRef ${sourceRef.type}:${sourceRef.id} not represented on the canonical doc`);
  }
}

async function main(): Promise<void> {
  const [intentSnap, ticketSnap] = await Promise.all([
    db.collection(ST_ORDER_INTENTS_COLLECTION).get(),
    db.collection(ST_ORDER_TICKETS_ROOT).get(),
  ]);
  console.log(`order-intents parity audit: ${intentSnap.size} legacy / ${ticketSnap.size} canonical`);

  const byId = new Map(ticketSnap.docs.map((d) => [d.id, d.data() as StOrderTicket]));
  const claimed = new Set<string>();

  for (const doc of intentSnap.docs) {
    const legacy = doc.data() as Record<string, unknown>;
    const mapped = legacyIntentToTicket(doc.id, legacy);
    const ticket = mapped.ticket ? byId.get(mapped.ticket.id) ?? null : null;
    if (ticket) claimed.add(ticket.id);
    auditPair(doc.id, legacy, mapped, ticket);
  }

  for (const id of byId.keys()) {
    if (!claimed.has(id)) {
      warn(id, 'canonical ticket with no legacy parent (post-#1002 emission or pruned intent)');
    }
  }

  const fails = findings.filter((f) => f.tier === 'FAIL');
  const warns = findings.filter((f) => f.tier === 'WARN');
  for (const f of findings) {
    console.log(`${f.tier} ${f.docId}: ${f.detail}`);
  }
  console.log(`\n${fails.length} FAIL / ${warns.length} WARN across ${intentSnap.size} legacy doc(s)`);
  if (fails.length > 0) {
    process.exitCode = 1;
  } else {
    console.log('AUDIT PASS');
  }
}

main().catch((err) => {
  console.error(`audit crashed: ${err instanceof Error ? err.message : String(err)}`);
  process.exitCode = 1;
});
