/**
 * @topic #553 — Paper Trading Infra (task #561)
 *
 * Firestore refs for the grouped `paper-trading/{anchor}/items/{id}` layout.
 * Path math lives in `shared/paper-trading-ids.ts` — this module only
 * materializes Collection/Document references.
 */

import type { CollectionReference, DocumentReference, Firestore } from 'firebase-admin/firestore';
import type { PaperTradingKind } from '@paper-trading/contracts';
import { paperTradingDocPath, paperTradingItemsPath } from '@paper-trading/ids';

export function paperItemsRef(db: Firestore, kind: PaperTradingKind): CollectionReference {
  return db.collection(paperTradingItemsPath(kind));
}

export function paperDocRef(
  db: Firestore,
  kind: PaperTradingKind,
  id: string,
): DocumentReference {
  return db.doc(paperTradingDocPath(kind, id));
}
