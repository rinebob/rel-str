/**
 * @topic #553 — Paper Trading Infra · Thread #1059 (task #1076)
 *
 * `generateTradeDataset` callable — the run-config entry point. Validates
 * the params (exit-rule grammar via the exit-registry parser, ISO bar
 * range, whitelists), writes the `generating` index doc carrying the full
 * params as provenance, enqueues `analysisDatasetTask`, returns the
 * datasetId. Generation itself runs in the task (#1077 live / #1078
 * replay) — no callable writes a dataset synchronously.
 *
 * Dataset ids are versioned and never overwritten:
 * `ds-{yyyymmdd}-{origin}-{hash8}` where the hash covers canonical params
 * + timestamp + nonce — two same-day runs always get distinct ids.
 */

import { createHash, randomBytes } from 'node:crypto';
import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { getFunctions } from 'firebase-admin/functions';
import { getStorage } from 'firebase-admin/storage';
import { logger } from 'firebase-functions/v2';

import {
  PaperTradingKind,
} from '@paper-trading/contracts';
import {
  ENTRY_CONVENTIONS,
  SIGNAL_TYPES,
  type AnalysisDatasetDoc,
  type AnalysisDatasetOrigin,
  type AnalysisDatasetTaskPayload,
  type AnalysisRunParams,
  type FetchDatasetCsvRequest,
  type FetchDatasetCsvResponse,
  type GenerateTradeDatasetRequest,
  type GenerateTradeDatasetResponse,
} from '@paper-trading/analysis';
import {
  analysisDatasetsPath,
  analysisDatasetGcsPath,
} from '@paper-trading/ids';
import { db } from '../../firebase-admin-init';
import { parseVariantKey } from '../exits/registry';
import { OPTIONS_STRATEGY_ALLOWED_ORIGINS } from '../engine/options-strategy-cors';

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const ORIGINS: readonly AnalysisDatasetOrigin[] = ['live', 'replay'];
/** PRD exit-rule grammar — the three firing families. `limit-stddev` is
 *  registered but stubbed, so it is deliberately not admitted here. */
const EXIT_FAMILIES = ['initial-stop', 'trailing-stop', 'time-stop'] as const;

export interface GenerateDatasetDeps {
  /** Creates the index doc (no merge — the id is freshly minted). */
  createIndexDoc(datasetId: string, doc: AnalysisDatasetDoc): Promise<void>;
  /** Merge-update on the index doc — used to flip `failed` when the
   *  enqueue fails so the doc never wedges at `generating`. */
  updateIndexDoc(datasetId: string, fields: Partial<AnalysisDatasetDoc>): Promise<void>;
  /** `getFunctions().taskQueue('analysisDatasetTask').enqueue(...)`. */
  enqueueTask(payload: AnalysisDatasetTaskPayload): Promise<void>;
  now(): Date;
  /** Entropy for id uniqueness — `randomBytes(4).toString('hex')` in prod. */
  nonce(): string;
}

function fail(message: string): never {
  throw new HttpsError('invalid-argument', message);
}

function validate(data: Partial<GenerateTradeDatasetRequest>): asserts data is GenerateTradeDatasetRequest {
  if (!data || typeof data !== 'object') fail('generateTradeDataset requires a params object');
  if (!ORIGINS.includes(data.origin as AnalysisDatasetOrigin)) {
    fail(`origin must be one of ${ORIGINS.join('|')}`);
  }
  if (data.symbolScope !== undefined &&
      (!Array.isArray(data.symbolScope) || data.symbolScope.some((s) => typeof s !== 'string'))) {
    fail('symbolScope must be a string array (empty = all)');
  }
  if (data.signalTypes !== undefined &&
      (!Array.isArray(data.signalTypes) || data.signalTypes.some((s) => typeof s !== 'string'))) {
    fail('signalTypes must be a string array (empty = all)');
  }
  for (const t of data.signalTypes ?? []) {
    if (!SIGNAL_TYPES.includes(t)) fail(`unknown signalType '${t}'`);
  }
  if (typeof data.exitRule !== 'string') {
    fail(`exitRule '${data.exitRule}' is not exit-registry grammar (trailing-{pct}, time-{N}d, initial-stop-{pct})`);
  }
  const exitDef = parseVariantKey(data.exitRule);
  // PRD grammar admits three families — `limit-stddev` parses in the
  // registry but is stubbed never to fire; accepting it would mint a
  // dataset where every trade stays OPEN.
  if (!exitDef || !(EXIT_FAMILIES as readonly string[]).includes(exitDef.family)) {
    fail(`exitRule '${data.exitRule}' is not exit-registry grammar (trailing-{pct}, time-{N}d, initial-stop-{pct})`);
  }
  const br = data.barRange;
  const isoDay = (s: string) => ISO_DATE.test(s) && !Number.isNaN(Date.parse(`${s}T00:00:00Z`));
  if (!br || typeof br.from !== 'string' || typeof br.to !== 'string' ||
      !isoDay(br.from) || !isoDay(br.to) || br.from > br.to) {
    fail('barRange must be { from, to } real ISO YYYY-MM-DD dates with from <= to');
  }
  if (!ENTRY_CONVENTIONS.includes(data.entryConvention as never)) {
    fail(`entryConvention must be one of ${ENTRY_CONVENTIONS.join('|')}`);
  }
  if (data.entryFilters !== undefined &&
      (typeof data.entryFilters !== 'object' || data.entryFilters === null || Array.isArray(data.entryFilters))) {
    fail('entryFilters must be a plain object when present');
  }
}

