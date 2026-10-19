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
 * `st-paper-trading`. The other anchors stay on the legacy root —
 * `instances` is the FE-written anchor until #1014, `cohorts` drains to
 * `st-position-groups` (#1004), and `analysis-*` keeps its own rename
 * task. ST_KINDS is removed with the legacy root in #1013.
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
 *  decision lives; removed with the legacy root in #1013. */
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
