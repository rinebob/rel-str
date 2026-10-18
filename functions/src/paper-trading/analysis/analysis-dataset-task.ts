/**
 * @topic #553 — Paper Trading Infra · Thread #1059 (task #1076 stub)
 *
 * `analysisDatasetTask` Cloud Task target — exists now so the
 * `generateTradeDataset` callable's enqueue always resolves to a real
 * function (an undeployed target would wedge index docs at `generating`
 * and burn retries). The live-snapshot pass lands in #1077 and the replay
 * pass in #1078; until then the stub flips the index doc to `failed` with
 * an explicit error rather than pretending to generate.
 */

import { onTaskDispatched } from 'firebase-functions/v2/tasks';
import { logger } from 'firebase-functions/v2';

import type { AnalysisDatasetTaskPayload } from '@paper-trading/analysis';
import { analysisDatasetsPath } from '@paper-trading/ids';
import { db } from '../../firebase-admin-init';

export const analysisDatasetTask = onTaskDispatched<AnalysisDatasetTaskPayload>(
  {
    retryConfig: { maxAttempts: 1 },
    memory: '512MiB',
    timeoutSeconds: 540,
  },
  async (req) => {
    const { datasetId } = req.data;
    logger.warn('analysis_dataset_task_stub', { datasetId });
    await db.collection(analysisDatasetsPath()).doc(datasetId).set(
      {
        status: 'failed',
        error: 'analysisDatasetTask not implemented — generation lands in #1077/#1078',
        generatedAt: new Date().toISOString(),
      },
      { merge: true },
    );
  },
);
