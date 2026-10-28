/**
 * @topic #553 — Paper Trading Infra (task #561)
 * @topic #984 — ST Firestore Reorg (task #1007 cutover)
 *
 * Firestore refs for the grouped `{root}/{anchor}/items/{id}` layout.
 * Path math lives in `shared/paper-trading-ids.ts` (legacy root) and
 * `shared/st-collections.ts` (canonical st- root) — this module only
 * materializes Collection/Document references.
 *
 * #1007 cutover: account/trade/stats/raw-quote read+write on
 * `st-paper-trading`; #1013 retires the `instances` anchor (all instance
 * reads now hit `st-strategy-instances` directly). Remaining legacy legs:
 * `cohorts` (live repository path; drain is a later task) and
 * `analysis-*` (#1160). ST_KINDS shrinks as each kind migrates and is
 * deleted with the legacy root.
 */

import type { CollectionReference, DocumentReference, Firestore } from 'firebase-admin/firestore';
import { PaperTradingKind } from '@paper-trading/contracts';
import { paperTradingItemsPath } from '@paper-trading/ids';
import { stPaperTradingItemsPath } from '../common/st-collections';

/** Kinds cut over to `st-paper-trading` in #1007. */
const ST_KINDS: ReadonlySet<PaperTradingKind> = new Set([
  PaperTradingKind.ACCOUNT,
  PaperTradingKind.TRADE,
  PaperTradingKind.STATS,
  PaperTradingKind.RAW_QUOTE,
]);

/** Routed `items` collection path — the single place the kind→root
 *  decision lives; survives until the last legacy kind migrates. */
function itemsPathFor(kind: PaperTradingKind): string {
  return ST_KINDS.has(kind)
    ? stPaperTradingItemsPath(kind)
    : paperTradingItemsPath(kind);
}

/**
 * Routed document path as a string — for callers that embed a doc path
 * as provenance (screenshot-lifecycle's position carrier) rather than a
 * DocumentReference. Keeps the ST_KINDS decision in this one file.
 */
export function paperTradingDocPathFor(kind: PaperTradingKind, id: string): string {
  return `${itemsPathFor(kind)}/${id}`;
}

export function paperItemsRef(db: Firestore, kind: PaperTradingKind): CollectionReference {
  return db.collection(itemsPathFor(kind));
}

export function paperDocRef(
  db: Firestore,
  kind: PaperTradingKind,
  id: string,
): DocumentReference {
  return db.doc(paperTradingDocPathFor(kind, id));
}
