# Q1 2026 Journal

## Current Implementation Efforts (Q1)

- RS-BE-FEAT-PDR-2601-01 – Partner data ingestion & initial prod RS archive backfill
  - Status: in-progress
  - Last change: 2026-01-22
  - Notes: backend ingestion pipeline believed implemented; awaiting SA full-history prod backfill and first `partner-data-ready` message to run initial RS archive backfill.


- RS-BE-FEAT-FRBARR-2601-02 – Full RS backfill and realtime refresh job pipeline
  - Status: in-progress
  - Last change: 2026-01-26
  - Notes: RS job/run schemas and Cloud Tasks worker are implemented under `rs/time-series`, `recomputeRsBackfillAdmin` is live as the RS-native backfill admin entrypoint over the pair registry, and a scheduled cleanup function (`cleanupRsBackfillRuns`) has been added to prune old `rs-backfill-runs` metadata. A full-universe backfill (2019-01-01 → today, DAILY/WEEKLY/MONTHLY, POST phase) has been kicked off in prod and is expected to complete successfully once the queue drains.

- RS-BE-MAINT-CFSTR-2601-01 – Cloud Functions structure and refactor
  - Status: planned
  - Last change: 2026-01-25
  - Notes: new maintenance effort defined to document the current `functions/src` layout, propose a target structure (rs/partner/jobs/admin), and map existing `webhooks` files to their future locations.

- RS-FE-FEAT-HMUI-2602 – Dashboard v3 Heatmap UI: Sort, Filter, and Render Treatments
  - Status: planned
  - Last change: 2026-02-15
  - Notes: frontend effort to build a new `dashboard-v3` heatmap UI capable of handling full prod universes with baseline chips, symmetric top/middle/bottom RS filters, time-range controls, and virtual scrolling. Implementation plan captured in `docs/implementations/RS-FE-FEAT-HMUI-2602_dashboardv3-heatmap-ui-sort-filter-render-treatments.md`. v2 remains operational while v3 is developed.

## Entries

### 2026-01-22

- RS-BE-FEAT-PDR-2601-01
  - Created initial implementation effort doc and linked it from RS_ARCHIVE_BACKFILL.md (code `PDR`).

### 2026-02-15

- RS-FE-FEAT-HMUI-2602
  - Created v3 heatmap UI implementation doc `RS-FE-FEAT-HMUI-2602_dashboardv3-heatmap-ui-sort-filter-render-treatments.md` describing baseline chips, symmetric RS percentile slices, time-range chips, virtual scroll, and routing/nav strategy. Work will be implemented as `dashboard-v3` based on v2, with v2 left unchanged during the transition.
  - Captured current status: bulk pair registry import implemented and documented; waiting on SavantAPI for full-history prod backfill and first prod `partner-data-ready` message to trigger initial RS archive backfill.
  - Defined go-live criteria for RS prod readiness (initial prod backfill run + ongoing realtime maintenance).

### 2026-01-25

- RS-BE-FEAT-FRBARR-2601-02
  - Added a new planning effort under `RS_ARCHIVE_BACKFILL.md` (code `FRBARR`) for full RS archive backfill and realtime refresh using a job/queue pipeline.
  - Created an implementation doc (`RS-BE-FEAT-FRBARR-2601-02_full-rs-backfill-and-realtime-refresh.md`) outlining tasks for RS job/run schemas, shared job creation/enqueue helper, Cloud Tasks worker, and refactoring `recomputeRegisteredBackfill` into a run/job enqueuer.
  - Reviewed Savant's `sa-time-series-job-pipeline-deep-dive.md` and aligned RS design to reuse a shared worker pattern for both realtime refresh and full backfill.
  - **Status**: in-progress (planning and implementation scaffolding completed; ready to begin T01 job/run schema work).

- RS-BE-MAINT-CFSTR-2601-01
  - Defined a new maintenance effort in `3_BACKEND.md` (code `CFSTR`) for Cloud Functions directory structure and refactor.
  - Created an implementation doc (`RS-BE-MAINT-CFSTR-2601-01_cloud-functions-structure-and-refactor.md`) detailing the current `functions/src` layout, a proposed target structure (`partner/`, `rs/ingestion`, `rs/backfill`, `rs/core`, `rs/jobs`, `admin/`, `logging/`, `config/`, `shared/`), and a file-by-file mapping for `functions/src/webhooks/*` into the new structure.
  - Clarified that this effort is design/documentation-only; actual file moves will be done in future MAINT efforts.
  - **Status**: planned (structure and mapping documented; no code moves performed yet).

