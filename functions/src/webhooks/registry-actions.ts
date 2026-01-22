/**
 * Registry Actions — Callable HTTPS functions and seeding helper
 *
 * Contains functions for managing `pair-registry` membership and a one-off
 * seeding helper. Separated from partner-webhooks orchestrator for clarity.
 */
import { HttpsError, onCall, onRequest } from 'firebase-functions/v2/https';
import { logger } from 'firebase-functions/v2';
import { db, FieldValue } from '../firebase-admin-init';
import {
  REGISTRY_COLLECTION,
  TRACKED_SYMBOLS_COLLECTION,
  REGISTRY_RETENTION_DAYS,
  RsCloudFunctionName,
  BACKFILL_START_DATE,
  PAIRS_COLLECTION,
  PairIngestionStatus,
  PairSource,
} from './webhooks-config';
import { persistWarning } from '../logging/warn';
import { runFullBackfillForPairs } from './hydrate-new-pair';
// eslint-disable-next-line @typescript-eslint/no-var-requires
const pairsRegistryConfig: { baselines: string[]; pairs: Array<{ baseline: string; target: string }> } = require('../../src/config/pairs-registry.mvp.json');

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
    logger.warn('validateAndRegisterPairs missing baseline or listId', { listId, baseline, uid });
    await persistWarning('register_pairs_missing_params', { function: RsCloudFunctionName.VALIDATE_AND_REGISTER, uid, baseline, listId });
    return { registered: [], rejected: [{ symbol: baseline || 'unknown', reason: 'missing_baseline_or_listId' }] };
  }

  const symbolsCount = symbols.length;

  try {
    const readTracked = async (sym: string) => {
      const ref = db.collection(TRACKED_SYMBOLS_COLLECTION).doc(sym);
      const snap = await ref.get();
      return snap.exists ? (snap.data() as any) : undefined;
    };

    // Start log for observability with list + baseline + symbol count
    logger.info(
      `validateAndRegisterPairs start listId=${listId} baseline=${baseline} symbols=${symbolsCount} uid=${uid}`,
      { listId, baseline, symbolsCount, uid },
    );

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

      logger.info(
        `validateAndRegisterPairs_register_pair listId=${listId} baseline=${baseline} pairId=${id} target=${target}`,
        { listId, baseline, pairId: id, target, memberKey },
      );

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

    logger.info(
      `validateAndRegisterPairs completed listId=${listId} baseline=${baseline} symbols=${symbolsCount} registered=${registered.length} rejected=${rejected.length} newlyRegistered=${newlyRegistered.length}`,
      {
        baseline,
        listId,
        symbolsCount,
        registeredCount: registered.length,
        rejectedCount: rejected.length,
        newlyRegisteredCount: newlyRegistered.length,
      },
    );

    // Fire-and-forget full backfill (archive D/W/M, then signals/activity/positions).
    // If there are newly registered pairs, backfill just those; otherwise, backfill
    // all pairs for this list so list creation/edit always ensures data coverage.
    const backfillPairs = newlyRegistered.length > 0 ? newlyRegistered : registered;
    if (backfillPairs.length > 0) {
      const from = BACKFILL_START_DATE;
      const to = new Date().toISOString().slice(0, 10);

      logger.info(
        `validateAndRegisterPairs_backfill_start listId=${listId} baseline=${baseline} pairs=${backfillPairs.length} from=${from} to=${to} newlyRegisteredOnly=${newlyRegistered.length > 0}`,
        {
          listId,
          baseline,
          pairs: backfillPairs,
          from,
          to,
          newlyRegisteredOnly: newlyRegistered.length > 0,
        },
      );

      void runFullBackfillForPairs(backfillPairs, from, to).catch((e: any) => {
        logger.warn(
          `validateAndRegisterPairs_backfill_failed listId=${listId} baseline=${baseline} pairs=${backfillPairs.length} from=${from} to=${to}`,
          {
            listId,
            baseline,
            pairs: backfillPairs,
            from,
            to,
            message: e?.message,
          },
        );
      });
    }

    return { registered, rejected };
  } catch (e: any) {
    logger.error(
      `validateAndRegisterPairs_unhandled_error listId=${listId} baseline=${baseline} symbols=${symbolsCount} uid=${uid} message=${e?.message}`,
      {
        listId,
        baseline,
        symbolsCount,
        uid,
        message: e?.message,
        code: e?.code,
        stack: e?.stack,
      },
    );
    throw new HttpsError('internal', 'validateAndRegisterPairs_failed');
  }
});

