import { onRequest } from 'firebase-functions/v2/https';
import { logger } from 'firebase-functions';
import { generateShardSnapshot, getShardDateRange, getShardDocId, getShardId } from './heatmap-snapshots';
import { db } from '../../firebase-admin-init';
import { HEATMAP_SNAPSHOTS_COLLECTION } from '../../webhooks/webhooks-config';

/**
 * HTTP admin endpoint to rebuild heatmap snapshots.
 * Protected by admin token check.
 * 
 * Usage:
 *   curl -X POST https://us-central1-rel-str.cloudfunctions.net/rebuildHeatmapSnapshotsHttpAdmin \
 *     -H "Authorization: Bearer local-admin" \
 *     -H "Content-Type: application/json" \
 *     -d '{"baselines":["QQQ"],"timeframe":"DAILY","year":2026,"half":1}'
 * 
 * Or rebuild all baselines:
 *   curl -X POST https://us-central1-rel-str.cloudfunctions.net/rebuildHeatmapSnapshotsHttpAdmin \
 *     -H "Authorization: Bearer local-admin" \
 *     -H "Content-Type: application/json" \
 *     -d '{"all":true,"timeframe":"DAILY","year":2026,"half":1}'
 */
export const rebuildHeatmapSnapshotsHttpAdmin = onRequest(
  { region: 'us-central1', timeoutSeconds: 540, cors: true },
  async (req, res) => {
    // Admin token check
    const authHeader = req.headers.authorization || '';
    const token = authHeader.replace(/^Bearer\s+/i, '');
    const validTokens = ['local-admin', process.env.ADMIN_BACKFILL_TOKEN].filter(Boolean);
    
    if (!validTokens.includes(token)) {
      logger.warn('rebuildHeatmapSnapshotsHttpAdmin_unauthorized', { token: token.slice(0, 10) });
      res.status(401).json({ ok: false, message: 'Unauthorized' });
      return;
    }

    const body = req.body || {};
    const useAll = Boolean(body.all ?? false);
    let baselines: string[] = Array.isArray(body.baselines) 
      ? body.baselines.map((b: any) => String(b).toUpperCase()) 
      : [];
    
    const timeframe = String(body.timeframe || 'DAILY').toUpperCase() as 'DAILY' | 'WEEKLY' | 'MONTHLY';
    const year = body.year ? Number(body.year) : undefined;
    const half = body.half ? Number(body.half) : undefined;
    const yearStart = body.yearStart ? Number(body.yearStart) : undefined;
    const yearEnd = body.yearEnd ? Number(body.yearEnd) : undefined;

    const ALL_BASELINES = ['SPY', 'QQQ', 'XLB', 'XLC', 'XLE', 'XLF', 'XLI', 'XLK', 'XLP', 'XLU', 'XLV', 'XLY', 'XME', 'XPH', 'XSD'];
    
    if (useAll) {
      baselines = ALL_BASELINES;
    }

    if (!baselines || baselines.length === 0) {
      logger.warn('rebuildHeatmapSnapshotsHttpAdmin_missing_baselines');
      res.status(400).json({ ok: false, message: 'Missing baselines array (or set all=true)' });
      return;
    }

    logger.info('rebuildHeatmapSnapshotsHttpAdmin_start', {
      baselines: baselines.length,
      timeframe,
      year,
      half,
      yearStart,
      yearEnd,
    });

    const results: Array<{ baseline: string; ok: boolean; docId?: string; pairs?: number; dates?: number; message?: string }> = [];

    for (const baseline of baselines) {
      try {
        const params = { year, half, yearStart, yearEnd };
        const docId = getShardDocId(baseline, timeframe, params);
        const shardId = getShardId(timeframe, params);
        const dateRange = getShardDateRange(timeframe, params);

        logger.info('rebuildHeatmapSnapshotsHttpAdmin_generating', {
          baseline,
          timeframe,
          docId,
          shardId,
          dateRange,
        });

        const snapshot = await generateShardSnapshot(baseline, timeframe, dateRange, shardId);
        await db.collection(HEATMAP_SNAPSHOTS_COLLECTION).doc(docId).set(snapshot, { merge: false });

        logger.info('rebuildHeatmapSnapshotsHttpAdmin_success', {
          baseline,
          docId,
          pairs: snapshot.pairs.length,
          dates: snapshot.dates.length,
        });

        results.push({
          baseline,
          ok: true,
          docId,
          pairs: snapshot.pairs.length,
          dates: snapshot.dates.length,
        });
      } catch (e: any) {
        const message = e?.message ? String(e.message) : String(e);
        logger.error('rebuildHeatmapSnapshotsHttpAdmin_error', {
          baseline,
          message,
        });
        results.push({
          baseline,
          ok: false,
          message,
        });
      }
    }

    const successCount = results.filter(r => r.ok).length;
    const failureCount = results.filter(r => !r.ok).length;

    logger.info('rebuildHeatmapSnapshotsHttpAdmin_complete', {
      total: results.length,
      success: successCount,
      failures: failureCount,
    });

    res.status(200).json({
      ok: true,
      total: results.length,
      success: successCount,
      failures: failureCount,
      results,
    });
  }
);
