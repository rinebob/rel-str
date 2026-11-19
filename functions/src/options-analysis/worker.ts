/**
 * `worker.ts` — `optionsReplayAnalysis` Cloud Task worker (Topic #1238,
 * Thread #1266, task #1372; IMPL-BE §3).
 *
 * One task per contract list: re-validate the list doc, narrow v1→v2
 * (#1500 — `pick` rows become 1-leg positions), batch-fetch each
 * OPTION leg's contract series (stock legs resolve off the
 * underlying-close map), join legs into a signed net cost-to-close
 * series, evaluate EVERY registry exit independently (`evaluateExit`
 * — #1371), derive expired/open/error outcomes, aggregate per exit
 * type, and write `st-options-analysis-results/{listDocId}_{exitId}`
 * with a full `set()` — overwrite semantics make every rerun
 * idempotent and kill the merge stale-`error`-field trap.
 *
 * Status re-check (required by #1370 review + IMPL-BE §3): the doc's
 * `success` was checked at enqueue time, not atomically with execution —
 * a concurrent `optionsReplayRetry` may have reset it before dispatch.
 * Missing doc / `status !== 'success'` / missing `rows` is a
 * reset-in-progress → throw (Cloud Task retry); on the FINAL attempt
 * log + return WITHOUT writes (never clobber good result docs with
 * zero-count failures).
 *
 * Outcome mapping per (position row × rule):
 * - `fired` → 'exit' (daysHeld = calendar days pickDate→exitDate)
 * - `!fired` + last LIVE bar is the expiry bar → 'expired' + expiry
 *   fields (needs the symbol's underlying close at expiry — missing →
 *   'error', never fabricated)
 * - `!fired` + series ends before expiry + expiry still FUTURE → 'open'
 *   (live position — real excursion, days-held-so-far, lastBarDate)
 * - `!fired` + series ends before a PAST expiry / empty / fetch failed →
 *   'error' with the entry-day placeholder excursion (`daysHeld: 0`)
 *
 * All effects sit behind `AnalysisWorkerDeps` (TEST-BE seams); the
 * `onTaskDispatched` wrapper injects production wiring. No 'running'
 * docs — results appear complete per exit type.
 *
 * IMPL-BE's `ANALYSIS_CHUNK_THRESHOLD` escape hatch (row-slice
 * sub-tasks for oversized lists) is deferred — not expected to
 * trigger at v1 pick-list sizes (~250 rows max).
 */

import { onTaskDispatched } from 'firebase-functions/v2/tasks';
import { logger } from 'firebase-functions/logger';

import { db } from '../firebase-admin-init';
import { getCachedBarsFromSymbolData } from '../st-cloud-function/data-loader';
import { getMarketDatePT } from '../common/pt-date-utils';
import { forEachWithConcurrency } from '../common/async-utils';
import { callPartnerHistoricalOptionsContractV2 } from '../options-contract-proxy';
import {
  ST_OPTIONS_ANALYSIS_RESULTS_ROOT,
  ST_OPTIONS_CONTRACT_LISTS_ROOT,
  stOptionsAnalysisResultDocId,
} from '@st/collections';
import type {
  ContractListPositionRow,
  OptionsContractListDoc,
  OptionsContractListDocV1,
} from '@options-replay/contracts';
import { v1ListDocToV2 } from '@options-replay/contracts';
import type {
  AnalysisResultDoc,
  AnalysisTradeRecord,
  OptionsAnalysisTaskPayload,
} from '@options-analysis/contracts';
import type { PartnerHistoricalOptionsContractV2Response } from '@options-contract/contracts';
import { EXIT_REGISTRY_VERSION, EXIT_STRATEGIES } from '@options-analysis/registry';
import { aggregateExitType } from './aggregate';
import { buildPositionRecords, type LegFetchResult } from './records';

const MAX_ATTEMPTS = 3;
const FETCH_CONCURRENCY = 10;

// ==========================
// Deps seam
// ==========================

export interface AnalysisWorkerDeps {
  /** v1 or v2 list doc — v1 docs narrow to 1-leg position rows via
   *  `v1ListDocToV2` so the analyzer has one row shape. */
  getListDoc: (docId: string) => Promise<OptionsContractListDocV1 | OptionsContractListDoc | undefined>;
  /** One contract's daily series — the worker passes pickDate→expiration
   *  bounds PER OPTION LEG; the evaluator also clips the tail internally. */
  fetchSeries: (input: {
    symbol: string;
    contractID: string;
    startDate?: string;
    endDate?: string;
  }) => Promise<PartnerHistoricalOptionsContractV2Response>;
  /** Underlying close by date for the symbol (one fetch per task). */
  loadUnderlyingClose: (symbol: string) => Promise<ReadonlyMap<string, number>>;
  /** Analysis run date (YYYY-MM-DD, PT) — drives the open/error split for
   *  series that end before a still-future expiry. Injectable for tests;
   *  production defaults to getMarketDatePT. */
  getToday?: () => string;
  /** Full-document writes (no merge) — the docs are fully owned here;
   *  production writes them in one batch commit. */
  writeResultDocs: (entries: { docId: string; doc: AnalysisResultDoc }[]) => Promise<void>;
}

