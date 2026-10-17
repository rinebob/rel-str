/**
 * Read-only canonical-shape audit for #1002 — scans `st-order-tickets` and
 * verifies every doc conforms to the canonical contract from #998/#999:
 *
 *   FAIL (drives exit 1):
 *   - id prefix contradicts mode (liv_ must be 'live', pap_ 'paper')
 *   - missing/invalid required axes: origin.type ∉ {signal, program,
 *     manual, management}, auto non-boolean, state ∉ ST_TICKET_STATES,
 *     refId/accountTarget/userId/createdAt/updatedAt absent or non-string
 *   - terms fail validateStTicketTerms (quantity/dollarAmount rule)
 *   - state/field incoherence: filled without fillSummary+filledAt,
 *     submitted/cancel_pending/filled/cancelled/expired without
 *     submittedAt, cancelled without cancelledAt+terminalAt,
 *     failed without lastError+terminalAt, staged carrying terminal fields
 *
 *   WARN (reported, does not fail):
 *   - origin axis without its linkage field (signal w/o signalId,
 *     program w/o instanceId, management w/o positionGroupId)
 *   - live ticket without brokerOrderId past 'staged' (may be a pending
 *     submit — the audit can't age it)
 *   - filledAt < submittedAt ordering inversion
 *
 * An empty collection is expected until post-deploy traffic emits
 * tickets — reported, not failed.
 *
 * Usage (from functions/):
 *   npx tsx scripts/verify/data-pipeline-st-order-tickets-1002.ts
 *
 * Read-only — never writes. Exit 0 on clean audit; nonzero on any FAIL.
 */
import { db } from '../../src/firebase-admin-init';
import { ST_ORDER_TICKETS_ROOT } from '../../src/common/st-collections';
import {
  ST_TICKET_ORIGIN_TYPES,
  ST_TICKET_STATES,
  validateStTicketTerms,
  type StOrderTicket,
  type StTicketOriginType,
  type StTicketState,
} from '../../../shared/st-order-tickets';

interface Finding {
  tier: 'FAIL' | 'WARN';
  docId: string;
  detail: string;
}

const findings: Finding[] = [];
const fail = (docId: string, detail: string) => findings.push({ tier: 'FAIL', docId, detail });
const warn = (docId: string, detail: string) => findings.push({ tier: 'WARN', docId, detail });

const isStr = (v: unknown): v is string => typeof v === 'string' && v.length > 0;

/**
 * States that imply broker submission — submittedAt is required here for
 * EVERY mode: submitted/cancel_pending are only reachable via
 * markSubmitted, so any ticket in these states was submitted by definition.
 * Terminal states (filled/cancelled/expired) are different: live tickets
 * pass through submission, but paper tickets transition staged→filled /
 * staged→cancelled directly — requiring submittedAt there would fail
 * every correctly-emitted paper ticket.
 */
const POST_SUBMISSION_STATES: readonly StTicketState[] = [
  'submitted', 'cancel_pending',
];

const TERMINAL_OR_SUBMITTED: ReadonlySet<StTicketState> = new Set([
  ...POST_SUBMISSION_STATES, 'filled', 'cancelled', 'expired',
]);

const ORIGIN_LINKAGE: Record<StTicketOriginType, keyof StOrderTicket['origin'] | null> = {
  signal: 'signalId',
  program: 'instanceId',
  management: 'positionGroupId',
  manual: null,
};

