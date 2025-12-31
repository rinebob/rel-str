/**
 * Registry Actions — Callable HTTPS functions and seeding helper
 *
 * Contains functions for managing `pair-registry` membership and a one-off
 * seeding helper. Separated from partner-webhooks orchestrator for clarity.
 */
import { onCall, onRequest } from 'firebase-functions/v2/https';
import { logger } from 'firebase-functions/v2';
import { db, FieldValue } from '../firebase-admin-init';
import {
  REGISTRY_COLLECTION,
  TRACKED_SYMBOLS_COLLECTION,
  REGISTRY_RETENTION_DAYS,
  RsCloudFunctionName,
  BACKFILL_START_DATE,
} from './webhooks-config';
import { persistWarning } from '../logging/warn';
import { runFullBackfillForPairs } from './hydrate-new-pair';

function normalizeSymbol(v?: string): string | undefined {
  if (!v || typeof v !== 'string') return undefined;
  return v.trim().toUpperCase();
}

/**
 * UnregisterPairs callable
 * Deletes membership for specific {baseline,target} pairs by list member.
 *
 * Request: { listId: string, baseline: string, symbols: string[] }
 * Response: { unregistered: string[] }
 */
export const unregisterPairs = onCall({ region: 'us-central1' }, async (req) => {
  const listId = (req.data?.listId || '').trim();
  const baseline = normalizeSymbol(req.data?.baseline);
  const symbols = Array.isArray(req.data?.symbols) ? req.data.symbols : [];
  const uid = req.auth?.uid || 'anon';
  if (!baseline || !listId) {
    logger.warn('unregisterPairs missing baseline or listId');
    // Persist a warning for UI visibility (best-effort)
    await persistWarning('unregister_pairs_missing_params', { function: RsCloudFunctionName.UNREGISTER_PAIRS, uid, baseline, listId });
    return { unregistered: [] };
  }
  const retentionMs = REGISTRY_RETENTION_DAYS * 24 * 60 * 60 * 1000;
  const memberKey = `uid:${uid}/list:${listId}`;
  const unregistered: string[] = [];
  for (const s of symbols) {
    const target = normalizeSymbol(String(s));
    if (!target) continue;
    const id = `${baseline}-${target}`;
    const ref = db.collection(REGISTRY_COLLECTION).doc(id);
    await db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      if (!snap.exists) return;
      const data = (snap.data() as any) || {};
      const members: string[] = Array.isArray(data.members) ? data.members : [];
      const hadMember = members.includes(memberKey);
      const newMembers = hadMember ? members.filter((m) => m !== memberKey) : members;
      const oldRefCount: number = Number.isFinite(data.refCount) ? Number(data.refCount) : members.length;
      const newRefCount = hadMember ? Math.max(0, oldRefCount - 1) : oldRefCount;
      const update: Record<string, unknown> = {
        members: newMembers,
        refCount: newRefCount,
        updatedAt: FieldValue.serverTimestamp(),
      };
      if (newRefCount === 0) update['pendingDeleteAt'] = new Date(Date.now() + retentionMs).toISOString();
      tx.set(ref, update, { merge: true });
    });
    unregistered.push(id);
  }
  logger.info('unregisterPairs completed', { count: unregistered.length, baseline, listId });
  return { unregistered };
});

/**
 * validateAndRegisterPairs callable
 * Validates baseline and targets against tracked-symbols and records membership with refCount.
 *
 * Request: { listId: string, baseline: string, symbols: string[] }
 * Response: { registered: string[], rejected: { symbol, reason }[] }
 */