// ==========================
// Core (deps-seamed)
// ==========================

export { toScanBars } from './records';

export async function runReplayAnalysis(
  payload: OptionsAnalysisTaskPayload,
  deps: AnalysisWorkerDeps,
  isFinalAttempt: boolean,
): Promise<void> {
  const { contractListDocId, runId, symbol, templateId } = payload;
  const startTime = Date.now();
  if (payload.registryVersion !== EXIT_REGISTRY_VERSION) {
    logger.warn('options_analysis_registry_version_mismatch', {
      contractListDocId,
      payloadVersion: payload.registryVersion,
      codeVersion: EXIT_REGISTRY_VERSION,
    });
  }

  // Status re-check — see header. A reset-in-progress is retryable; on
  // the final attempt we stand down without writes so good result docs
  // are never clobbered by zero-count failures.
  const [doc, underlyingClose] = await Promise.all([
    deps.getListDoc(contractListDocId),
    deps.loadUnderlyingClose(symbol).catch((e) => {
      logger.warn('options_analysis_underlying_fetch_failed', {
        contractListDocId,
        symbol,
        error: String(e),
      });
      return new Map<string, number>() as ReadonlyMap<string, number>;
    }),
  ]);
  if (doc?.status !== 'success' || !Array.isArray(doc.rows)) {
    const reason = !doc
      ? 'list doc missing'
      : doc.status !== 'success'
        ? `list doc status '${doc.status}'`
        : 'list doc rows missing';
    if (isFinalAttempt) {
      logger.warn('options_analysis_reset_in_progress_final', {
        contractListDocId,
        reason,
      });
      return;
    }
    throw new Error(`Analysis task raced a list reset — ${reason} (retryable)`);
  }
  // The production loader swallows failures into empty bars — an empty map
  // means every would-be-'expired' record degrades to 'error'; log it.
  if (underlyingClose.size === 0) {
    logger.warn('options_analysis_underlying_empty', { contractListDocId, symbol });
  }

  try {
    // v1→v2 narrowing boundary (#1500) — every list doc reads as v2
    // position rows: legacy `pick` rows become 1-leg positions, which
    // reproduce the v1 records verbatim under the sign math.
    const v2doc = doc.schemaVersion === 2 ? doc : v1ListDocToV2(doc);
    const positions = v2doc.rows.filter(
      (r): r is ContractListPositionRow => r.kind === 'position',
    );
    const base = { runId, symbol, templateId, contractListDocId };
    const today = deps.getToday?.() ?? getMarketDatePT();

    // One fetch per UNIQUE option contract — `repeatsPrevious` rows
    // hold the same contract day after day, so fetch its widest needed
    // window (earliest holding position's entry → contract expiry) once
    // and let each row slice its own [entry, expiry] out of the shared
    // series via toScanBars. Stock legs resolve off the underlying-close
    // map. A per-contract failure degrades every position holding it to
    // 'error' records, never aborts the analysis.
    interface ContractJob {
      contractId: string;
      startDate: string;
      endDate: string;
    }
    const jobByContract = new Map<string, ContractJob>();
    positions.forEach((row) =>
      row.legs.forEach((leg) => {
        if (leg.kind !== 'option') return;
        const ex = jobByContract.get(leg.contractId);
        if (ex) {
          if (row.entryDate < ex.startDate) ex.startDate = row.entryDate;
        } else {
          jobByContract.set(leg.contractId, {
            contractId: leg.contractId,
            startDate: row.entryDate,
            endDate: leg.expiration,
          });
        }
      }),
    );
    const byContract = new Map<string, Exclude<LegFetchResult, undefined>>();
    await forEachWithConcurrency(
      [...jobByContract.values()],
      FETCH_CONCURRENCY,
      async (job) => {
        try {
          byContract.set(job.contractId, {
            resp: await deps.fetchSeries({
              symbol,
              contractID: job.contractId,
              startDate: job.startDate,
              endDate: job.endDate,
            }),
          });
        } catch (e) {
          byContract.set(job.contractId, { error: String(e) });
        }
      },
    );
    const legFetched = positions.map((row) =>
      row.legs.map((leg) =>
        leg.kind === 'option' ? byContract.get(leg.contractId) : undefined,
      ),
    );

    // Record buckets — every position contributes exactly one record
    // per exitId, in registry order.
    const recordsByExit = EXIT_STRATEGIES.map(() => [] as AnalysisTradeRecord[]);
    for (let i = 0; i < positions.length; i++) {
      buildPositionRecords(positions[i], legFetched[i], {
        underlyingClose,
        base,
        today,
      }).forEach((rec, j) => recordsByExit[j].push(rec));
    }

    // Aggregate + write — one batch commit; full-document sets make
    // reruns idempotent and clear any prior error field.
    const generatedAt = new Date().toISOString();
    await deps.writeResultDocs(
      EXIT_STRATEGIES.map((rule, i) => ({
        docId: stOptionsAnalysisResultDocId(contractListDocId, rule.exitId),
        doc: {
          contractListDocId,
          runId,
          symbol,
          templateId,
          exitId: rule.exitId,
          registryVersion: EXIT_REGISTRY_VERSION,
          status: 'success',
          trades: recordsByExit[i],
          aggregate: aggregateExitType(rule.exitId, positions.length, recordsByExit[i]),
          generatedAt,
        } as AnalysisResultDoc,
      })),
    );
    logger.info('options_analysis_complete', {
      contractListDocId,
      runId,
      symbol,
      templateId,
      positions: positions.length,
      exitTypes: EXIT_STRATEGIES.length,
      durationMs: Date.now() - startTime,
    });
  } catch (e) {
    // Any failure mid-run is retryable; on the final attempt mark every
    // exit doc 'failed' (IMPL-BE §3.6) so the run isn't silently
    // result-less — never for a reset-in-progress (handled above).
    if (!isFinalAttempt) throw e;
    logger.error('options_analysis_failed_final', {
      contractListDocId,
      error: String(e),
    });
    try {
      await writeFailedResultDocs(
        deps,
        { contractListDocId, runId, symbol, templateId },
        String(e),
      );
    } catch (writeErr) {
      logger.error('options_analysis_failed_doc_write_failed', {
        contractListDocId,
        error: String(writeErr),
      });
    }
  }
}

