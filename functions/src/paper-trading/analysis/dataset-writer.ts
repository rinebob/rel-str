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
  /** Persists the CSV as ordered chunk docs under the index doc —
   *  `items/{id}/chunks/{i}` — so the workbench can read the payload
   *  over the Firestore channel (QA #1147: networks that stall large
   *  HTTPS response bodies can't fetch GCS/callable payloads). */
  writeChunks(datasetId: string, csv: string): Promise<void>;
  /** Merges fields onto the index doc at `analysisDatasetsPath()/{id}`. */
  updateIndex(datasetId: string, fields: Partial<AnalysisDatasetDoc>): Promise<void>;
  now(): Date;
}

/** ~400 KB per chunk doc — safely under the 1 MiB doc ceiling. */
const CHUNK_BYTES = 400 * 1024;

/** Firestore mirror of the CSV: `items/{id}/chunks/{i}` docs carrying
 *  `{ i, data }` — read back in `i` order and concatenated. */
export async function writeDatasetChunks(
  db: Firestore,
  datasetId: string,
  csv: string,
): Promise<void> {
  const chunks: string[] = [];
  for (let off = 0; off < csv.length; off += CHUNK_BYTES) {
    chunks.push(csv.slice(off, off + CHUNK_BYTES));
  }
  // 500-write batch ceiling — flush full batches sequentially.
  for (let i = 0; i < chunks.length; i += 450) {
    const batch = db.batch();
    for (let j = i; j < Math.min(i + 450, chunks.length); j++) {
      const ref = db
        .collection(analysisDatasetsPath())
        .doc(datasetId)
        .collection('chunks')
        .doc(String(j).padStart(4, '0'));
      batch.set(ref, { i: j, data: chunks[j] });
    }
    await batch.commit();
  }
}

export function datasetWriterDeps(db: Firestore, bucket: Bucket): DatasetWriterDeps {
  return {
    writeObject: createArtifactWriter(bucket),
    writeChunks: (datasetId, csv) => writeDatasetChunks(db, datasetId, csv),
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
    await deps.writeChunks(datasetId, csv);
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