export const validateAndRegisterPairs = onCall({ region: 'us-central1' }, async (req) => {
  const listId = (req.data?.listId || '').trim();
  const baseline = normalizeSymbol(req.data?.baseline);
  const symbols = Array.isArray(req.data?.symbols) ? req.data.symbols.map((x: any) => String(x)) : [];
  const uid = req.auth?.uid || 'anon';
  if (!baseline || !listId) {
    logger.warn('validateAndRegisterPairs missing baseline or listId');
    await persistWarning('register_pairs_missing_params', { function: RsCloudFunctionName.VALIDATE_AND_REGISTER, uid, baseline, listId });
    return { registered: [], rejected: [{ symbol: baseline || 'unknown', reason: 'missing_baseline_or_listId' }] };
  }

  const readTracked = async (sym: string) => {
    const ref = db.collection(TRACKED_SYMBOLS_COLLECTION).doc(sym);
    const snap = await ref.get();
    return snap.exists ? (snap.data() as any) : undefined;
  };

  // Start log for observability
  logger.info('validateAndRegisterPairs start', { listId, baseline, symbolsCount: symbols.length, uid });

  const rejected: Array<{ symbol: string; reason: string } > = [];
  const validTargets: string[] = [];
  for (const raw of symbols) {
    const target = normalizeSymbol(String(raw));
    if (!target) continue;
    // Optionally read tracked doc (for future metadata), but do not gate on it
    try { await readTracked(target); } catch {}
    validTargets.push(target);
  }

  // Write refCount/membership
  const memberKey = `uid:${uid}/list:${listId}`;
  const registered: string[] = [];
  const newlyRegistered: string[] = [];
  for (const target of validTargets) {
    const id = `${baseline}-${target}`;
    const ref = db.collection(REGISTRY_COLLECTION).doc(id);
    await db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      const data = (snap.data() as any) || {};
      const members: string[] = Array.isArray(data.members) ? data.members : [];
      const hadMember = members.includes(memberKey);
      const newMembers = hadMember ? members : [...members, memberKey];
      const oldRefCount: number = Number.isFinite(data.refCount) ? Number(data.refCount) : members.length;
      const newRefCount = hadMember ? oldRefCount : oldRefCount + 1;
      tx.set(ref, {
        baseline,
        target,
        members: newMembers,
        refCount: newRefCount,
        updatedAt: FieldValue.serverTimestamp(),
      }, { merge: true });

      if (!hadMember) {
        newlyRegistered.push(id);
      }
    });
    registered.push(id);
  }

  logger.info('validateAndRegisterPairs completed', { baseline, listId, registered: registered.length, rejected: rejected.length, newlyRegistered: newlyRegistered.length });

  // Fire-and-forget full backfill (archive D/W/M, then signals/activity/positions)
  if (newlyRegistered.length > 0) {
    const from = BACKFILL_START_DATE;
    const to = new Date().toISOString().slice(0, 10);

    void runFullBackfillForPairs(newlyRegistered, from, to).catch((e: any) => {
      logger.warn('validateAndRegisterPairs_backfill_failed', {
        pairs: newlyRegistered,
        from,
        to,
        message: e?.message,
      });
    });
  }

  return { registered, rejected };
});

/**
 * One-off seeding helper to create initial pair-registry documents.
 * Invoke once, then remove/disable.
 */
export const seedPairRegistryManual = onRequest({ region: 'us-central1', timeoutSeconds: 60 }, async (_req, res) => {
  try {
    const pairs: Array<{ baseline: string; target: string }> = [
      { baseline: 'QQQ', target: 'AAPL' },
      { baseline: 'QQQ', target: 'GOOGL' },
      { baseline: 'QQQ', target: 'TSLA' },
      { baseline: 'SPY', target: 'PFE' },
      { baseline: 'SPY', target: 'WMT' },
      { baseline: 'SPY', target: 'XOM' },
      { baseline: 'SPY', target: 'XPH' },
    ];

    const batch = db.batch();
    for (const p of pairs) {
      const baseline = (p.baseline || '').trim().toUpperCase();
      const target = (p.target || '').trim().toUpperCase();
      if (!baseline || !target) continue;
      const id = `${baseline}-${target}`;
      const ref = db.collection(REGISTRY_COLLECTION).doc(id);
      batch.set(ref, {
        baseline,
        target,
        createdAt: FieldValue.serverTimestamp(),
        source: 'manual-seed',
      }, { merge: true });
    }
    await batch.commit();
    res.status(200).json({ ok: true, count: pairs.length });
  } catch (e: any) {
    logger.error('seedPairRegistryManual failed', { message: e?.message, code: e?.code });
    res.status(500).json({ ok: false, error: e?.message || 'seed_failed' });
  }
});
