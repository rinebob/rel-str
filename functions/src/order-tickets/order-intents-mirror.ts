/**
 * @topic #984 — ST Firestore Reorg (task #1003)
 *
 * `orderIntentsMirror` — soak-period dual-write for order tickets.
 *
 * During the #984 migration window the FE still writes
 * `savant-trader/data/order-intents` (#1015 re-points it). Every write is
 * re-mapped into `st-order-tickets` here, so new activity lands in both
 * collections without touching the FE. Deletes propagate to both
 * `{liv|pap}_` candidate ids.
 *
 * The upsert runs inside a transaction: the terminal-wins suppression
 * reads the canonical doc and writes in one atomic step, so a canonical
 * transition (writer `markFilled`, migration settle) racing a legacy
 * rewrite can't be clobbered by a stale read.
 *
 * Known soak-window limitations (accepted; the parity audit surfaces them):
 * - merge-only upserts don't propagate FE field deletions (deleteField) —
 *   a field deleted on the legacy doc stays on the canonical one.
 * - a legacy doc mirrored then edited into an unmappable state is skipped,
 *   leaving its last-good canonical mirror in place.
 *
 * Removed with the legacy collection in #1013.
 */
import { onDocumentWritten } from 'firebase-functions/v2/firestore';
import { logger as defaultLogger } from 'firebase-functions/v2';
import { db as defaultDb } from '../firebase-admin-init';
import {
  ST_ORDER_INTENTS_COLLECTION,
  ST_ORDER_TICKETS_ROOT,
} from '../common/st-collections';
import { stTicketId } from '@st/ids';
import type { StOrderTicket } from '@st/order-tickets';
import {
  legacyIntentToTicket,
  suppressTerminalRegression,
} from './legacy-order-intents';

/** Trigger path — the legacy anchored intent collection. */
export const MIRROR_ORDER_INTENTS_PATH = `${ST_ORDER_INTENTS_COLLECTION}/{intentId}`;

export interface MirrorOrderIntentDeps {
  db?: FirebaseFirestore.Firestore;
  logger?: Pick<typeof defaultLogger, 'warn' | 'error'>;
}

/**
 * Mirror one legacy intent write into `st-order-tickets`.
 * `after === null` means the legacy doc was deleted — both candidate
 * canonical ids are removed (mode isn't recoverable post-delete).
 *
 * Never throws — a mirror failure must not disturb the live legacy path.
 */
export async function mirrorOrderIntent(
  deps: MirrorOrderIntentDeps,
  intentId: string,
  after: Record<string, unknown> | null,
): Promise<'upserted' | 'deleted' | 'skipped'> {
  const db = deps.db ?? defaultDb;
  const logger = deps.logger ?? defaultLogger;
  const tickets = db.collection(ST_ORDER_TICKETS_ROOT);

  try {
    if (after === null) {
      const batch = db.batch();
      batch.delete(tickets.doc(stTicketId('live', intentId)));
      batch.delete(tickets.doc(stTicketId('paper', intentId)));
      await batch.commit();
      return 'deleted';
    }

    const mapped = legacyIntentToTicket(intentId, after);
    if (!mapped.ticket) {
      logger.warn('[#1003] order-intent mirror skipped malformed doc', {
        intentId, malformed: mapped.malformed,
      });
      return 'skipped';
    }
    const ticket = mapped.ticket;
    const ref = tickets.doc(ticket.id);
    // A legacy status flip paper↔live re-mints the mode prefix — the stale
    // doc under the opposite prefix is dropped in the same transaction.
    const otherRef = tickets.doc(
      ticket.mode === 'live'
        ? stTicketId('paper', intentId)
        : stTicketId('live', intentId),
    );

    await db.runTransaction(async (txn) => {
      // All reads before writes (Firestore transaction contract).
      const [existing, other] = await Promise.all([
        txn.get(ref),
        txn.get(otherRef),
      ]);
      const existingData = existing.exists
        ? (existing.data() as StOrderTicket | undefined)
        : undefined;
      // Terminal-wins: never regress a canonical terminal state on a
      // legacy non-terminal rewrite (e.g. mirror racing a settle).
      const doc = suppressTerminalRegression(existingData?.state, { ...ticket });
      // A legacy rewrite carries its own (older) updatedAt — keep the
      // newer timestamp so a mirror write can't regress the record's clock.
      if (
        typeof existingData?.updatedAt === 'string'
        && typeof doc.updatedAt === 'string'
        && existingData.updatedAt > doc.updatedAt
      ) {
        doc.updatedAt = existingData.updatedAt;
      }
      txn.set(ref, doc, { merge: true });
      if (other.exists) txn.delete(otherRef);
    });
    return 'upserted';
  } catch (err) {
    logger.error('[#1003] order-intent mirror failed', {
      intentId,
      error: err instanceof Error ? err.message : String(err),
    });
    return 'skipped';
  }
}

export const orderIntentsMirror = onDocumentWritten(
  MIRROR_ORDER_INTENTS_PATH,
  async (event) => {
    const intentId = event.params.intentId;
    const afterSnap = event.data?.after;
    if (afterSnap?.exists) {
      await mirrorOrderIntent(
        { db: defaultDb, logger: defaultLogger }, intentId, afterSnap.data() as Record<string, unknown>,
      );
      return;
    }
    // Delete semantics only when a doc actually existed before — a
    // malformed event with no `before` must not delete canonical docs.
    if (event.data?.before?.exists) {
      await mirrorOrderIntent({ db: defaultDb, logger: defaultLogger }, intentId, null);
      return;
    }
    defaultLogger.warn('[#1003] order-intent mirror event with no before/after doc', { intentId });
  },
);
