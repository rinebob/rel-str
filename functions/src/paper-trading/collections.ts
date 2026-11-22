/**
 * @topic #553 — Paper Trading Infra (task #561)
 * @topic #984 — ST Firestore Reorg (task #1007 cutover; #1661 cohort drain)
 *
 * Firestore refs for the grouped `{root}/{anchor}/items/{id}` layout.
 * Path math lives in `shared/st-collections.ts` — this module only
 * materializes Collection/Document references.
 *
 * #1007 cutover: account/trade/stats/raw-quote on `st-paper-trading`;
 * #1013 retired the `instances` anchor; #1158 cut the `analysis-*`
 * anchors; #1661 drained the last legacy leg — cohorts moved to
 * `st-position-groups` and the `paper-trading` root is gone. Every kind
 * now resolves the st- path unconditionally (the COHORT enum member is
 * retired too — nothing may route here for it).
 */

import type { CollectionReference, DocumentReference, Firestore } from 'firebase-admin/firestore';
import { PaperTradingKind } from '@paper-trading/contracts';
import { stPaperTradingItemsPath } from '../common/st-collections';

/**
 * Routed document path as a string — for callers that embed a doc path
 * as provenance (screenshot-lifecycle's position carrier) rather than a
 * DocumentReference.
 */
export function paperTradingDocPathFor(kind: PaperTradingKind, id: string): string {
  return `${stPaperTradingItemsPath(kind)}/${id}`;
}

export function paperItemsRef(db: Firestore, kind: PaperTradingKind): CollectionReference {
  return db.collection(stPaperTradingItemsPath(kind));
}

export function paperDocRef(
  db: Firestore,
  kind: PaperTradingKind,
  id: string,
): DocumentReference {
  return db.doc(paperTradingDocPathFor(kind, id));
}
