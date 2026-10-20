/**
 * Analysis Service (Thread #1059, task #1081) — the trading/analysis
 * surface's data layer: dataset index CRUD on analysisDatasetsPath(),
 * CSV payload load via Storage URL + papaparse (coerced through the
 * shared COLUMN_TYPES manifest, bound by header name so appended or
 * reordered columns keep old datasets readable), and slice CRUD on
 * analysisSlicesPath().
 *
 * Same pattern as AllocationBucketService: Observable-returning methods
 * gated on requireUserId, Firestore SDK calls wrapped in
 * runInInjectionContext.
 */
import {
  EnvironmentInjector,
  Injectable,
  inject,
  runInInjectionContext,
} from '@angular/core';
import { Auth } from '@angular/fire/auth';
import {
  Firestore,
  collection,
  deleteDoc,
  doc,
  getDocs,
  orderBy,
  query,
  setDoc,
  updateDoc,
} from '@angular/fire/firestore';
import {
  Storage,
  deleteObject,
  getDownloadURL,
  ref,
} from '@angular/fire/storage';
import { Functions, httpsCallable } from '@angular/fire/functions';
import { Observable, from } from 'rxjs';
import { switchMap, take } from 'rxjs/operators';
import Papa from 'papaparse';

import { requireUserId } from './firestore-helpers';
import { CallableName } from '../../../core/common/constants';
import {
  analysisDatasetsPath,
  analysisSlicesPath,
} from '@paper-trading/ids';
import {
  ANALYSIS_COLUMNS,
  type AnalysisDatasetDoc,
  type AnalysisRunParams,
  type AnalysisSlice,
  type GenerateTradeDatasetRequest,
  type GenerateTradeDatasetResponse,
  type SliceFilter,
  type TradeAnalysisRow,
} from '@paper-trading/analysis';
import { PaperTradingKind } from '@paper-trading/contracts';
import { COLUMN_TYPES } from '@paper-trading/analysis-csv';

/** A parsed CSV payload plus the header names actually present — the
 *  workbench needs `columns` to skip slice predicates a dataset lacks. */
export interface LoadedDataset {
  rows: TradeAnalysisRow[];
  columns: string[];
}

/** Coerce a papaparse string row into a full TradeAnalysisRow — every
 *  manifest key is present on the result; absent columns/cells → null. */
function coerceRow(raw: Record<string, string>): TradeAnalysisRow {
  const out = {} as Record<string, string | number | null>;
  for (const col of ANALYSIS_COLUMNS) {
    const v = raw[col.key];
    if (v === undefined || v === '') {
      out[col.key] = null;
    } else if (COLUMN_TYPES[col.key] === 'number') {
      const n = Number(v);
      out[col.key] = Number.isFinite(n) ? n : null;
    } else {
      out[col.key] = v;
    }
  }
  return out as unknown as TradeAnalysisRow;
}

@Injectable({ providedIn: 'root' })
export class AnalysisService {
  private readonly firestore = inject(Firestore);
  private readonly storage = inject(Storage);
  private readonly functions = inject(Functions);
  private readonly auth = inject(Auth);
  private readonly injector = inject(EnvironmentInjector);

  private inCtx<T>(fn: () => Promise<T>): Observable<T> {
    return from(runInInjectionContext(this.injector, fn));
  }

  // ── dataset index ──────────────────────────────────────────────────────

  /** All dataset index docs, newest first (generatedAt desc). */
  listDatasets$(): Observable<AnalysisDatasetDoc[]> {
    return requireUserId(this.auth, this.injector).pipe(
      take(1),
      switchMap(() =>
        this.inCtx(async () => {
          const q = query(
            collection(this.firestore, analysisDatasetsPath()),
            orderBy('generatedAt', 'desc'),
          );
          const snap = await getDocs(q);
          return snap.docs.map((d) => d.data() as AnalysisDatasetDoc);
        }),
      ),
    );
  }

  /** Merge-update tags/notes on the index doc — `notes` omitted leaves
   *  the stored value untouched; pass `null` to clear it. */
  updateTagsNotes$(
    datasetId: string,
    tags: string[],
    notes?: string | null,
  ): Observable<void> {
    return requireUserId(this.auth, this.injector).pipe(
      take(1),
      switchMap(() =>
        this.inCtx(() =>
          updateDoc(doc(this.firestore, analysisDatasetsPath(), datasetId), {
            tags,
            ...(notes !== undefined ? { notes } : {}),
            updatedAt: new Date().toISOString(),
          }),
        ),
      ),
    );
  }

