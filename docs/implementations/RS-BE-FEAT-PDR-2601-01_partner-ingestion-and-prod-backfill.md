# RS-BE-FEAT-PDR-2601-01 Partner data ingestion & initial prod RS archive backfill

- **Status**: in-progress
- **Planning doc(s)**:
  - RS_ARCHIVE_BACKFILL.md (code `PDR`)
  - PROTOTYPE.md (Next Phase Plan: partner data-ready pipeline)
- **Area**: BE
- **Scope**: FEAT
- **Code**: PDR
- **Created**: 2026-01-22
- **Last updated**: 2026-01-22

## Intent

Stand up the backend Partner Data Ready → RS archive ingestion pipeline for prod:

- Populate `pair-registry` via bulk import.
- Connect `partner-data-ready` Pub/Sub messages to RS archive writing/backfill.
- Run the initial full-history RS archive backfill in prod and confirm ongoing realtime maintenance.

## Tasks

- [x] RS-BE-FEAT-PDR-2601-01-T01 – Confirm bulk pair registry import function is implemented, deployed, and documented (see RS_ARCHIVE_BACKFILL.md §8)
- [x] RS-BE-FEAT-PDR-2601-01-T02 – Confirm `partner-data-ready` subscriber is implemented, wired to the correct topic, and exported from `functions/src/index.ts`
- [ ] RS-BE-FEAT-PDR-2601-01-T03 – Verify RS archive write/backfill logic is triggered correctly from the subscriber (emulator + non-prod verification)
- [ ] RS-BE-FEAT-PDR-2601-01-T04 – Run the first full-history RS archive backfill in **prod** on initial `partner-data-ready` (full history from SA)
- [ ] RS-BE-FEAT-PDR-2601-01-T05 – Validate ongoing realtime ingestion + archive maintenance in prod (logging, sample pairs, RS_ARCHIVE_BACKFILL.md §9 checklist)

## Timeline, Decisions & Deviations

### 2026-01-22

- **Status**:
  - Bulk pair registry import (`importPairRegistryFromBulkJsonAdmin`) implemented and documented in RS_ARCHIVE_BACKFILL.md §8.
  - Partner data-ready pipeline and archive backfill logic believed to be deployed and wired in non-prod.
  - Waiting on SavantAPI to:
    - Complete full history prod backfill for our universe.
    - Enable realtime updaters.
    - Emit the first prod `partner-data-ready` message for rel-str.

- **Go-live definition**:
  - Consider RS "truly prod-live" when:
    - The first prod `partner-data-ready` is received and processed (T04).
    - Initial RS archive backfill completes successfully in prod.
    - Subsequent `partner-data-ready` messages keep archives up to date (T05).

(Add future dated entries here as things change.)

### 2026-01-23

- **Status** (code inspection for T01–T03):
  - T01: `importPairRegistryFromBulkJsonAdmin` is implemented in `functions/src/webhooks/registry-actions.ts` and exported via `export * from './webhooks/registry-actions'` in `functions/src/index.ts`. The function matches the bulk import flow described in RS_ARCHIVE_BACKFILL.md §8.
  - T02: `processDataReadyRunV2` is implemented in `functions/src/webhooks/partner-webhooks.ts`, subscribed to `PARTNER_DATA_READY_TOPIC`, and explicitly exported from `functions/src/index.ts`. `PARTNER_DATA_READY_TOPIC` is configured for both emulator and prod, and `USE_SYMBOL_DRIVEN_PIPELINE` is used only to short-circuit the heavy pair loop when symbol-driven is enabled.
  - T03: From code, `processDataReadyRunV2` loads registered pairs via `listRegisteredPairs`, calls `processPairLive` per pair, and `processPairLive` writes RS series into archives via `writeUnifiedSeries` (for DAILY/WEEKLY/MONTHLY) and drives the canonical engine + positions/signals. What is still pending is explicit emulator/non-prod verification runs (triggering a data-ready message, then inspecting `partner-events/*` and `pairs-data/*` for expected archives and state).

- **Next verification steps (for T03)**:
  - In emulator or staging, trigger a `partner-data-ready` message with `runType = "ts-post-all-intervals"` and `phase = "post"` for a test `marketDate`.
  - Confirm `partner-events/*` receives a new doc with `status = completed`/`completed_with_errors` for `processDataReadyRunV2`.
  - Inspect `pairs-data/{PAIR}/archive-YYYY/{YYMMDD}` for a small sample of registered pairs to verify RS archives were written/updated as expected.
  - Optionally, run `recomputeRegisteredBackfill` for the same window and compare archive semantics.

## Implementation References

- **Key backend functions**:
  - `functions/src/webhooks/registry-actions.ts` – bulk pair registry import
  - `functions/src/...` – `partner-data-ready` subscriber and RS archive writer

- **Tests / validation**:
  - Emulator test scripts and curl commands (see PROTOTYPE.md and RS_ARCHIVE_BACKFILL.md)
  - Any Jest/Integration tests touching the ingestion pipeline

- **Primary commits**:
  - (Add commit hashes + brief descriptions as you go)
