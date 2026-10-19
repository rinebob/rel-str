/**
 * @topic #984 — ST Firestore Reorg (task #1007)
 *
 * Backtest soak mirrors — canonical→legacy direction (opposite flow of
 * `orderIntentsMirror`/`portfolioItemsMirror`).
 *
 * The BE orchestrator/worker write `st-backtest-runs` +
 * `st-backtest-permutations` after the #1007 cutover, but the FE reads
 * the legacy `backtest-*` roots directly via the client SDK until its
 * service re-point. These triggers shadow every canonical write onto
 * the legacy collection so the FE keeps seeing fresh runs. Deletes
 * propagate.
 *
 * The shadow is a merge-set, not wholesale: `firestore.rules` grants
 * authenticated clients `update` on `backtest-runs` limited to
 * `archived`/`qualityDesignation`/`updatedAt` — those are FE-owned
 * legacy fields that a wholesale set would erase. Merge preserves them;
 * nothing deletes fields on canonical run docs, so the asymmetry is
 * deliberate. Removed with the legacy roots in #1013.
 *
 * Accepted risk (same as #1003's mirror): trigger delivery is
 * at-least-once and unordered, so a stale event can briefly regress the
 * shadow — the next canonical write heals it and the #1007 parity audit
 * is the backstop.
 */
import { onDocumentWritten } from 'firebase-functions/v2/firestore';
import { logger as defaultLogger } from 'firebase-functions/v2';
import type { Firestore } from 'firebase-admin/firestore';
import { db as defaultDb } from '../../firebase-admin-init';
import {
  ST_BACKTEST_PERMUTATIONS_ROOT,
  ST_BACKTEST_RUNS_ROOT,
} from '../../common/st-collections';

/** Legacy backtest roots — FE-read until its service re-point. */
export const LEGACY_BACKTEST_RUNS_ROOT = 'backtest-runs';
export const LEGACY_BACKTEST_PERMUTATIONS_ROOT = 'backtest-permutations';
type LegacyBacktestRoot = typeof LEGACY_BACKTEST_RUNS_ROOT | typeof LEGACY_BACKTEST_PERMUTATIONS_ROOT;

export const MIRROR_ST_BACKTEST_RUNS_PATH = `${ST_BACKTEST_RUNS_ROOT}/{docId}`;
export const MIRROR_ST_BACKTEST_PERMUTATIONS_PATH = `${ST_BACKTEST_PERMUTATIONS_ROOT}/{docId}`;

export interface MirrorBacktestDeps {
  db?: Firestore;
  logger?: Pick<typeof defaultLogger, 'warn' | 'error'>;
}

/**
 * Mirror one canonical backtest doc write onto the legacy shadow.
 * `after === null` means the canonical doc was deleted — the legacy copy
 * goes too. Never throws.
 */
export async function mirrorBacktestDoc(
  deps: MirrorBacktestDeps,
  legacyCollection: LegacyBacktestRoot,
  docId: string,
  after: Record<string, unknown> | null,
): Promise<'upserted' | 'deleted' | 'skipped'> {
  const db = deps.db ?? defaultDb;
  const logger = deps.logger ?? defaultLogger;

  try {
    const ref = db.collection(legacyCollection).doc(docId);
    if (after === null) {
      await ref.delete();
      return 'deleted';
    }
    await ref.set(after, { merge: true });
    return 'upserted';
  } catch (err) {
    logger.error('[#1007] backtest mirror failed', {
      legacyCollection,
      docId,
      error: err instanceof Error ? err.message : String(err),
    });
    return 'skipped';
  }
}

/** One trigger per st-backtest root — the handlers are identical modulo
 *  the source path and legacy destination, so a factory keeps them in
 *  sync. */
function makeBacktestMirror(triggerPath: string, legacyRoot: LegacyBacktestRoot) {
  return onDocumentWritten(triggerPath, async (event) => {
    const { docId } = event.params;
    const afterSnap = event.data?.after;
    const after = afterSnap?.exists ? (afterSnap.data() as Record<string, unknown>) : null;
    if (after === null && !event.data?.before?.exists) {
      defaultLogger.warn('[#1007] backtest mirror event with no before/after doc', {
        triggerPath, docId,
      });
      return;
    }
    await mirrorBacktestDoc({}, legacyRoot, docId, after);
  });
}

export const stBacktestRunsMirror = makeBacktestMirror(
  MIRROR_ST_BACKTEST_RUNS_PATH, LEGACY_BACKTEST_RUNS_ROOT,
);

export const stBacktestPermutationsMirror = makeBacktestMirror(
  MIRROR_ST_BACKTEST_PERMUTATIONS_PATH, LEGACY_BACKTEST_PERMUTATIONS_ROOT,
);
