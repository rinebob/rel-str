/**
 * @topic #984 — ST Firestore Reorg (task #1008)
 *
 * Soak mirrors for the st-config + st-symbol-lists consolidation.
 *
 * Legacy → canonical (FE is stranded on the legacy paths until its
 * service re-point in #1014):
 *
 * - `tradingConfigMirror` — `savant-trader/data/trading-config/{docId}`
 *   → `st-config/{docId}`. The FE writes `{uid}` trading-config docs
 *   and the autoPaper doc is script-seeded; wholesale `set` keeps the
 *   canonical copy exact (the FE owns the doc shape).
 * - `symbolListsMirror` — `savant-trader/data/symbol-lists/{docId}`
 *   → `st-symbol-lists/{docId}`. The FE owns list CRUD; the BE's one
 *   write (symbol-added → bare NEW doc) dual-writes both roots itself,
 *   so this mirror only watches legacy.
 *
 * Canonical → legacy (BE is the writer):
 *
 * - `stStatusMirror` — `st-config/status` → `savant-trader/data/status/
 *   current`. No known live reader remains on legacy (`run.service`'s
 *   statusDoc ref is dead — the only consumer is the `stGetStatus`
 *   callable, which now reads canonical); the shadow is cheap insurance
 *   for rules-permitted external readers + a rollback path for the soak.
 *   The trigger pins the literal doc path so mirrored FE config docs
 *   never fire it.
 *
 * All mirrors are wholesale `set` + delete propagation and never throw.
 * Removed with the legacy roots in #1013.
 *
 * Namespace collision: legacy trading-config and status docs share the
 * `st-config` root — a trading-config doc literally named `status`
 * would land on the BE-owned singleton slot and get shadowed back over
 * the real status doc. `mirrorTradingConfigDoc` skips that id.
 *
 * Accepted risk (same as #1003/#1007 mirrors): trigger delivery is
 * at-least-once and unordered, so a stale event can briefly regress the
 * shadow — the next source write heals it and the #1008 parity audit is
 * the backstop.
 */
import { onDocumentWritten } from 'firebase-functions/v2/firestore';
import { logger as defaultLogger } from 'firebase-functions/v2';
import type { Firestore } from 'firebase-admin/firestore';
import { db as defaultDb } from '../firebase-admin-init';
import {
  AGENT_STATUS_DOC,
  ST_CONFIG_STATUS_DOC,
  ST_STATUS_COLLECTION,
  ST_SYMBOL_LISTS_COLLECTION,
  ST_SYMBOL_LISTS_ROOT,
  ST_TRADING_CONFIG_COLLECTION,
  stConfigDocPath,
} from '../common/st-collections';

const LEGACY_STATUS_DOC_PATH = `${ST_STATUS_COLLECTION}/${AGENT_STATUS_DOC}`;

export const MIRROR_TRADING_CONFIG_PATH = `${ST_TRADING_CONFIG_COLLECTION}/{docId}`;
export const MIRROR_SYMBOL_LISTS_PATH = `${ST_SYMBOL_LISTS_COLLECTION}/{docId}`;
/** Literal doc path (not a wildcard) — the trigger fires only for the
 *  status singleton; FE-authored config docs mirrored into st-config
 *  never reach it. */
export const MIRROR_ST_STATUS_PATH = stConfigDocPath(ST_CONFIG_STATUS_DOC);

export interface MirrorDeps {
  db?: Firestore;
  logger?: Pick<typeof defaultLogger, 'warn' | 'error'>;
}

/**
 * Shared write core: wholesale `set` (source owns the doc shape),
 * `after === null` propagates the delete. Never throws — a mirror
 * failure must not disturb the source write.
 */
async function writeMirrorDoc(
  deps: MirrorDeps,
  destDocPath: string,
  after: Record<string, unknown> | null,
): Promise<'upserted' | 'deleted' | 'skipped'> {
  const db = deps.db ?? defaultDb;
  const logger = deps.logger ?? defaultLogger;
  try {
    const ref = db.doc(destDocPath);
    if (after === null) {
      await ref.delete();
      return 'deleted';
    }
    await ref.set(after);
    return 'upserted';
  } catch (err) {
    logger.error('[#1008] config/lists mirror failed', {
      destDocPath,
      error: err instanceof Error ? err.message : String(err),
    });
    return 'skipped';
  }
}

export async function mirrorTradingConfigDoc(
  deps: MirrorDeps,
  docId: string,
  after: Record<string, unknown> | null,
): Promise<'upserted' | 'deleted' | 'skipped'> {
  // A `trading-config/status` doc would mirror onto the BE-owned
  // st-config/status slot and get shadowed over the real status doc —
  // the namespaces multiplex into one root (see header).
  if (docId === ST_CONFIG_STATUS_DOC) {
    (deps.logger ?? defaultLogger).warn(
      '[#1008] trading-config doc id collides with the status slot — skipped',
      { docId },
    );
    return 'skipped';
  }
  return writeMirrorDoc(deps, stConfigDocPath(docId), after);
}

export async function mirrorSymbolListDoc(
  deps: MirrorDeps,
  docId: string,
  after: Record<string, unknown> | null,
): Promise<'upserted' | 'deleted' | 'skipped'> {
  return writeMirrorDoc(deps, `${ST_SYMBOL_LISTS_ROOT}/${docId}`, after);
}

/**
 * Canonical st-config/status write → legacy
 * `savant-trader/data/status/current` shadow. Never throws.
 */
export async function shadowStStatusDoc(
  deps: MirrorDeps,
  after: Record<string, unknown> | null,
): Promise<'upserted' | 'deleted' | 'skipped'> {
  return writeMirrorDoc(deps, LEGACY_STATUS_DOC_PATH, after);
}

function legacyToCanonicalTrigger(
  triggerPath: string,
  mirrorFn: (deps: MirrorDeps, docId: string, after: Record<string, unknown> | null) => Promise<unknown>,
  tag: string,
) {
  return onDocumentWritten(triggerPath, async (event) => {
    const { docId } = event.params;
    const afterSnap = event.data?.after;
    const after = afterSnap?.exists ? (afterSnap.data() as Record<string, unknown>) : null;
    if (after === null && !event.data?.before?.exists) {
      defaultLogger.warn(`[#1008] ${tag} mirror event with no before/after doc`, { docId });
      return;
    }
    await mirrorFn({}, docId, after);
  });
}

export const tradingConfigMirror = legacyToCanonicalTrigger(
  MIRROR_TRADING_CONFIG_PATH, mirrorTradingConfigDoc, 'trading-config',
);

export const symbolListsMirror = legacyToCanonicalTrigger(
  MIRROR_SYMBOL_LISTS_PATH, mirrorSymbolListDoc, 'symbol-lists',
);

export const stStatusMirror = onDocumentWritten(
  MIRROR_ST_STATUS_PATH,
  async (event) => {
    const afterSnap = event.data?.after;
    const after = afterSnap?.exists ? (afterSnap.data() as Record<string, unknown>) : null;
    if (after === null && !event.data?.before?.exists) {
      defaultLogger.warn('[#1008] st-status mirror event with no before/after doc');
      return;
    }
    await shadowStStatusDoc({}, after);
  },
);
