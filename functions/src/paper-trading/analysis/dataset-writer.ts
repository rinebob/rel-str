/**
 * @topic #553 — Paper Trading Infra · Thread #1059 (task #1076)
 *
 * Dataset writer — the single write path for analysis datasets (IMPL §1).
 * Serializes rows through the SHARED codec, uploads the CSV to the default
 * Storage bucket at `analysis-datasets/{id}.csv`, then flips the index doc
 * `generating` → `ready` with rowCount/gcsPath. Any failure attempts the
 * `failed` transition with the error message so docs never wedge at
 * `generating`; the original error still propagates to the caller.
 *
 * Deps are injected: the callable/task wires the real bucket +
 * `analysisDatasetsPath()` collection; tests capture both.
 */

import { logger } from 'firebase-functions/v2';
import type { Storage } from 'firebase-admin/storage';
import type { Firestore } from 'firebase-admin/firestore';

import {
  type AnalysisDatasetDoc,
  type TradeAnalysisRow,
} from '@paper-trading/analysis';
import { serializeDataset } from '@paper-trading/analysis-csv';
import {
  analysisDatasetsPath,
  analysisDatasetGcsPath,
} from '@paper-trading/ids';
import { createArtifactWriter, type ArtifactWriter } from '../../screenshot-capture/storage-writer';

export type Bucket = ReturnType<Storage['bucket']>;

export interface DatasetWriterDeps {
  /** Uploads (path, body, contentType) — `createArtifactWriter(bucket)`. */
  writeObject: ArtifactWriter;
  /** Merges fields onto the index doc at `analysisDatasetsPath()/{id}`. */
  updateIndex(datasetId: string, fields: Partial<AnalysisDatasetDoc>): Promise<void>;
  now(): Date;
}

export function datasetWriterDeps(db: Firestore, bucket: Bucket): DatasetWriterDeps {
  return {
    writeObject: createArtifactWriter(bucket),
    updateIndex: (datasetId, fields) =>
      db.collection(analysisDatasetsPath()).doc(datasetId).set(fields, { merge: true }).then(() => {}),
    now: () => new Date(),
  };
}

/**
 * Serialize + upload + flip ready. Throws on any failure after recording
 * `failed` — callers (task handler) decide retry semantics.
 */
export async function writeDataset(
  rows: TradeAnalysisRow[],
  datasetId: string,
  deps: DatasetWriterDeps,
): Promise<void> {
  const gcsPath = analysisDatasetGcsPath(datasetId);
  const generatedAt = deps.now().toISOString();
  try {
    const csv = serializeDataset(rows);
    await deps.writeObject(gcsPath, csv, 'text/csv');
    await deps.updateIndex(datasetId, {
      status: 'ready',
      rowCount: rows.length,
      gcsPath,
      generatedAt,
    });
    logger.info('analysis_dataset_written', { datasetId, rows: rows.length });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error('analysis_dataset_failed', { datasetId, error: message });
    try {
      await deps.updateIndex(datasetId, { status: 'failed', error: message, generatedAt });
    } catch (failErr) {
      // Nothing left to do — the doc may wedge at generating; surface both.
      logger.error('analysis_dataset_failed_transition_failed', {
        datasetId,
        error: failErr instanceof Error ? failErr.message : String(failErr),
      });
    }
    throw err;
  }
}
