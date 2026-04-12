# RS-BE-FEAT-FRBARR-2601-02 Full RS Backfill and Realtime Refresh (Job Pipeline)

- **Status**: in-progress
- **Planning doc(s)**:
  - RS_ARCHIVE_BACKFILL.md (code `FRBARR`)
  - sa-time-series-job-pipeline-deep-dive.md (reference, SA internals)
  - rs-partner-integration.md (RS-facing partner contracts)
- **Area**: BE
- **Scope**: FEAT
- **Code**: FRBARR
- **Created**: 2026-01-25
- **Last updated**: 2026-01-26

## Intent

Introduce a queue-based job pipeline for Relative Strength (RS) archives that mirrors Savant's time-series job model while remaining RS-specific:

- Replace the current "do all pair work in one HTTP loop" behavior of `recomputeRegisteredBackfill` with a **Cloud Tasks + Firestore run/job model** over the RS pair registry.
- Support both **full-history backfill** and **realtime compact refresh** using the same core worker and job schema, differentiated by `jobType` and `mode` (similar to SA's `REALTIME` vs `BACKFILL`, `COMPACT` vs `FULL_BACKFILL`).
- Keep RS's external contract unchanged (continue to consume Savant `partner-data-ready` and `partnerTimeSeries` HTTPS), but make RS's own RS-archive backfill and repair pipeline more robust, observable, and scalable. Realtime runs now rely on a universe-ready `partner-data-ready` v1 message with an opaque `runId`, `phase=post`, and `intervals` including `DAILY`, `WEEKLY`, `MONTHLY`. The `writeUnifiedSeries` function enforces one bar per week/month by deleting stale in-progress bars. Additionally, the partner-events run summary shape mirrors the `rs-backfill-runs` structure.
- Reuse existing helpers (`fetchDailyBarsRange`, `buildPhaseSeries`, RS engine, `writeUnifiedSeries`) inside a new pair-level job worker instead of duplicating logic per endpoint.

This effort is specifically for **archive-focused RS backfill and refresh**; signals/activity/positions behavior is documented separately.

## Tasks

- [x] RS-BE-FEAT-FRBARR-2601-02-T01 – Design RS job and run schemas for pair-level work
  - Define Firestore layouts for:
    - `system/rs-backfill-runs/{runId}` and `system/rs-backfill-runs/{runId}/jobs/{pair-interval-phase}`.
    - `system/rs-time-series-jobs/{marketDate}` and `system/rs-time-series-jobs/{marketDate}/jobs/{pair-interval-phase}` (realtime path).
  - Mirror SA's `TimeSeriesJobStatus`, `TimeSeriesJobType`, and `TimeSeriesJobMode` concepts with RS-specific enums.

- [x] RS-BE-FEAT-FRBARR-2601-02-T02 – Implement shared RS job creation + enqueue helper
  - Create a helper similar to `createOrUpdateTimeSeriesJobAndMaybeEnqueueTask` that:
    - Creates/updates job docs transactionally for both realtime and backfill.
    - Updates aggregate run/date docs (expectedJobs/totalJobs, etc.).
    - Enqueues Cloud Tasks with a unified payload shape (`ProcessRsJobPayload`).

- [x] RS-BE-FEAT-FRBARR-2601-02-T03 – Implement RS Cloud Tasks worker and core job handler (initial lifecycle wiring; RS compute still TODO)
  - Add a `processRsJobTask` Cloud Tasks function with rate limits and retry config.
  - Implement `processRsJobInternal` that:
    - Resolves the correct job doc path from `jobType` (realtime vs backfill).
    - Bumps attempts and sets `IN_PROGRESS`.
    - Invokes a shared `runRsPairIntervalJob` helper to do the actual RS work.
    - Updates job status (SUCCESS / TRANSIENT_FAILURE / PERMANENT_FAILURE).
    - Calls small aggregators for realtime and backfill run progress.

- [x] RS-BE-FEAT-FRBARR-2601-02-T04 – Extract shared pair-level RS job helper (`runRsPairIntervalJob`)
  - Implement `runRsPairIntervalJob` as the shared pair/interval RS fetch + compute + write helper used by `processRsJobInternal` for backfill (and future realtime) jobs, which:
    - Calls `fetchDailyBarsRange` (and interval-specific variants) for baseline and target with the correct `[from, to]` window and padding.
    - Builds RS series using `buildPhaseSeries` + RS engine where appropriate.
    - Writes archives via `writeUnifiedSeries`, including weekly/monthly purge behavior so that only the latest bar per week/month remains (stale in-progress bars for the same period are deleted), and updates latest mirrors on the pair root doc.
    - Returns control to the worker, which then updates job status and backfill run aggregates.

- [x] RS-BE-FEAT-FRBARR-2601-02-T05 – Introduce RS-native backfill admin entrypoint and deprecate `recomputeRegisteredBackfill`
  - Implement and document a new RS backfill admin HTTP function under `rs/time-series` (`recomputeRsBackfillAdmin`) that:
    - Normalizes `from`, `to`, `phase`, `intervals`, and optional `pair` / `pairs` filters.
    - Enumerates the RS pair registry by default and applies any pair filters when present.
    - Creates a backfill run doc (`system/rs-backfill-runs/runs/{runId}`).
    - Uses the shared helper to create/enqueue one job per `{pair, interval, phase}` via Cloud Tasks.
    - Returns a 202-style JSON summary with `runId`, counts, and parameters (no long-running work in the HTTP handler).
  - Mark the legacy `recomputeRegisteredBackfill` under `webhooks/admin-tasks.ts` as deprecated and avoid further refactors beyond minimal enqueue-only support.

- [x] RS-BE-FEAT-FRBARR-2601-02-T08 – Add scheduled cleanup for RS backfill runs and jobs
  - Add a scheduled v2 function (`cleanupRsBackfillRuns`) that runs periodically and:
    - Scans `system/rs-backfill-runs/runs` for runs older than `RS_BACKFILL_MAX_AGE_DAYS` (default 30 days).
    - Deletes each matching run's `jobs` subcollection in batches.
    - Deletes the run doc itself and logs aggregated counts.

- [ ] RS-BE-FEAT-FRBARR-2601-02-T06 – Add realtime refresh job creation path
  - Design and (optionally in a later slice) implement a scheduler- or `partner-data-ready`-driven path that:
    - Produces RS pair jobs under `rs-time-series-jobs/{marketDate}` for compact windows.
    - Uses the same job schema, worker, and helper, with `jobType=REALTIME` and `mode=COMPACT`.

- [ ] RS-BE-FEAT-FRBARR-2601-02-T07 – Tests, validation, and observability
  - Add unit tests for job helpers, worker, and the `recomputeRsBackfillAdmin` backfill path (including any remaining legacy `recomputeRegisteredBackfill` compatibility surface, if still used).
  - Add or update Jest tests under `tests/functions` to cover error cases and aggregation behavior.
  - Validate behavior in emulator/prod for a small set of pairs and windows.
  - Ensure logging and (where appropriate) `persistWarning` events provide clear visibility into job failures.

## Timeline, Decisions & Deviations

### 2026-01-25

- **Status**:
  - Effort defined in `RS_ARCHIVE_BACKFILL.md` with code `FRBARR` and Effort ID `RS-BE-FEAT-FRBARR-2601-02`.
  - Initial design aligns with Savant's `time-series-jobs` and `backfill-runs` model (Firestore + Cloud Tasks, shared worker) but is scoped to RS pair archives.
- **Decisions**:
  - Use per-pair, per-interval, per-phase jobs (`{pairId}-{interval}-{phase}`) similar to SA's `{symbol-endpoint-phase}` granularity.
  - Use a single Cloud Tasks queue and worker for both realtime and backfill, with behavior controlled by `jobType` and `mode`.
  - Keep `limit` as an HTTP-level control on how many pairs a backfill run includes, not as a worker concern.
- **Deviations from planning**:
  - None yet; this is the initial implementation plan for the FRBARR effort.

### 2026-01-26

- **Status**:
  - T01 (schemas): `rs-time-series-jobs.model.ts` defines `RsJobType`, `RsJobMode`, `RsJobStatus`, `RsBackfillRunStatus`, `RsPairJobDoc`, `RsBackfillRunDoc`, and Firestore path helpers for:
    - Backfill runs: `system/rs-backfill-runs/runs/{runId}` and `.../jobs/{pair-interval-phase}`.
    - Realtime jobs: `system/rs-time-series-jobs/dates/{marketDate}` and `.../jobs/{pair-interval-phase}`.
  - T02 (helper): `rs-time-series-jobs.helper.ts` implements `ProcessRsJobPayload`, `createOrUpdateBackfillJob`, and `createOrUpdateRealtimeJob` which:
    - Create/merge `PENDING` job docs with attempts/error/timestamp fields.
    - Enqueue Cloud Tasks via `getFunctions().taskQueue('processRsJobTask')` through `enqueueRsJobTask`, gated by `RS_TIME_SERIES_TASKS_ENABLED`.
  - T03 (worker): `rs-time-series-jobs.worker.ts` defines `processRsJobTask` using `onTaskDispatched<ProcessRsJobPayload>` and `processRsJobInternal` which:
    - Resolves the job doc path based on `jobType` and payload (`runId` vs `marketDate`).
    - Marks jobs `IN_PROGRESS`, increments `attempts`, and sets `lastAttemptAt`/`updatedAt`.
    - Invokes `runRsPairIntervalJob` (wired to RS compute) to fetch bars, build RS series, and write archives.
    - Sets terminal status (`SUCCESS` or `PERMANENT_FAILURE`) and `lastError`.
    - For backfill jobs, updates the parent run doc via `updateBackfillRunForJobTerminal`, incrementing `successJobs` / `permanentFailureJobs` and marking the run `COMPLETE` when `success + permanentFailure >= expectedJobs`.
  - T05 (RS-native backfill entrypoint): `recomputeRsBackfillAdmin` is live under `rs/time-series/rs-backfill-admin.ts` and:
    - Accepts `from`, `to`, `phase`, `intervals`, and optional `pair` / `pairs` filters.
    - Enumerates the RS pair registry when `pairs` is omitted, enabling full-universe backfills.
    - Creates a single `rs-backfill-runs` doc per invocation and enqueues `{pair, interval, phase}` jobs to `processRsJobTask`.
    - Returns a 202-style JSON summary with `runId`, `expectedJobs`, and `enqueuedJobs`.
  - T08 (scheduled cleanup): `cleanupRsBackfillRuns` is implemented as a scheduled v2 function that periodically deletes old `rs-backfill-runs` docs and their `jobs` subcollections beyond `RS_BACKFILL_MAX_AGE_DAYS`.
  - A full-universe backfill (2019-01-01 → today, DAILY/WEEKLY/MONTHLY, POST phase) has been kicked off in prod via `recomputeRsBackfillAdmin` over the entire pair registry; jobs are flowing through `processRsJobTask` and the run is expected to reach `COMPLETE` once the queue drains.
- **Decisions**:
  - Use Firebase Functions v2 task APIs (`onTaskDispatched`, `getFunctions().taskQueue`) instead of the raw `@google-cloud/tasks` client, mirroring SA's implementation.
  - Introduce `RS_TIME_SERIES_TASKS_ENABLED` env flag to gate enqueue behavior so RS can shadow-create job docs without executing tasks during early rollout.
  - Keep `runRsPairIntervalJob` as the single, pair-level RS compute entrypoint used by both backfill and (future) realtime jobs.
  - Manage long-term storage of backfill metadata via a scheduled cleanup job (`cleanupRsBackfillRuns`) instead of ad-hoc manual deletion.
- **Deviations from planning**:
  - T03 is implemented with `runRsPairIntervalJob` wired to the RS compute path; remaining refinements to RS compute internals and extraction from older admin paths are tracked under T04.

### 2026-03-09

- **Status**:
  - Critical bug fix deployed for realtime run status tracking in `updateRealtimeRunForJobTerminal`.
  - **Issue**: `partner-events` documents stuck in `"processing"` status indefinitely; heatmap snapshots not updating despite successful job completion.
  - **Root cause**: Two missing fields in the final update logic:
    1. `runFinishedAt` not set on `rs-realtime-runs` final update (line 706)
    2. `status` field not set on `partner-events` mirror (line 730)
  - **Impact**: 
    - Dashboards showed runs as perpetually in-progress
    - Heatmap update trigger never fired (depends on `runFinishedAt` being set)
    - Archive data was written correctly to `archive-{year}` collections, but not reflected in heatmap snapshots
  - **Fix**: Added missing fields to `rs-time-series-jobs.worker.ts`:
    - Line 706: `runFinishedAt: FieldValue.serverTimestamp()` in `finalUpdate`
    - Line 730: `status: failure > 0 ? 'completed_with_errors' : 'completed'` in `eventPatch`
  - **Verification**: After deployment, next run (2026-03-10) should properly set terminal status and trigger heatmap updates that backfill missing dates from 2026-03-09.
- **Decisions**:
  - Heatmap rebuild logic uses dynamic date ranges (`to: today`), so missed updates are automatically backfilled on next successful run.
  - Created comprehensive documentation in `RS-BE-FEAT-RTRUN-2603_realtime-run-pipeline-and-status-tracking.md` to prevent similar issues.
- **Related documentation**:
  - See `RS-BE-FEAT-RTRUN-2603_realtime-run-pipeline-and-status-tracking.md` for detailed realtime run flow and status tracking lifecycle.
  - See `partner-data-ready-troubleshooting.md` for operational troubleshooting procedures.

## Implementation References

- **Key code** (planned targets):
  - `functions/src/webhooks/admin-tasks.ts` – legacy `recomputeRegisteredBackfill` compatibility surface; primary RS backfill orchestration now lives under `rs/time-series` via `recomputeRsBackfillAdmin`.
  - `functions/src/rs/time-series/rs-time-series-jobs.model.ts` – RS job/run enums and Firestore paths (FRBARR T01).
  - `functions/src/rs/time-series/rs-time-series-jobs.helper.ts` – Shared job creation/enqueue helper (FRBARR T02).
  - `functions/src/rs/time-series/rs-time-series-jobs.worker.ts` – Cloud Tasks worker entrypoint and `processRsJobInternal` (FRBARR T03).
  - `functions/src/webhooks/symbol-fetch.ts` – existing `fetchDailyBarsRange` helper reused inside jobs.
  - `functions/src/webhooks/rs-series.ts`, `functions/src/webhooks/rs-canonical-engine.ts`, `functions/src/webhooks/pairs-writer.ts` – RS series computation and archive writers reused by the worker.
  - `docs/partner/rs-pdr-to-rs-jobs-sequence.md` – sequence diagrams for PDR → RS realtime jobs → Cloud Tasks → Firestore.

- **Tests / validation** (planned):
  - `tests/functions/` – new Jest suites covering job creation/enqueue, worker behavior, and `recomputeRegisteredBackfill` integration.
  - Emulator + staged prod runs for a limited set of pairs and windows to validate end-to-end behavior.

- **Primary commits** (to be filled as work progresses):
  - `<hash> – RS-BE-FEAT-FRBARR-2601-02: scaffold RS job pipeline implementation doc`
  - Additional commits will be listed here with short descriptions as the effort proceeds.