/** Canonical params string — order-stable so identical configs hash alike. */
function canonicalParams(p: AnalysisRunParams): string {
  return [
    p.origin,
    [...p.symbolScope].sort().join(','),
    [...p.signalTypes].sort().join(','),
    p.exitRule,
    `${p.barRange.from}..${p.barRange.to}`,
    p.entryConvention,
    JSON.stringify(p.entryFilters ?? null),
  ].join('|');
}

/** `ds-{yyyymmdd}-{origin}-{hash8}` — hash covers params + time + nonce. */
export function mintDatasetId(now: Date, params: AnalysisRunParams, nonce: string): string {
  const date = now.toISOString().slice(0, 10).replace(/-/g, '');
  const hash = createHash('sha256')
    .update(`${canonicalParams(params)}|${now.toISOString()}|${nonce}`)
    .digest('hex')
    .slice(0, 8);
  return `ds-${date}-${params.origin}-${hash}`;
}

export async function handleGenerateTradeDataset(
  request: { data?: unknown; auth?: { uid: string } },
  deps: GenerateDatasetDeps,
): Promise<GenerateTradeDatasetResponse> {
  if (!request.auth) {
    throw new HttpsError('unauthenticated', 'Must be signed in to generate a dataset');
  }
  const data = (request.data ?? {}) as Partial<GenerateTradeDatasetRequest>;
  validate(data);

  const params: AnalysisRunParams = {
    origin: data.origin,
    // Symbols key uppercase everywhere in the ledger — normalize the scope
    // so a lowercase entry can't silently produce an empty dataset.
    symbolScope: (data.symbolScope ?? [])
      .map((s) => s.trim().toUpperCase())
      .filter((s) => s.length > 0),
    signalTypes: data.signalTypes ?? [],
    exitRule: data.exitRule,
    barRange: data.barRange,
    entryConvention: data.entryConvention,
    ...(data.entryFilters !== undefined ? { entryFilters: data.entryFilters } : {}),
  };

  const now = deps.now();
  const datasetId = mintDatasetId(now, params, deps.nonce());
  const nowIso = now.toISOString();
  const doc: AnalysisDatasetDoc = {
    kind: PaperTradingKind.ANALYSIS_DATASET,
    id: datasetId,
    createdAt: nowIso,
    updatedAt: nowIso,
    origin: params.origin,
    status: 'generating',
    symbolScope: params.symbolScope,
    signalTypes: params.signalTypes,
    exitRule: params.exitRule,
    barRange: params.barRange,
    entryConvention: params.entryConvention,
    generatedAt: nowIso,
    gcsPath: analysisDatasetGcsPath(datasetId),
    tags: [],
    ...(params.entryFilters !== undefined ? { entryFilters: params.entryFilters } : {}),
  };

  await deps.createIndexDoc(datasetId, doc);
  try {
    await deps.enqueueTask({ datasetId, params });
  } catch (err) {
    // Doc exists but no task will ever run — flip failed so the library
    // doesn't show a permanently-'generating' dataset, then surface.
    const message = err instanceof Error ? err.message : String(err);
    await deps.updateIndexDoc(datasetId, {
      status: 'failed',
      error: `enqueue failed: ${message}`,
      generatedAt: deps.now().toISOString(),
    }).catch((flipErr) => {
      logger.error('analysis_dataset_enqueue_failed_transition_failed', {
        datasetId,
        error: flipErr instanceof Error ? flipErr.message : String(flipErr),
      });
    });
    throw new HttpsError('unavailable', `dataset task enqueue failed: ${message}`);
  }
  logger.info('analysis_dataset_enqueued', { datasetId, origin: params.origin });
  return { datasetId };
}

