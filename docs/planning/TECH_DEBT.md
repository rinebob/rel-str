# RS Tech Debt

## Ideas

### Must-have

- [ ] **PriceBarService refactor — migrate underlying bars from SA to Firestore `symbol-data`.** `RsBarsService.getDailyBars$` calls the `getPairDailyBars` callable, which round-trips to SA's partner API for daily OHLC bars. The app already has `RhAgentChartService` which reads the same data directly from Firestore `symbol-data/{symbol}/daily` (written by SA during PDR runs). The `@techdebt PRICE-BAR-SERVICE` comment in `rs-bars.service.ts` already documents the intended refactor: (1) create `src/app/core/services/price-bar.service.ts` wrapping Firestore `symbol-data` reads, returning `OHLCDatum[]`; (2) wire rh-agent (spread viewer, signal-detail) to use it; (3) migrate heatmap-chart, then remove the wrapper from `HeatmapChartDataService`; (4) deprecate `RsBarsService` SA-dependent path. Added 2026-08-07 during spread builder dialog refinement (ADR-004) — the spread viewer temporarily keeps `RsBarsService` but should migrate when this is done.
- [ ] **Decompose SpreadViewerStore into domain-scoped stores (#105).** `spread-viewer.store.ts` is 588 lines handling 14 responsibilities (symbol loading, spread CRUD, run pipeline, chart pagination, named lists, parametric form state, etc.). Violates "one file, one responsibility" guideline (target under 300 lines). Proposed split: `spread-viewer-core.store.ts` (symbol/contract/bars), `spread-buffer.store.ts` (spreads CRUD, dirty tracking, named list context), `spread-chart.store.ts` (pagination, display), `spread-run.store.ts` (run submission, job observation), `spread-form.store.ts` (parametric form state). Do **after** ADR-004 refinement tasks (#99-#103) are complete. Added 2026-08-08 during #98 code review.
- [ ] CFSTR follow-on: actual Cloud Functions filesystem migration from `webhooks/*` into the new partner/rs/admin structure (implementation efforts after RS-BE-MAINT-CFSTR-2601-01).
- [ ] Tests: expand Jest unit test coverage for core RS pipelines (PDR/FRBARR) and critical callables; ensure new work ships with tests by default.
- [ ] Fix pre-existing Jest test-suite environment failures. Running `npx jest --no-coverage` currently fails on 38 suites: missing `@angular/core/testing` types for Angular specs, missing `FirebaseFirestore` namespace for functions specs, ESM `jose` parsing errors in functions tests (`SyntaxError: Unexpected token 'export'`), and a component naming mismatch in `heatmap.component.spec.ts` (`RsHeatmapComponent` vs `HeatmapComponent`). Blocks relying on a green full-suite run. Added 2026-08-15 after creating `shared/options-strategy-engine-contracts.spec.ts` for #120.
- [ ] Centralize all Firestore collection/path constants (including `system/rs-backfill-runs/runs` and `system/rs-time-series-jobs/dates`) into a shared enum instead of scattering string constants across RS/time-series and webhooks code.
- [ ] Deprecate and remove legacy `archive.ts` + `getPairRSArchive` callable once all external callers are migrated to canonical RS loaders and FE `RelStrDbV2Service`. The canonical RS engine lives in `functions/src/webhooks/rs-canonical-engine.ts` and is the single source of truth for archive-derived RS samples (`RsSample { day, rsNorm, rsRaw }`), threshold crossings (`detectRsEvents`), and mapping into `RsWriteEvent`/`ActivityEvent` via `rs-events-consumer` / `activity-from-writes`.

### Nice-to-have

- [ ] Emulator workflow polish: scripts and docs for starting/stopping emulators, refreshing exports, and common local-debug paths.

### Exploratory / Parking Lot

- [ ] <Add tech-debt investigations or uncertain items here>

## Implementation order

### Next

- [ ] <Promote concrete tech-debt items from Ideas into this bucket when ready to schedule>

### Then

- [ ] <Second-tier tech-debt work to follow after Next items>

### Later

- [ ] Long-term logging/metrics uplift (structured logging, better correlation IDs, and dashboards for RS backfill/realtime health).

---

## Changelog

- 2026-01-25 – Created TECH_DEBT with Ideas/Implementation order buckets and seeded initial items (CFSTR follow-on, tests, emulator workflow, logging/metrics).
- 2026-01-25 – Added tech-debt item to centralize Firestore collection/path constants, including new RS backfill/time-series system roots.
- 2026-08-07 – Added PriceBarService refactor tech-debt item (migrate `RsBarsService` SA-dependent underlying bars to Firestore `symbol-data`). Identified during spread builder dialog refinement (ADR-004, Topic #77).
- 2026-08-08 – Added SpreadViewerStore decomposition tech-debt item (#105). God object at 588 lines / 14 responsibilities. Identified during #98 thermo-nuclear code review.
