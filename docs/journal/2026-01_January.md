# January 2026 Journal

## Current Implementation Efforts

- RS-BE-FEAT-PDR-2601-01 – Partner data ingestion & initial prod RS archive backfill
  - Status: in-progress
  - Last change: 2026-01-22
  - Notes: backend ingestion pipeline believed implemented; awaiting SA full-history prod backfill and first `partner-data-ready` message to run initial RS archive backfill.


- RS-BE-FEAT-FRBARR-2601-02 – Full RS backfill and realtime refresh job pipeline
  - Status: in-progress
  - Last change: 2026-01-25
  - Notes: effort defined in planning (`RS_ARCHIVE_BACKFILL.md`), implementation doc `RS-BE-FEAT-FRBARR-2601-02_full-rs-backfill-and-realtime-refresh.md` scaffolded to mirror Savant's time-series job pipeline using Cloud Tasks + Firestore for RS pair archives, and initial implementation work started.

- RS-BE-MAINT-CFSTR-2601-01 – Cloud Functions structure and refactor
  - Status: planned
  - Last change: 2026-01-25
  - Notes: new maintenance effort defined to document the current `functions/src` layout, propose a target structure (rs/partner/jobs/admin), and map existing `webhooks` files to their future locations.

## Entries

### 2026-01-22

- RS-BE-FEAT-PDR-2601-01
  - Created initial implementation effort doc and linked it from RS_ARCHIVE_BACKFILL.md (code `PDR`).
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

## End-of-Month Summary

### Completed Efforts / Tasks

- (Fill in at end of month.)

### Ongoing

- RS-BE-FEAT-PDR-2601-01
  - Pending: first prod `partner-data-ready` message and initial RS archive backfill run; realtime verification.

### Deprecated / Changed Direction

- (List any efforts/task IDs that were superseded or abandoned this month.)

## Upcoming / New Efforts

- RS-BE-FEAT-FRBARR-2601-02 (planned)
  - Full RS archive backfill and realtime refresh over pair-registry using a Cloud Tasks + Firestore job pipeline, sharing helpers across realtime and backfill paths.
