# RS-BE-FEAT-FRBARR-2601-02 Full RS Backfill and Realtime Refresh (Job Pipeline)

- **Status**: planned
- **Planning doc(s)**:
  - RS_ARCHIVE_BACKFILL.md (code `FRBARR`)
  - sa-time-series-job-pipeline-deep-dive.md (reference, SA internals)
  - rs-partner-integration.md (RS-facing partner contracts)
- **Area**: BE
- **Scope**: FEAT
- **Code**: FRBARR
- **Created**: 2026-01-25
- **Last updated**: 2026-01-25

## Intent

Introduce a queue-based job pipeline for Relative Strength (RS) archives that mirrors Savant's time-series job model while remaining RS-specific:

- Replace the current "do all pair work in one HTTP loop" behavior of `recomputeRegisteredBackfill` with a **Cloud Tasks + Firestore run/job model** over the RS pair registry.
- Support both **full-history backfill** and **realtime compact refresh** using the same core worker and job schema, differentiated by `jobType` and `mode` (similar to SA's `REALTIME` vs `BACKFILL`, `COMPACT` vs `FULL_BACKFILL`).
- Keep RS's external contract unchanged (continue to consume Savant `partner-data-ready` and `partnerTimeSeries` HTTPS), but make RS's own RS-archive backfill and repair pipeline more robust, observable, and scalable.
- Reuse existing helpers (`fetchDailyBarsRange`, `buildPhaseSeries`, RS engine, `writeUnifiedSeries`) inside a new pair-level job worker instead of duplicating logic per endpoint.

This effort is specifically for **archive-focused RS backfill and refresh**; signals/activity/positions behavior is documented separately.

## Tasks

- [ ] RS-BE-FEAT-FRBARR-2601-02-T01 – Design RS job and run schemas for pair-level work
  - Define Firestore layouts for:
    - `system/rs-backfill-runs/{runId}` and `system/rs-backfill-runs/{runId}/jobs/{pair-interval-phase}`.
    - `system/rs-time-series-jobs/{marketDate}` and `system/rs-time-series-jobs/{marketDate}/jobs/{pair-interval-phase}` (realtime path).
  - Mirror SA's `TimeSeriesJobStatus`, `TimeSeriesJobType`, and `TimeSeriesJobMode` concepts with RS-specific enums.

- [ ] RS-BE-FEAT-FRBARR-2601-02-T02 – Implement shared RS job creation + enqueue helper
  - Create a helper similar to `createOrUpdateTimeSeriesJobAndMaybeEnqueueTask` that:
    - Creates/updates job docs transactionally for both realtime and backfill.
    - Updates aggregate run/date docs (expectedJobs/totalJobs, etc.).
    - Enqueues Cloud Tasks with a unified payload shape (`ProcessRsJobPayload`).

- [ ] RS-BE-FEAT-FRBARR-2601-02-T03 – Implement RS Cloud Tasks worker and core job handler
  - Add a `processRsJobTask` Cloud Tasks function with rate limits and retry config.
  - Implement `processRsJobInternal` that:
    - Resolves the correct job doc path from `jobType` (realtime vs backfill).
    - Bumps attempts and sets `IN_PROGRESS`.
    - Invokes a shared `runRsPairIntervalJob` helper to do the actual RS work.
    - Updates job status (SUCCESS / TRANSIENT_FAILURE / PERMANENT_FAILURE).
    - Calls small aggregators for realtime and backfill run progress.

- [ ] RS-BE-FEAT-FRBARR-2601-02-T04 – Extract shared pair-level RS job helper (`runRsPairIntervalJob`)
  - Lift the pair/interval RS fetch + compute + write flow out of `recomputeRegisteredBackfill` / `partner-webhooks` into a reusable helper that:
    - Calls `fetchDailyBarsRange` for baseline and target with the correct `[from, to]` window and interval-specific padding.
    - Builds RS series using `buildPhaseSeries` + RS engine where appropriate.
    - Writes archives via `writeUnifiedSeries` and updates latest mirrors.
    - Returns a normalized result object used by job status and aggregators.

- [ ] RS-BE-FEAT-FRBARR-2601-02-T05 – Refactor `recomputeRegisteredBackfill` into a run/job enqueuer
  - Change `recomputeRegisteredBackfill` to:
    - Normalize `from`, `to`, `phase`, `intervals`, `limit`, `dryRun`.
    - Enumerate the pair registry and apply `limit`.
    - Create a backfill run doc (`rs-backfill-runs/{runId}`).
    - Use the shared helper to create/enqueue one job per `{pair, interval, phase}`.
    - Return a 202-style JSON summary with `runId`, counts, and parameters (no long-running work in the HTTP handler).

- [ ] RS-BE-FEAT-FRBARR-2601-02-T06 – Add realtime refresh job creation path
  - Design and (optionally in a later slice) implement a scheduler- or `partner-data-ready`-driven path that:
    - Produces RS pair jobs under `rs-time-series-jobs/{marketDate}` for compact windows.
    - Uses the same job schema, worker, and helper, with `jobType=REALTIME` and `mode=COMPACT`.

- [ ] RS-BE-FEAT-FRBARR-2601-02-T07 – Tests, validation, and observability
  - Add unit tests for job helpers, worker, and `recomputeRegisteredBackfill` refactor.
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

## Implementation References

- **Key code** (planned targets):
  - `functions/src/webhooks/admin-tasks.ts` – `recomputeRegisteredBackfill` refactor into run/job enqueuer.
  - `functions/src/` (new files, TBD) – RS job model, job creation helper, Cloud Tasks worker, and `runRsPairIntervalJob` helper.
  - `functions/src/webhooks/symbol-fetch.ts` – existing `fetchDailyBarsRange` helper reused inside jobs.
  - `functions/src/webhooks/rs-series.ts`, `functions/src/webhooks/rs-canonical-engine.ts`, `functions/src/webhooks/pairs-writer.ts` – RS series computation and archive writers reused by the worker.

- **Tests / validation** (planned):
  - `tests/functions/` – new Jest suites covering job creation/enqueue, worker behavior, and `recomputeRegisteredBackfill` integration.
  - Emulator + staged prod runs for a limited set of pairs and windows to validate end-to-end behavior.

- **Primary commits** (to be filled as work progresses):
  - `<hash> – RS-BE-FEAT-FRBARR-2601-02: scaffold RS job pipeline implementation doc`
  - Additional commits will be listed here with short descriptions as the effort proceeds.
