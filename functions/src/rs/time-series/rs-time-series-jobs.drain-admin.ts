import { onRequest } from 'firebase-functions/v2/https';
import { logger } from 'firebase-functions/v2';

import { db } from '../../firebase-admin-init';
import { Interval } from '../../types/signal.types';
import { RsPhase } from '../../types/partner';

import {
  RS_BACKFILL_RUNS_ROOT,
  RsJobStatus,
  RsJobType,
} from './rs-time-series-jobs.model';
import type { ProcessRsJobPayload } from './rs-time-series-jobs.helper';
import { processRsJobInternal } from './rs-time-series-jobs.worker';

/**
 * HTTP (admin): drainRsBackfillRunAdmin
 *
 * Emulator-friendly helper to execute RS backfill jobs for a given runId
 * without relying on Cloud Tasks dispatch. This is intended for local
 * validation of the RS worker logic and Firestore writes.
 *
 * Protect with bearer ADMIN_BACKFILL_TOKEN.
 *
 * Query/body: { runId: string, pairId?: string, maxJobs?: number }
 */
export const drainRsBackfillRunAdmin = onRequest({ region: 'us-central1', timeoutSeconds: 540 }, async (req, res) => {
  const token = (req.headers['authorization'] || '').toString().replace(/^Bearer\s+/i, '');
  const expected = (process.env.ADMIN_BACKFILL_TOKEN || '').trim();
  if (!expected || token !== expected) {
    res.status(401).json({ ok: false, error: 'unauthorized' });
    return;
  }

  try {
    const body = (req.method === 'POST' ? (req.body || {}) : (req.query || {})) as any;
    const runId = String(body.runId || body.runID || '').trim();
    const pairIdFilterRaw = body.pairId ?? body.pair ?? req.query.pairId ?? req.query.pair;
    const pairIdFilter = pairIdFilterRaw ? String(pairIdFilterRaw).trim().toUpperCase() : undefined;
    const maxJobsRaw = body.maxJobs ?? req.query.maxJobs;
    const maxJobs = maxJobsRaw !== undefined ? Number(maxJobsRaw) : undefined;

    if (!runId) {
      res.status(400).json({ ok: false, error: 'missing_runId' });
      return;
    }

    const jobsColl = db.collection(`${RS_BACKFILL_RUNS_ROOT}/${runId}/jobs`);
    let query: FirebaseFirestore.Query<FirebaseFirestore.DocumentData> = jobsColl
      .where('jobType', '==', RsJobType.BACKFILL)
      .where('status', '==', RsJobStatus.PENDING);

    if (pairIdFilter) {
      query = query.where('pairId', '==', pairIdFilter);
    }

    if (typeof maxJobs === 'number' && Number.isFinite(maxJobs) && maxJobs > 0) {
      query = query.limit(maxJobs);
    }

    const snap = await query.get();
    if (snap.empty) {
      res.status(200).json({ ok: true, runId, processedJobs: 0, message: 'no_pending_jobs' });
      return;
    }

    let processed = 0;
    const errors: Array<{ jobPath: string; message: string }> = [];

    for (const doc of snap.docs) {
      const data = doc.data() as any;
      const pairId = String(data.pairId || '').trim() || `${data.baseline}-${data.target}`;
      const baseline = String(data.baseline || '').trim();
      const target = String(data.target || '').trim();
      const interval = String(data.interval || '').toUpperCase() as Interval;
      const phase = String(data.phase || '').toLowerCase() as RsPhase;
      const from = String(data.from || '').slice(0, 10);
      const to = String(data.to || '').slice(0, 10);

      if (!baseline || !target || !from || !to) {
        errors.push({ jobPath: doc.ref.path, message: 'missing_required_fields' });
        continue;
      }

      const payload: ProcessRsJobPayload = {
        jobType: RsJobType.BACKFILL,
        runId,
        marketDate: undefined,
        pairId,
        baseline,
        target,
        interval,
        phase,
        from,
        to,
      };

      try {
        await processRsJobInternal(payload);
        processed++;
      } catch (e: any) {
        const message = e?.message ? String(e.message) : String(e);
        errors.push({ jobPath: doc.ref.path, message });
        logger.error('drainRsBackfillRunAdmin_job_failed', { jobPath: doc.ref.path, message });
      }
    }

    const response: any = {
      ok: errors.length === 0,
      runId,
      processedJobs: processed,
      pendingJobsScanned: snap.size,
      errors,
    };

    res.status(errors.length === 0 ? 200 : 207).json(response);
  } catch (e: any) {
    logger.error('drainRsBackfillRunAdmin_failed', { message: e?.message });
    res.status(500).json({ ok: false, error: e?.message || 'internal_error' });
  }
});