function auditDoc(docId: string, d: StOrderTicket): void {
  const prefix = docId.startsWith('liv_') ? 'liv_' : docId.startsWith('pap_') ? 'pap_' : null;
  if (!prefix) {
    fail(docId, `doc id lacks the liv_/pap_ mode prefix`);
    return;
  }
  const expectedMode = prefix === 'liv_' ? 'live' : 'paper';
  if (d.mode !== expectedMode) {
    fail(docId, `mode '${d.mode}' contradicts id prefix '${prefix}' (expected '${expectedMode}')`);
  }

  if (!d.origin || !ST_TICKET_ORIGIN_TYPES.includes(d.origin.type)) {
    fail(docId, `origin.type '${d.origin?.type}' not in ${ST_TICKET_ORIGIN_TYPES.join('|')}`);
  } else {
    const link = ORIGIN_LINKAGE[d.origin.type];
    if (link && !isStr(d.origin[link])) {
      warn(docId, `origin.type '${d.origin.type}' without origin.${link}`);
    }
  }
  if (typeof d.auto !== 'boolean') fail(docId, 'auto missing or non-boolean');
  if (!ST_TICKET_STATES.includes(d.state)) {
    fail(docId, `state '${d.state}' not in ${ST_TICKET_STATES.join('|')}`);
  }
  if (!d.terms) {
    fail(docId, 'terms missing');
  } else {
    try {
      validateStTicketTerms(d.terms);
    } catch (err) {
      fail(docId, `terms invalid: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  for (const f of ['refId', 'accountTarget', 'userId', 'createdAt', 'updatedAt'] as const) {
    if (!isStr(d[f])) fail(docId, `${f} missing or empty`);
  }

  const state = d.state;
  if (state === 'filled' && (!d.fillSummary || !isStr(d.filledAt))) {
    // Migrated legacy docs may genuinely lack fill data (the FE didn't
    // always persist result.fillPrice) — flagged WARN, not FAIL (#1003).
    if (d.migratedFrom) {
      warn(docId, `migrated '${d.migratedFrom}' ticket 'filled' without fillSummary/filledAt — legacy doc never captured fill data`);
    } else {
      fail(docId, `state 'filled' without fillSummary/filledAt`);
    }
  }
  if (state === 'cancelled' && (!isStr(d.cancelledAt) || !isStr(d.terminalAt))) {
    fail(docId, `state 'cancelled' without cancelledAt/terminalAt`);
  }
  if (state === 'failed' && (!d.lastError || !isStr(d.terminalAt))) {
    fail(docId, `state 'failed' without lastError/terminalAt`);
  }
  if (state === 'staged' && (d.fillSummary || d.lastError || d.terminalAt)) {
    fail(docId, `state 'staged' carrying terminal fields`);
  }
  if (POST_SUBMISSION_STATES.includes(state) && !isStr(d.submittedAt)) {
    fail(docId, `state '${state}' without submittedAt`);
  }
  // Live tickets reach terminal states only via submission; paper tickets
  // can go staged→terminal directly (no broker hop → no submittedAt).
  if (d.mode === 'live' && TERMINAL_OR_SUBMITTED.has(state) && !isStr(d.submittedAt)) {
    fail(docId, `live ticket '${state}' without submittedAt (submission precedes fill/cancel)`);
  }
  if (
    d.mode === 'live' &&
    POST_SUBMISSION_STATES.includes(state) &&
    !isStr(d.brokerOrderId)
  ) {
    warn(docId, `live ticket '${state}' without brokerOrderId`);
  }
  if (isStr(d.submittedAt) && isStr(d.filledAt) && d.filledAt < d.submittedAt) {
    warn(docId, `filledAt (${d.filledAt}) precedes submittedAt (${d.submittedAt})`);
  }
}

async function main(): Promise<void> {
  const snap = await db.collection(ST_ORDER_TICKETS_ROOT).get();
  console.log(`st-order-tickets audit: ${snap.size} doc(s)`);
  if (snap.size === 0) {
    console.log('EMPTY — no tickets emitted yet (expected until post-deploy traffic)');
  }
  for (const doc of snap.docs) {
    auditDoc(doc.id, doc.data() as StOrderTicket);
  }

  const fails = findings.filter((f) => f.tier === 'FAIL');
  const warns = findings.filter((f) => f.tier === 'WARN');
  for (const f of findings) {
    console.log(`${f.tier} ${f.docId}: ${f.detail}`);
  }
  console.log(`\n${fails.length} FAIL / ${warns.length} WARN across ${snap.size} doc(s)`);
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