  /**
   * Delete a dataset — Storage object first, then the index doc, so a
   * failed object delete leaves the whole dataset intact and retryable.
   * `object-not-found` is tolerated: generating/failed datasets have a
   * gcsPath but no object, and a retry after a partial delete must still
   * reach the doc.
   */
  deleteDataset$(dataset: AnalysisDatasetDoc): Observable<void> {
    return requireUserId(this.auth, this.injector).pipe(
      take(1),
      switchMap(() =>
        this.inCtx(async () => {
          try {
            await deleteObject(ref(this.storage, dataset.gcsPath));
          } catch (err) {
            if ((err as { code?: string })?.code !== 'storage/object-not-found') {
              throw err;
            }
          }
          await deleteDoc(doc(this.firestore, analysisDatasetsPath(), dataset.id));
        }),
      ),
    );
  }

  /**
   * Enqueue dataset generation via the `generateTradeDataset` callable
   * (task #1076/#1082). The callable validates the run params, mints a
   * `generating` index doc, and returns its id — the workbench observes
   * the pending entry through `listDatasets$` until status flips.
   */
  generateDataset$(params: AnalysisRunParams): Observable<string> {
    return requireUserId(this.auth, this.injector).pipe(
      take(1),
      switchMap(() =>
        this.inCtx(async () => {
          const callable = httpsCallable<
            GenerateTradeDatasetRequest,
            GenerateTradeDatasetResponse
          >(this.functions, CallableName.GENERATE_TRADE_DATASET);
          const res = await callable(params);
          return res.data.datasetId;
        }),
      ),
    );
  }

  /**
   * Fetch + parse a dataset's CSV: gcsPath → getDownloadURL → fetch →
   * papaparse → coerce by COLUMN_TYPES. Binding is by header NAME, so a
   * CSV with reordered or appended columns still produces full rows;
   * columns the file lacks come back null.
   */
  loadDataset$(dataset: AnalysisDatasetDoc): Observable<LoadedDataset> {
    return requireUserId(this.auth, this.injector).pipe(
      take(1),
      switchMap(() =>
        this.inCtx(async () => {
          const url = await getDownloadURL(ref(this.storage, dataset.gcsPath));
          const res = await fetch(url);
          if (!res.ok) {
            throw new Error(`dataset fetch failed (HTTP ${res.status})`);
          }
          const parsed = Papa.parse<Record<string, string>>(await res.text(), {
            header: true,
            skipEmptyLines: true,
          });
          if (parsed.errors.length > 0) {
            const e = parsed.errors[0];
            throw new Error(`CSV parse failed: ${e.message} (row ${e.row ?? '?'})`);
          }
          const columns = parsed.meta.fields ?? [];
          return { rows: parsed.data.map(coerceRow), columns };
        }),
      ),
    );
  }

  // ── slices ─────────────────────────────────────────────────────────────

  /** All saved slices. */
  listSlices$(): Observable<AnalysisSlice[]> {
    return requireUserId(this.auth, this.injector).pipe(
      take(1),
      switchMap(() =>
        this.inCtx(async () => {
          const snap = await getDocs(collection(this.firestore, analysisSlicesPath()));
          return snap.docs.map((d) => d.data() as AnalysisSlice);
        }),
      ),
    );
  }

  /** Persist a named slice — filters serialize verbatim per the contract. */
  saveSlice$(name: string, filters: SliceFilter[], note?: string): Observable<AnalysisSlice> {
    return requireUserId(this.auth, this.injector).pipe(
      take(1),
      switchMap(() =>
        this.inCtx(async () => {
          const ref = doc(collection(this.firestore, analysisSlicesPath()));
          const now = new Date().toISOString();
          const slice: AnalysisSlice = {
            kind: PaperTradingKind.ANALYSIS_SLICE,
            id: ref.id,
            createdAt: now,
            updatedAt: now,
            name: name.trim(),
            filters,
            ...(note ? { note } : {}),
          };
          await setDoc(ref, slice);
          return slice;
        }),
      ),
    );
  }

  /** Merge-update a slice (name/note/filters). */
  updateSlice$(
    sliceId: string,
    fields: Partial<Pick<AnalysisSlice, 'name' | 'note' | 'filters'>>,
  ): Observable<void> {
    return requireUserId(this.auth, this.injector).pipe(
      take(1),
      switchMap(() =>
        this.inCtx(() =>
          updateDoc(doc(this.firestore, analysisSlicesPath(), sliceId), {
            ...fields,
            updatedAt: new Date().toISOString(),
          }),
        ),
      ),
    );
  }

  /** Delete a slice doc. */
  deleteSlice$(sliceId: string): Observable<void> {
    return requireUserId(this.auth, this.injector).pipe(
      take(1),
      switchMap(() =>
        this.inCtx(() =>
          deleteDoc(doc(this.firestore, analysisSlicesPath(), sliceId)),
        ),
      ),
    );
  }
}