/** One failed result doc per registered exit strategy — written on the
 *  final attempt of a retried failure, so the run is never silently
 *  result-less. */
async function writeFailedResultDocs(
  deps: AnalysisWorkerDeps,
  base: { contractListDocId: string; runId: string; symbol: string; templateId: string },
  error: string,
): Promise<void> {
  await deps.writeResultDocs(
    EXIT_STRATEGIES.map((rule) => ({
      docId: stOptionsAnalysisResultDocId(base.contractListDocId, rule.exitId),
      doc: {
        ...base,
        exitId: rule.exitId,
        registryVersion: EXIT_REGISTRY_VERSION,
        status: 'failed',
        trades: [],
        aggregate: aggregateExitType(rule.exitId, 0, []),
        generatedAt: new Date().toISOString(),
        error,
      } as AnalysisResultDoc,
    })),
  );
}

// ==========================
// Production wiring + task function
// ==========================

export const prodAnalysisDeps: AnalysisWorkerDeps = {
  async getListDoc(docId) {
    const snap = await db.collection(ST_OPTIONS_CONTRACT_LISTS_ROOT).doc(docId).get();
    return snap.exists ? (snap.data() as OptionsContractListDocV1) : undefined;
  },
  fetchSeries: (input) => callPartnerHistoricalOptionsContractV2(input),
  async loadUnderlyingClose(symbol) {
    const { dailyBars } = await getCachedBarsFromSymbolData(symbol, getMarketDatePT());
    return new Map(dailyBars.map((b) => [b.d, b.c]));
  },
  async writeResultDocs(entries) {
    const batch = db.batch();
    for (const { docId, doc } of entries) {
      batch.set(db.collection(ST_OPTIONS_ANALYSIS_RESULTS_ROOT).doc(docId), doc);
    }
    await batch.commit();
  },
};

/** Queue `optionsReplayAnalysis` — enqueued by optionsAnalysisStart (#1370). */
export const optionsReplayAnalysis = onTaskDispatched<OptionsAnalysisTaskPayload>(
  {
    retryConfig: {
      maxAttempts: MAX_ATTEMPTS,
      minBackoffSeconds: 10,
      maxBackoffSeconds: 120,
    },
    rateLimits: {
      maxConcurrentDispatches: 10,
      maxDispatchesPerSecond: 5,
    },
    memory: '512MiB',
    // 540s: unique-contract dedup keeps SA fetches ≈ position rows, but
    // multi-leg docs still fan out — headroom past the sibling replay
    // worker's 300s.
    timeoutSeconds: 540,
  },
  async (req) => {
    const retryCount = (req as { retryCount?: number }).retryCount ?? 0;
    await runReplayAnalysis(req.data, prodAnalysisDeps, retryCount >= MAX_ATTEMPTS - 1);
  },
);