/**
 * Admin HTTP: Import/normalize pair-registry universe from bulk ETF constituent JSON.
 *
 * Source data:
 *   - functions/bulk-import.enriched_spy-qqq.json
 *   - functions/bulk-import.enriched_XL-non-spy-qqq.json
 *
 * For each {symbol, etfs[]} row, this function creates (baseline,target) pairs where
 * baseline is each ETF in `etfs` and target is `symbol` (both normalized to UPPERCASE),
 * and writes/merges docs under `pair-registry/{BASELINE}-{TARGET}`.
 *
 * Behavior:
 *   - When dryRun=true (query or JSON body), returns `{ ok, dryRun: true, totalPairs, pairs }`
 *     and performs **no** Firestore writes.
 *   - Otherwise, upserts docs for the full pair universe with:
 *       baseline, target,
 *       source: PairSource.BULK_IMPORT_2026_0115,
 *       dailyReady/weeklyReady/monthlyReady: true,
 *       ingestionStatus: PairIngestionStatus.SUCCESS,
 *       lastIngestionError: null,
 *       updatedAt: serverTimestamp(),
 *       and for new docs: createdAt, lastIngestionAt, members: [], refCount: 0.
 *
 * Existing docs are merged (set with { merge: true }), so fields like members/refCount
 * are preserved while readiness + ingestion status are normalized.
 *
 * See docs/planning/RS_ARCHIVE_BACKFILL.md for the authoritative description of the
 * registry universe and the 2026-01-15 bulk import process.
 */
