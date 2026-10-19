/**
 * @topic #984 — ST Firestore Reorg (task #1007)
 *
 * `portfolioItemsMirror` — soak-period mirror for the portfolio rename.
 *
 * The FE writes `portfolio/{buckets,attributions}/items` directly via the
 * client SDK (bucket create/rename, attribution transactions) — no BE
 * callable sits in the write path, so the only way to keep
 * `st-portfolio` populated until the FE service re-point is a trigger
 * copy. Every legacy write lands on `st-portfolio/{anchor}/items/{id}`;
 * deletes propagate.
 *
 * Canonical is owned by this mirror alone during the soak — a wholesale
 * `set` (not merge) keeps the copy exact, including FE field deletions.
 * Any other anchor under `portfolio/` is skipped. Removed with the
 * legacy root in #1013.
 *
 * Accepted risk (same as #1003's mirror): trigger delivery is
 * at-least-once and unordered, so a stale event can briefly regress the
 * canonical copy — the next source write heals it and the #1007 parity
 * audit is the backstop.
 */
import { onDocumentWritten } from 'firebase-functions/v2/firestore';
import { logger as defaultLogger } from 'firebase-functions/v2';
import type { Firestore } from 'firebase-admin/firestore';
import { db as defaultDb } from '../firebase-admin-init';
import {
  ST_PORTFOLIO_ANCHORS,
  StPortfolioKind,
  stPortfolioDocPath,
} from '../common/st-collections';

/** Legacy portfolio root — FE-written until its service re-point. */
export const LEGACY_PORTFOLIO_ROOT = 'portfolio';

/** Trigger path — the legacy anchored item docs. */
export const MIRROR_PORTFOLIO_ITEMS_PATH = `${LEGACY_PORTFOLIO_ROOT}/{anchor}/items/{docId}`;

/** Legacy anchor name → canonical kind, inverted from the shared anchor
 *  map so a new portfolio kind can't silently fall through here. */
const ANCHOR_KINDS: Record<string, StPortfolioKind> = Object.fromEntries(
  Object.entries(ST_PORTFOLIO_ANCHORS).map(([kind, anchor]) => [anchor, kind as StPortfolioKind]),
);

export interface MirrorPortfolioItemDeps {
  db?: Firestore;
  logger?: Pick<typeof defaultLogger, 'warn' | 'error'>;
}

/**
 * Mirror one legacy portfolio item write into `st-portfolio`.
 * `after === null` means the doc was deleted — the canonical copy goes
 * too. Never throws — a mirror failure must not disturb the FE path.
 */
export async function mirrorPortfolioItem(
  deps: MirrorPortfolioItemDeps,
  anchor: string,
  docId: string,
  after: Record<string, unknown> | null,
): Promise<'upserted' | 'deleted' | 'skipped'> {
  const db = deps.db ?? defaultDb;
  const logger = deps.logger ?? defaultLogger;

  if (!Object.hasOwn(ANCHOR_KINDS, anchor)) {
    logger.warn('[#1007] portfolio mirror skipped unknown anchor', { anchor, docId });
    return 'skipped';
  }

  try {
    const ref = db.doc(stPortfolioDocPath(ANCHOR_KINDS[anchor], docId));
    if (after === null) {
      await ref.delete();
      return 'deleted';
    }
    await ref.set(after);
    return 'upserted';
  } catch (err) {
    logger.error('[#1007] portfolio mirror failed', {
      anchor,
      docId,
      error: err instanceof Error ? err.message : String(err),
    });
    return 'skipped';
  }
}

export const portfolioItemsMirror = onDocumentWritten(
  MIRROR_PORTFOLIO_ITEMS_PATH,
  async (event) => {
    const { anchor, docId } = event.params;
    const afterSnap = event.data?.after;
    const after = afterSnap?.exists ? (afterSnap.data() as Record<string, unknown>) : null;
    if (after === null && !event.data?.before?.exists) {
      defaultLogger.warn('[#1007] portfolio mirror event with no before/after doc', { anchor, docId });
      return;
    }
    await mirrorPortfolioItem({}, anchor, docId, after);
  },
);
