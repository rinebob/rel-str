import { onRequest } from 'firebase-functions/v2/https';
import { logger } from 'firebase-functions/v2';

import { db, FieldValue } from '../../firebase-admin-init';
import { Interval } from '../../types/signal.types';
import { RsPhase } from '../../types/partner';
import { listRegisteredPairs } from '../../webhooks/registry';
import { SILENCE_ADMIN_INFO } from '../../webhooks/webhooks-config';

import {
  rsBackfillRunDocPath,
  type RsBackfillRunDoc,
  RsBackfillRunStatus,
} from './rs-time-series-jobs.model';
import { createOrUpdateBackfillJob } from './rs-time-series-jobs.helper';

export const recomputeRsBackfillAdmin = onRequest({ region: 'us-central1', timeoutSeconds: 540 }, async (req, res) => {
  const token = (req.headers['authorization'] || '').toString().replace(/^Bearer\s+/i, '');
  const expected = (process.env.ADMIN_BACKFILL_TOKEN || '').trim();
  if (!expected || token !== expected) {
    res.status(401).json({ ok: false, error: 'unauthorized' });
    return;
  }

  try {
    const phaseRaw = String((req.query.phase || (req.body as any)?.phase || RsPhase.POST)).toLowerCase();
    const from: string | undefined = (req.query.from as string) || (req.body as any)?.from;
    const to: string | undefined = (req.query.to as string) || (req.body as any)?.to;

    const intervalsRaw = (req.query.intervals ?? (req.body as any)?.intervals) as unknown;
    const normalizeInterval = (v: unknown): Interval | undefined => {
      const s = String(v || '').toUpperCase();
      if (s === Interval.DAILY || s === Interval.WEEKLY || s === Interval.MONTHLY) {
        return s as Interval;
      }
      return undefined;
    };

    let intervals: Interval[];
    if (Array.isArray(intervalsRaw)) {
      intervals = (intervalsRaw as unknown[])
        .map((v) => normalizeInterval(v))
        .filter((v): v is Interval => v !== undefined);
    } else if (intervalsRaw !== undefined) {
      const single = normalizeInterval(intervalsRaw);
      intervals = single ? [single] : [];
    } else {
      intervals = [Interval.DAILY, Interval.WEEKLY, Interval.MONTHLY];
    }
    if (intervals.length === 0) {
      intervals = [Interval.DAILY, Interval.WEEKLY, Interval.MONTHLY];
    }

    if (!from || !to) {
      res.status(400).json({ ok: false, error: 'missing_from_or_to' });
      return;
    }

    let pairs = await listRegisteredPairs();

    const pairParam = (req.query.pair || (req.body as any)?.pair) as string | undefined;
    const pairsParam = (req.query.pairs || (req.body as any)?.pairs) as any;

    if (pairParam && typeof pairParam === 'string' && pairParam.trim().length > 0) {
      const p = pairParam.trim().toUpperCase();
      pairs = pairs.filter((r) => `${r.baseline}-${r.target}` === p);
    } else if (pairsParam && Array.isArray(pairsParam) && pairsParam.length > 0) {
      const set = new Set(pairsParam.map((p: any) => String(p).trim().toUpperCase()));
      pairs = pairs.filter((r) => set.has(`${r.baseline}-${r.target}`));
    }

    if (pairs.length === 0) {
      res.status(200).json({ ok: true, message: 'no pairs matched filter', totalPairs: 0 });
      return;
    }

    const phases: RsPhase[] =
      phaseRaw === 'both'
        ? [RsPhase.PRE, RsPhase.POST]
        : phaseRaw === RsPhase.PRE
          ? [RsPhase.PRE]
          : [RsPhase.POST];

    if (!SILENCE_ADMIN_INFO) {
      logger.info('recomputeRsBackfillAdmin_start', {
        from,
        to,
        phases,
        intervals,
        totalPairs: pairs.length,
      });
    }

    const now = new Date();
    const year = now.getUTCFullYear();
    const month = String(now.getUTCMonth() + 1).padStart(2, '0');
    const day = String(now.getUTCDate()).padStart(2, '0');
    const hour = String(now.getUTCHours()).padStart(2, '0');
    const minute = String(now.getUTCMinutes()).padStart(2, '0');
    const second = String(now.getUTCSeconds()).padStart(2, '0');
    const runId = `rs-backfill-${year}${month}${day}-${hour}${minute}${second}`;

    const backfillRunDoc: RsBackfillRunDoc = {
      runId,
      from,
      to,
      phase: phases[0] ?? RsPhase.POST,
      intervals,
      pairCount: pairs.length,
      expectedJobs: pairs.length * intervals.length * phases.length,
      successJobs: 0,
      permanentFailureJobs: 0,
      status: RsBackfillRunStatus.IN_PROGRESS,
      createdAt: FieldValue.serverTimestamp() as FirebaseFirestore.Timestamp,
      updatedAt: FieldValue.serverTimestamp() as FirebaseFirestore.Timestamp,
      runCompletedAt: undefined,
    };

    const runDocPath = rsBackfillRunDocPath(runId);
    await db.doc(runDocPath).set(backfillRunDoc);

    let enqueuedJobs = 0;
    for (const ph of phases) {
      for (const { baseline, target } of pairs) {
        const pairId = `${baseline}-${target}`;
        for (const interval of intervals) {
          await createOrUpdateBackfillJob(runId, {
            pairId,
            baseline,
            target,
            interval,
            phase: ph,
            from,
            to,
          });
          enqueuedJobs++;
        }
      }
    }

    const payload = {
      ok: true,
      mode: 'enqueue',
      runId,
      from,
      to,
      phases,
      intervals,
      totalPairs: pairs.length,
      expectedJobs: backfillRunDoc.expectedJobs,
      enqueuedJobs,
    };

    if (!SILENCE_ADMIN_INFO) {
      logger.info('recomputeRsBackfillAdmin_done', payload);
    }

    res.status(202).json(payload);
  } catch (e: any) {
    logger.error('recomputeRsBackfillAdmin_failed', { message: e?.message });
    res.status(500).json({ ok: false, error: e?.message || 'internal_error' });
  }
});