export const importPairRegistryFromBulkJsonAdmin = onRequest({ region: 'us-central1', timeoutSeconds: 540 }, async (req, res) => {
  const token = (req.headers['authorization'] || '').toString().replace(/^Bearer\s+/i, '');
  const expected = (process.env.ADMIN_BACKFILL_TOKEN || '').trim();
  if (!expected || token !== expected) {
    res.status(401).json({ ok: false, error: 'unauthorized' });
    return;
  }

  try {
    const dryRunRaw = (req.query.dryRun ?? (req.body as any)?.dryRun) as unknown;
    const dryRun = typeof dryRunRaw === 'string'
      ? dryRunRaw.toLowerCase() === 'true'
      : dryRunRaw === true;

    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const spyQqq: Array<{ symbol: string; etfs?: string[] }> = require('../../bulk-import.enriched_spy-qqq.json');
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const xlNonSpyQqq: Array<{ symbol: string; etfs?: string[] }> = require('../../bulk-import.enriched_XL-non-spy-qqq.json');

    const all: Array<{ symbol: string; etfs?: string[] }> = [...spyQqq, ...xlNonSpyQqq];

    const pairIds = new Set<string>();

    for (const entry of all) {
      const symbol = String(entry.symbol || '').trim().toUpperCase();
      if (!symbol) continue;
      const etfs = Array.isArray(entry.etfs) ? entry.etfs : [];
      for (const rawBaseline of etfs) {
        const baseline = String(rawBaseline || '').trim().toUpperCase();
        if (!baseline) continue;
        const id = `${baseline}-${symbol}`;
        pairIds.add(id);
      }
    }

    const allPairIds = Array.from(pairIds).sort();

    if (dryRun) {
      res.status(200).json({ ok: true, dryRun: true, totalPairs: allPairIds.length, pairs: allPairIds });
      return;
    }

    let created = 0;
    let updated = 0;

    for (const id of allPairIds) {
      const [baseline, target] = id.split('-');
      if (!baseline || !target) continue;

      const ref = db.collection(REGISTRY_COLLECTION).doc(id);
      const snap = await ref.get();
      const source = snap.exists
        ? PairSource.BULK_IMPORT_2026_0115_EXISTING
        : PairSource.BULK_IMPORT_2026_0115_NEW;

      const nowFields: Record<string, unknown> = {
        baseline,
        target,
        source,
        dailyReady: true,
        weeklyReady: true,
        monthlyReady: true,
        ingestionStatus: PairIngestionStatus.SUCCESS,
        lastIngestionError: null,
        updatedAt: FieldValue.serverTimestamp(),
      };

      if (!snap.exists) {
        nowFields['createdAt'] = FieldValue.serverTimestamp();
        nowFields['lastIngestionAt'] = FieldValue.serverTimestamp();
        nowFields['members'] = [];
        nowFields['refCount'] = 0;
        await ref.set(nowFields, { merge: true });
        created++;
      } else {
        await ref.set(nowFields, { merge: true });
        updated++;
      }
    }

    res.status(200).json({ ok: true, dryRun: false, totalPairs: allPairIds.length, created, updated });
  } catch (e: any) {
    logger.error('importPairRegistryFromBulkJsonAdmin_failed', { message: e?.message });
    res.status(500).json({ ok: false, error: e?.message || 'internal_error' });
  }
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

/**
 * Seed pair-registry from static MVP config.
 *
 * Request (JSON body or query params):
 *   - baselineFilter?: string (e.g. 'QQQ' to seed only QQQ pairs)
 *   - dryRun?: boolean (if true, do not write; just report planned changes)
 *
 * Behavior:
 *   - Loads functions/src/config/pairs-registry.mvp.json.
 *   - Filters pairs by baselineFilter if provided.
 *   - Reads existing pair-registry docs to build a Set of existing IDs.
 *   - Computes toCreate = configPairs \ existingPairs.
 *   - If dryRun: returns counts + sample and performs no writes.
 *   - Else: batch-writes new docs with source: 'mvp-config-seed' and triggers
 *           runFullBackfillForPairs for the newly created pairs.
 */
export const seedPairRegistryFromConfigAdmin = onRequest({ region: 'us-central1', timeoutSeconds: 300 }, async (req, res) => {
  try {
    const rawBaselineFilter = (req.body?.baselineFilter ?? req.query?.baselineFilter ?? '').toString();
    const baselineFilter = normalizeSymbol(rawBaselineFilter);
    const dryRunRaw = (req.body?.dryRun ?? req.query?.dryRun ?? 'false').toString();
    const dryRun = dryRunRaw === 'true' || dryRunRaw === '1';

    const allPairs = Array.isArray(pairsRegistryConfig.pairs) ? pairsRegistryConfig.pairs : [];
    const wantedPairs = baselineFilter
      ? allPairs.filter((p) => normalizeSymbol(p.baseline) === baselineFilter)
      : allPairs;

    // Read existing registry docs to avoid clobbering or duplicating.
    const snap = await db.collection(REGISTRY_COLLECTION).get();
    const existingIds = new Set<string>();
    snap.forEach((doc) => {
      const data = doc.data() as any;
      const b = normalizeSymbol(data.baseline);
      const t = normalizeSymbol(data.target);
      if (b && t) {
        existingIds.add(`${b}-${t}`);
      }
    });

    const toCreate: Array<{ baseline: string; target: string; id: string }> = [];
    for (const p of wantedPairs) {
      const baseline = normalizeSymbol(p.baseline);
      const target = normalizeSymbol(p.target);
      if (!baseline || !target) continue;
      const id = `${baseline}-${target}`;
      if (existingIds.has(id)) {
        continue;
      }
      toCreate.push({ baseline, target, id });
    }

    const summary = {
      baselineFilter: baselineFilter || null,
      totalConfigPairs: allPairs.length,
      filteredConfigPairs: wantedPairs.length,
      existingCount: existingIds.size,
      toCreateCount: toCreate.length,
      dryRun,
      sampleToCreate: toCreate.slice(0, 10).map((p) => p.id),
    };

    logger.info(
      `seedPairRegistryFromConfigAdmin_summary baselineFilter=${baselineFilter || 'ALL'} totalConfigPairs=${allPairs.length} filteredConfigPairs=${wantedPairs.length} existingCount=${existingIds.size} toCreateCount=${toCreate.length} dryRun=${dryRun}`,
      summary,
    );

    if (dryRun) {
      res.status(200).json({ ok: true, mode: 'dryRun', ...summary });
      return;
    }

    if (toCreate.length === 0) {
      res.status(200).json({ ok: true, message: 'no_new_pairs', ...summary });
      return;
    }

    // Batch-write new registry docs.
    const batch = db.batch();
    for (const p of toCreate) {
      const ref = db.collection(REGISTRY_COLLECTION).doc(p.id);
      logger.info(
        `seedPairRegistryFromConfigAdmin_add_pair id=${p.id} baseline=${p.baseline} target=${p.target}`,
        {
          id: p.id,
          baseline: p.baseline,
          target: p.target,
        },
      );
      batch.set(ref, {
        baseline: p.baseline,
        target: p.target,
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
        source: 'mvp-config-seed',
        active: true,
        ingestionStatus: PairIngestionStatus.PENDING,
        dailyReady: false,
        weeklyReady: false,
        monthlyReady: false,
      }, { merge: true });
    }
    await batch.commit();

    // Trigger backfill for the newly created pairs, mirroring validateAndRegisterPairs.
    const pairIds = toCreate.map((p) => p.id);
    const from = BACKFILL_START_DATE;
    const to = new Date().toISOString().slice(0, 10);

    void runFullBackfillForPairs(pairIds, from, to).catch((e: any) => {
      logger.warn('seedPairRegistryFromConfigAdmin_backfill_failed', {
        pairs: pairIds,
        from,
        to,
        message: e?.message,
      });
    });

    res.status(200).json({ ok: true, ...summary });
  } catch (e: any) {
    logger.error('seedPairRegistryFromConfigAdmin failed', { message: e?.message, code: e?.code });
    res.status(500).json({ ok: false, error: e?.message || 'seed_from_config_failed' });
  }
});

/**
 * Sweep pair-registry and pairs-data against static MVP config.
 *
 * Removes any registry entries whose (baseline,target) pair is not present in
 * the master config list, **except** SPY-baseline pairs, which are always
 * preserved even if not in the config.
 *
 * Request (JSON body or query params):
 *   - dryRun?: boolean (if true, do not delete; just report planned changes)
 */
export const sweepPairRegistryAgainstConfigAdmin = onRequest({ region: 'us-central1', timeoutSeconds: 540 }, async (req, res) => {
  try {
    const dryRunRaw = (req.body?.dryRun ?? req.query?.dryRun ?? 'false').toString();
    const dryRun = dryRunRaw === 'true' || dryRunRaw === '1';

    const allPairs = Array.isArray(pairsRegistryConfig.pairs) ? pairsRegistryConfig.pairs : [];
    const allowedIds = new Set<string>();
    for (const p of allPairs) {
      const b = normalizeSymbol(p.baseline);
      const t = normalizeSymbol(p.target);
      if (!b || !t) continue;
      allowedIds.add(`${b}-${t}`);
    }

    // Snapshot all current registry docs.
    const snap = await db.collection(REGISTRY_COLLECTION).get();
    const toDelete: Array<{ id: string; baseline: string; target: string }> = [];
    snap.forEach((doc) => {
      const data = doc.data() as any;
      const baseline = normalizeSymbol(data.baseline);
      const target = normalizeSymbol(data.target);
      if (!baseline || !target) return;
      const id = `${baseline}-${target}`;

      // Keep SPY-* pairs regardless of config membership.
      if (baseline === 'SPY') {
        return;
      }

      if (!allowedIds.has(id)) {
        toDelete.push({ id, baseline, target });
      }
    });

    const summary = {
      dryRun,
      configPairCount: allPairs.length,
      registryCount: snap.size,
      toDeleteCount: toDelete.length,
      sampleToDelete: toDelete.slice(0, 10).map((p) => p.id),
    };

    logger.info('sweepPairRegistryAgainstConfigAdmin summary', summary);

    if (dryRun) {
      res.status(200).json({ ok: true, mode: 'dryRun', ...summary });
      return;
    }

    if (toDelete.length === 0) {
      res.status(200).json({ ok: true, message: 'nothing_to_delete', ...summary });
      return;
    }

    // Helper to delete pairs-data tree for a given pair id.
    const deletePairDataTree = async (pairId: string) => {
      const pairRef = db.collection(PAIRS_COLLECTION).doc(pairId);
      const subcols = await pairRef.listCollections();
      for (const col of subcols) {
        const colSnap = await col.get();
        const batch = db.batch();
        colSnap.forEach((doc) => {
          batch.delete(doc.ref);
        });
        if (!colSnap.empty) {
          logger.info('sweepPairRegistryAgainstConfigAdmin_delete_subcollection', {
            pairId,
            subcollection: col.id,
            count: colSnap.size,
          });
          await batch.commit();
        }
      }
      await pairRef.delete();
    };

    // Delete registry docs and their pair-data trees sequentially to avoid huge batches.
    for (const p of toDelete) {
      logger.info('sweepPairRegistryAgainstConfigAdmin_delete_pair', {
        id: p.id,
        baseline: p.baseline,
        target: p.target,
      });

      const regRef = db.collection(REGISTRY_COLLECTION).doc(p.id);
      await regRef.delete();

      try {
        await deletePairDataTree(p.id);
      } catch (e: any) {
        logger.warn('sweepPairRegistryAgainstConfigAdmin_pair_data_delete_failed', {
          id: p.id,
          message: e?.message,
        });
      }
    }

    res.status(200).json({ ok: true, ...summary });
  } catch (e: any) {
    logger.error('sweepPairRegistryAgainstConfigAdmin failed', { message: e?.message, code: e?.code });
    res.status(500).json({ ok: false, error: e?.message || 'sweep_registry_failed' });
  }
});

/**
 * Dev/Test helper: upsert a small set of pairs into pair-registry via HTTP.
 *
 * Request JSON body:
 *   {
 *     "baseline": "SPY",
 *     "symbols": ["A", "AAPL", ...]
 *   }
 *
 * This is intended only for local emulator/testing to avoid seeding the full
 * config universe. It does NOT trigger backfills.
 */
export const devEnsurePairsInRegistryHttpTest = onRequest({ region: 'us-central1', timeoutSeconds: 60 }, async (req, res) => {
  if (req.method !== 'POST') {
    res.status(405).json({ ok: false, error: 'only_post_allowed' });
    return;
  }

  const rawBaseline = (req.body?.baseline ?? '').toString();
  const baseline = normalizeSymbol(rawBaseline);
  const symbolsRaw: any[] = Array.isArray(req.body?.symbols) ? req.body.symbols : [];
  const targets = symbolsRaw
    .map((s) => normalizeSymbol(String(s)))
    .filter((s): s is string => !!s);

  if (!baseline || targets.length === 0) {
    res.status(400).json({ ok: false, error: 'missing_baseline_or_symbols', baseline, symbolsCount: targets.length });
    return;
  }

  try {
    const batch = db.batch();
    const created: string[] = [];

    for (const target of targets) {
      const id = `${baseline}-${target}`;
      const ref = db.collection(REGISTRY_COLLECTION).doc(id);
      batch.set(ref, {
        baseline,
        target,
        active: true,
        source: 'dev-http-test',
        updatedAt: FieldValue.serverTimestamp(),
      }, { merge: true });
      created.push(id);
    }

    await batch.commit();

    logger.info('devEnsurePairsInRegistryHttpTest_completed', {
      baseline,
      symbolsCount: targets.length,
      createdCount: created.length,
      sample: created.slice(0, 10),
    });

    res.status(200).json({ ok: true, baseline, symbolsCount: targets.length, created });
  } catch (e: any) {
    logger.error('devEnsurePairsInRegistryHttpTest_failed', { baseline, symbolsCount: targets.length, message: e?.message });
    res.status(500).json({ ok: false, error: e?.message || 'dev_ensure_pairs_failed' });
  }
});

/**
 * Seed user lists for a baseline from static MVP config.
 *
 * Creates two lists under users/{uid}/lists:
 *   - {baseline}-constituents: baseline vs individual symbols
 *   - {baseline}-sectors: baseline vs sector ETFs (XLB, XLC, ..., XSD)
 *
 * Request (JSON body or query params):
 *   - uid: string (required)
 *   - baseline: string (e.g. 'QQQ')
 */
export const seedUserListsFromConfigAdmin = onRequest({ region: 'us-central1', timeoutSeconds: 300 }, async (req, res) => {
  try {
    const uid = (req.body?.uid ?? req.query?.uid ?? '').toString().trim();
    const baselineRaw = (req.body?.baseline ?? req.query?.baseline ?? '').toString();
    const baseline = normalizeSymbol(baselineRaw) || 'QQQ';

    if (!uid) {
      res.status(400).json({ ok: false, error: 'missing_uid' });
      return;
    }

    const allPairs = Array.isArray(pairsRegistryConfig.pairs) ? pairsRegistryConfig.pairs : [];
    const baselinePairs = allPairs.filter((p) => normalizeSymbol(p.baseline) === baseline);

    // Sector ETF set mirrors the generator script.
    const SECTOR_ETFS = new Set<string>([
      'XLB',
      'XLC',
      'XLE',
      'XLF',
      'XLI',
      'XLK',
      'XLP',
      'XLU',
      'XLV',
      'XLY',
      'XME',
      'XSD',
    ]);

    const sectorTargets = new Set<string>();
    const constituentTargets = new Set<string>();

    for (const p of baselinePairs) {
      const target = normalizeSymbol(p.target);
      if (!target) continue;
      if (SECTOR_ETFS.has(target)) {
        sectorTargets.add(target);
      } else {
        constituentTargets.add(target);
      }
    }

    const baseLower = String(baseline || '').toLowerCase();
    const constituentsListId = `${baseLower}-constituents`;
    const sectorsListId = `${baseLower}-sectors`;

    const listsCol = db.collection(`users/${uid}/lists`);
    const now = Date.now();

    const toCompanyArray = (syms: Set<string>) =>
      Array.from(syms).sort().map((s) => ({ symbol: s, company: s }));

    const constituentsPayload = {
      name: constituentsListId,
      baseline,
      symbols: toCompanyArray(constituentTargets),
      ranksDataWithColors: null,
      updatedAt: now,
    };

    const sectorsPayload = {
      name: sectorsListId,
      baseline,
      symbols: toCompanyArray(sectorTargets),
      ranksDataWithColors: null,
      updatedAt: now,
    };

    await Promise.all([
      listsCol.doc(constituentsListId).set(constituentsPayload, { merge: true }),
      listsCol.doc(sectorsListId).set(sectorsPayload, { merge: true }),
    ]);

    const summary = {
      ok: true,
      uid,
      baseline,
      constituentsCount: constituentsPayload.symbols.length,
      sectorsCount: sectorsPayload.symbols.length,
      constituentsListId,
      sectorsListId,
    };

    logger.info('seedUserListsFromConfigAdmin_completed', summary);
    res.status(200).json(summary);
  } catch (e: any) {
    logger.error('seedUserListsFromConfigAdmin_failed', { message: e?.message, code: e?.code });
    res.status(500).json({ ok: false, error: e?.message || 'seed_user_lists_failed' });
  }
});
