/**
 * Registry Actions — Callable HTTPS functions and seeding helper
 *
 * Contains functions for managing `pair-registry` membership and a one-off
 * seeding helper. Separated from partner-webhooks orchestrator for clarity.
 */
import { onCall, onRequest } from 'firebase-functions/v2/https';
import { logger } from 'firebase-functions';
import { db, FieldValue } from '../firebase-admin-init';
import {
  REGISTRY_COLLECTION,
  TRACKED_SYMBOLS_COLLECTION,
  REGISTRY_RETENTION_DAYS,
} from './webhooks-config';

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
 * Response: { registered: string[], rejected: { symbol, reason }[], baselineHint?: { nonStandard: boolean } }
 */
export const validateAndRegisterPairs = onCall({ region: 'us-central1' }, async (req) => {
  const listId = (req.data?.listId || '').trim();
  const baseline = normalizeSymbol(req.data?.baseline);
  const symbols = Array.isArray(req.data?.symbols) ? req.data.symbols.map((x: any) => String(x)) : [];
  const uid = req.auth?.uid || 'anon';
  if (!baseline || !listId) {
    logger.warn('validateAndRegisterPairs missing baseline or listId');
    return { registered: [], rejected: [{ symbol: baseline || 'unknown', reason: 'missing_baseline_or_listId' }] };
  }

  const readTracked = async (sym: string) => {
    const ref = db.collection(TRACKED_SYMBOLS_COLLECTION).doc(sym);
    const snap = await ref.get();
    return snap.exists ? (snap.data() as any) : undefined;
  };

  const baselineDoc = await readTracked(baseline);
  const baselineSupported = !!baselineDoc?.supported;
  const baselineHint = { nonStandard: baselineSupported && !baselineDoc?.isBaseline };
  if (!baselineSupported) {
    return { registered: [], rejected: [{ symbol: baseline, reason: 'baseline_not_supported' }], baselineHint };
  }

  const rejected: Array<{ symbol: string; reason: string } > = [];
  const validTargets: string[] = [];
  for (const raw of symbols) {
    const target = normalizeSymbol(String(raw));
    if (!target) continue;
    const doc = await readTracked(target);
    if (!doc?.supported) {
      rejected.push({ symbol: target, reason: 'target_not_supported' });
      continue;
    }
    validTargets.push(target);
  }

  // Write refCount/membership
  const memberKey = `uid:${uid}/list:${listId}`;
  const registered: string[] = [];
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
    });
    registered.push(id);
  }

  logger.info('validateAndRegisterPairs completed', { baseline, listId, registered: registered.length, rejected: rejected.length });
  return { registered, rejected, baselineHint };
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