### 2026-01-26

- RS-BE-FEAT-FRBARR-2601-02
  - Implemented RS job/run Firestore models (`rs-time-series-jobs.model.ts`) for backfill runs and jobs, plus realtime job roots, mirroring SA's `backfill-runs` and `time-series-jobs` layout.
  - Added a shared RS job helper (`rs-time-series-jobs.helper.ts`) that creates/merges `PENDING` job docs for backfill and realtime and enqueues Cloud Tasks using `getFunctions().taskQueue('processRsJobTask')`, gated by `RS_TIME_SERIES_TASKS_ENABLED`.
  - Added an RS Cloud Tasks worker (`rs-time-series-jobs.worker.ts`) with `processRsJobTask` (`onTaskDispatched<ProcessRsJobPayload>`) and `processRsJobInternal` that updates job lifecycle fields and aggregates backfill run progress via `updateBackfillRunForJobTerminal`.
  - Wired `recomputeRsBackfillAdmin` as the RS-native backfill admin HTTP entrypoint under `rs/time-series`, defaulting to the full `pair-registry` universe when `pairs` is omitted and enqueuing `{pair, interval, phase}` jobs to `processRsJobTask` under a single `rs-backfill-runs` doc per invocation.
  - Kicked off a full-universe prod RS archive backfill (2019-01-01 → today, DAILY/WEEKLY/MONTHLY, POST phase) using `recomputeRsBackfillAdmin`; jobs are flowing through Cloud Tasks and the run is expected to reach `COMPLETE` once the queue drains.
  - Added a scheduled cleanup function (`cleanupRsBackfillRuns`) to delete old `rs-backfill-runs` docs and their `jobs` subcollections after `RS_BACKFILL_MAX_AGE_DAYS`, keeping backfill metadata bounded while leaving archives intact.
  - Updated planning docs to mark `recomputeRegisteredBackfill` as a legacy backfill endpoint and document `recomputeRsBackfillAdmin` as the primary RS archive backfill surface.

### 2026-01-28

- RS-BE-FEAT-PDR-2601-01 / RS-BE-FEAT-FRBARR-2601-02
  - Finalized the live `partner-data-ready` v1 contract for RS: Savant publishes to `projects/rel-str/topics/partner-data-ready` with an opaque `runId` (used as the Firestore doc id under `partner-events/{runId}`), `phase=post`, and `intervals` including `DAILY`, `WEEKLY`, `MONTHLY`; core fields are mirrored in both Pub/Sub attributes and JSON body.
  - Enriched `partner-events/{runId}` docs for realtime runs so they now mirror `system/rs-backfill-runs/{runId}`: fields include `runId`, `phase`, `pairCount`, `intervals`, `expectedJobs`, `successJobs`, `permanentFailureJobs`, `status` (lowercase) plus a backfill-style `runStatus` (`COMPLETE`/`PARTIAL`/`FAILED`), `runCompletedAt`, `updatedAt`, and `errorSamples`.
  - Updated skip semantics so that RS only skips explicit test runs with `trigger="test"`; `runId` contents (including `MANUAL`) are no longer used to decide whether a run is processed.
  - Tightened WEEKLY/MONTHLY archive semantics in `writeUnifiedSeries`: weekly and monthly series are collapsed to one bar per logical week/month and stale in-progress bars for the same period are deleted, ensuring that each `archive-weekly-YYYY` and `archive-monthly-YYYY` shard holds exactly one bar per period (the latest/in-progress bar).

## End-of-Month Summary

### Completed Efforts / Tasks

- RS-BE-FEAT-FRBARR-2601-02 (staging)
  - Full RS archive backfill and realtime refresh over pair-registry using a Cloud Tasks + Firestore job pipeline, sharing helpers across realtime and backfill paths. Core job model, worker, RS-native backfill entrypoint (`recomputeRsBackfillAdmin`), and scheduled cleanup (`cleanupRsBackfillRuns`) are implemented; tests and realtime job creation remain.

### Ongoing

- RS-BE-FEAT-PDR-2601-01
  - Pending: first prod `partner-data-ready` message and initial RS archive backfill run; realtime verification.

### Deprecated / Changed Direction

- Deprecated `recomputeRegisteredBackfill` as the primary RS archive backfill entrypoint in favor of `recomputeRsBackfillAdmin` (FRBARR T05). The legacy endpoint remains available for compatibility and emulator/local flows only.

## Upcoming / New Efforts

-## Upcoming / New Efforts

