/**
 * @topic #553 — Paper Trading Infra · Thread #1059 (task #1077)
 *
 * `analysisDatasetTask` — the generation entry a `generateTradeDataset`
 * enqueue resolves to. The 'live' branch runs the snapshot pass (IMPL §3);
 * 'replay' stays a fail-loud stub until #1078 lands signal detection +
 * exit walking. Any failure — before or inside the writer — flips the
 * index doc to `failed` + error; nothing wedges at `generating`.
 */

import { onTaskDispatched } from 'firebase-functions/v2/tasks';
import { logger } from 'firebase-functions/v2';

import type { AnalysisDatasetTaskPayload } from '@paper-trading/analysis';
import { analysisDatasetsPath } from '@paper-trading/ids';
import { db } from '../../firebase-admin-init';
import { liveSnapshotDeps, runLiveSnapshot } from './live-snapshot';

async function failIndex(datasetId: string, error: string): Promise<void> {
  await db.collection(analysisDatasetsPath()).doc(datasetId).set(
    { status: 'failed', error, generatedAt: new Date().toISOString() },
    { merge: true },
  );
}

export const analysisDatasetTask = onTaskDispatched<AnalysisDatasetTaskPayload>(
  {
    retryConfig: { maxAttempts: 3 },
    memory: '1GiB',
    timeoutSeconds: 540,
  },
  async (req) => {
    const { datasetId, params } = req.data;
    // A payload without an id can't resolve its index doc — fail the task
    // before doc() would mint a random id and stamp 'failed' onto junk.
    if (typeof datasetId !== 'string' || !datasetId.trim()) {
      logger.error('analysis_dataset_task_no_id', { data: req.data });
      throw new Error('analysisDatasetTask payload missing datasetId');
    }
    try {
      if (params.origin === 'live') {
        const rows = await runLiveSnapshot(params, datasetId, liveSnapshotDeps());
        logger.info('analysis_dataset_live_done', { datasetId, rows });
        return;
      }
      await failIndex(
        datasetId,
        'replay generation not implemented — lands in #1078',
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error('analysis_dataset_task_failed', { datasetId, error: message });
      await failIndex(datasetId, message).catch((e) =>
        logger.error('analysis_dataset_task_failed_transition_failed', {
          datasetId,
          error: e instanceof Error ? e.message : String(e),
        }),
      );
      throw err;
    }
  },
);