function prodDeps(): GenerateDatasetDeps {
  return {
    createIndexDoc: (id, doc) =>
      db.collection(analysisDatasetsPath()).doc(id).set(doc).then(() => {}),
    updateIndexDoc: (id, fields) =>
      db.collection(analysisDatasetsPath()).doc(id).set(fields, { merge: true }).then(() => {}),
    enqueueTask: (payload) =>
      getFunctions().taskQueue('analysisDatasetTask').enqueue(payload).then(() => {}),
    now: () => new Date(),
    nonce: () => randomBytes(4).toString('hex'),
  };
}

export const generateTradeDataset = onCall<
  GenerateTradeDatasetRequest,
  Promise<GenerateTradeDatasetResponse>
>(
  {
    cors: OPTIONS_STRATEGY_ALLOWED_ORIGINS,
    timeoutSeconds: 60,
  },
  async (request) => {
    try {
      return await handleGenerateTradeDataset(request, prodDeps());
    } catch (err) {
      if (err instanceof HttpsError) throw err;
      throw new HttpsError(
        'internal',
        `generateTradeDataset failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  },
);

// ── fetchDatasetCsv ───────────────────────────────────────────────────────

/**
 * `fetchDatasetCsv` callable — the workbench's CSV read path (QA #1147).
 * Reads the dataset's Storage object server-side and returns the body so
 * the browser never fetches firebasestorage.googleapis.com directly —
 * client networks that blackhole QUIC/UDP hang forever on a plain
 * download fetch, while callables ride the same connection the rest of
 * the app already uses.
 */
export interface FetchDatasetDeps {
  readIndexDoc(datasetId: string): Promise<AnalysisDatasetDoc | null>;
  readObject(gcsPath: string): Promise<Buffer>;
}

/** Callable JSON responses carry the CSV inline — guard well under the
 *  32 MiB HTTP ceiling; real datasets are trade rows (~400 B each). */
const MAX_CSV_BYTES = 24 * 1024 * 1024;

export async function handleFetchDatasetCsv(
  request: { data?: unknown; auth?: { uid: string } },
  deps: FetchDatasetDeps,
): Promise<FetchDatasetCsvResponse> {
  if (!request.auth) {
    throw new HttpsError('unauthenticated', 'Must be signed in to fetch a dataset');
  }
  const datasetId = (request.data as FetchDatasetCsvRequest | undefined)?.datasetId;
  if (typeof datasetId !== 'string' || !datasetId.trim()) {
    throw new HttpsError('invalid-argument', 'fetchDatasetCsv requires { datasetId }');
  }
  const doc = await deps.readIndexDoc(datasetId);
  if (!doc) {
    throw new HttpsError('not-found', `dataset '${datasetId}' not found`);
  }
  const gcsPath = doc.gcsPath || analysisDatasetGcsPath(datasetId);
  const buf = await deps.readObject(gcsPath);
  if (buf.length > MAX_CSV_BYTES) {
    throw new HttpsError(
      'resource-exhausted',
      `dataset '${datasetId}' is ${buf.length} bytes — too large to fetch via callable`,
    );
  }
  return { csv: buf.toString('utf8') };
}

function fetchDeps(): FetchDatasetDeps {
  return {
    readIndexDoc: (id) =>
      db
        .collection(analysisDatasetsPath())
        .doc(id)
        .get()
        .then((s) => (s.exists ? (s.data() as AnalysisDatasetDoc) : null)),
    readObject: (gcsPath) =>
      getStorage()
        .bucket()
        .file(gcsPath)
        .download()
        .then(([buf]) => buf),
  };
}

export const fetchDatasetCsv = onCall<
  FetchDatasetCsvRequest,
  Promise<FetchDatasetCsvResponse>
>(
  {
    cors: OPTIONS_STRATEGY_ALLOWED_ORIGINS,
    timeoutSeconds: 60,
  },
  async (request) => {
    try {
      return await handleFetchDatasetCsv(request, fetchDeps());
    } catch (err) {
      if (err instanceof HttpsError) throw err;
      throw new HttpsError(
        'internal',
        `fetchDatasetCsv failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  },
);
