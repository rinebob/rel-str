# RS-BE-MAINT-CFSTR-2601-01 Cloud Functions Structure and Refactor

- **Status**: planned — partial implementation (common/, symbol-data-sync)
- **Planning doc(s)**:
  - 3_BACKEND.md (code `CFSTR`)
- **Area**: BE
- **Scope**: MAINT
- **Code**: CFSTR
- **Created**: 2026-01-25
- **Last updated**: 2026-07-08

## Intent

The current `functions/src` layout has grown organically around a `webhooks/` directory that mixes:

- Partner-facing integration (Pub/Sub / HTTP entrypoints, partner events).
- RS-domain orchestration (RS engine, series builders, positions, signals activity).
- Admin/backfill HTTP functions.
- Shared helpers that are not really webhooks (e.g., `symbol-fetch`, `pairs-writer`, `rs-series`).

This effort aims to:

- Document the **current filesystem structure** (with emphasis on `webhooks/`).
- Propose a **target directory structure** that:
  - Separates **entrypoints** (HTTP, Pub/Sub, schedulers) from **domain logic** and **job workers**.
  - Cleanly distinguishes **partner** integration from **RS** internals.
  - Provides a first-class home for the RS job pipeline (FRBARR) under `jobs/` / `rs/`.
- Define a **mapping plan** for existing `webhooks` files into the new structure, to guide incremental migrations.
- Ensure **new code going forward** (e.g., FRBARR RS jobs) adopts the new structure immediately, without blocking on migrating legacy files.

## Tasks

- [ ] RS-BE-MAINT-CFSTR-2601-01-T01 – Capture current Cloud Functions filesystem layout
  - Enumerate key directories and files under `functions/src/`, with a short description of responsibility (entrypoint vs domain logic vs shared helpers).
  - Highlight the overload of `webhooks/` as a catch-all for RS + partner + admin logic.

- [ ] RS-BE-MAINT-CFSTR-2601-01-T02 – Design target `functions/src` structure
  - Define top-level domains (e.g., `partner/`, `rs/`, `admin/`, `jobs/`, `shared/` or `utils/`).
  - Specify where entrypoints, domain logic, and job workers will live.
  - Ensure the design aligns with existing planning docs (3_BACKEND, RS_ARCHIVE_BACKFILL, FRBARR) and supports the RS job pipeline pattern.

- [ ] RS-BE-MAINT-CFSTR-2601-01-T03 – Map existing `webhooks` files into the target structure
  - For each file under `functions/src/webhooks/`, document its primary responsibility and proposed destination in the target structure.
  - Identify files that are primarily partner-facing vs RS-domain vs general admin.
  - Call out any files that should be split (e.g., `admin-tasks.ts` mixing multiple concerns).

- [ ] RS-BE-MAINT-CFSTR-2601-01-T04 – Define migration guidelines for new vs existing code
  - Specify that **new** work (e.g., FRBARR RS jobs) should use the new structure immediately (e.g., `functions/src/jobs/*`, `functions/src/rs/*`).
  - Outline how to gradually migrate existing entrypoints and helpers from `webhooks/` to the new layout without large, disruptive PRs.
  - Document any expectations for `index.ts` exports organization as part of the structure.

- [ ] RS-BE-MAINT-CFSTR-2601-01-T05 – Update backend planning docs to reference the new structure
  - Add or adjust references in `3_BACKEND.md` (and, if needed, related planning docs) to show the new structure as the canonical target.
  - Ensure future backend work (including FRBARR) can point to this structure for guidance.

- [ ] RS-BE-MAINT-CFSTR-2601-01-T06 – (Follow-up, separate effort) Plan concrete migration steps
  - This effort focuses on **design and documentation**; actual code moves may be handled as one or more future MAINT efforts.
  - Capture a short list of candidate sub-efforts (e.g., `RS-BE-MAINT-CFSTR-2602-01 – Move RS core from webhooks to rs/core`).

## Current Cloud Functions Filesystem (High-Level)

> Snapshot based on `functions/src` at the time of writing; details may change over time.

### 1. Top-level under `functions/src`

Key areas:

- `admin/` – admin HTTP/callable utilities (cleanup, archive tools, etc.).
- `common/` – cross-cutting primitives shared by multiple feature modules (e.g., PT date utilities, RH Agent types and collection constants, run/job orchestration helpers).
- `config/` – configuration and constants (e.g., `constants.ts`).
- `logging/` – `persistWarning` and related logging helpers.
- `partner-proxy.ts` – Savant API proxy and OIDC helper.
- `symbol-data-sync/` – symbol-level D/W/M bar ingestion and onboarding (nightly sync, `partner-symbol-added` consumer).
- `webhooks/` – **highly overloaded** directory containing:
  - Partner-facing orchestrators and events.
  - RS-domain engine, series, positions, signals-activity writers.
  - Admin/backfill HTTP functions.
  - Misc RS helpers (symbol fetching, calendar, diagnostics).
- `types/` – shared TypeScript contracts for RS and partner types.
- `jobs/` – new RS job model file added for FRBARR (`rs-time-series-jobs.model.ts`).

### 2. `functions/src/webhooks` contents and roles (current)

At a high level, `webhooks/` currently contains:

- **Entry-point / orchestration**:
  - `partner-webhooks.ts` – partner data-ready subscriber/orchestrator.
  - `admin-tasks.ts` – admin HTTP endpoints, including `recomputeRegisteredBackfill` and related maintenance tasks.
  - `registry-actions.ts` – callable/admin endpoints for pair registry management.
  - `diagnostics.ts` – diagnostics/troubleshooting HTTP functions.

- **RS-domain core logic**:
  - `rs-series.ts` – build phase-aware RS series from Savant bars.
  - `rs-canonical-engine.ts` – canonical RS engine used by backfill and realtime.
  - `rs-events-consumer.ts` – applies RS write events to Firestore (signals, positions).
  - `rs-signal-detector.ts`, `rs-signals-engine.ts`, `rs-write-events.ts` – RS signal detection and event types.
  - `pairs-writer.ts` – writes unified RS series (`writeUnifiedSeries`) into archives and latest mirrors.
  - `positions-manager.ts` – updates positions and timelines from RS events and price samples.
  - `signals-activity-writer.ts` – writes Signals Activity mirrors.
  - `activity-from-writes.ts` – derives activity events from RS write events.

- **Helpers / utilities**:
  - `symbol-fetch.ts` – wraps `callPartnerTimeSeries` with logging and normalization.
  - `calendar.ts` – canonical calendar and market holidays helpers.
  - `partner-events.ts` – partner event/run types and helper utilities.
  - `registry.ts` – registry read helpers.
  - `id-utils.ts` – ID construction helpers for event/doc IDs.
  - `webhooks-config.ts` – shared constants and enums used by webhooks/admin functions.

This mix makes it hard to see which files are entrypoints vs core RS logic vs partner or admin utilities.

## Target Directory Structure

The target structure builds on the proposal in `3_BACKEND.md` and recent FRBARR planning:

```text
functions/src/
  partner/                 # External partner integration
    partner-proxy.ts       # Savant time-series + tracked symbols proxy
    types/                 # Partner-facing TS contracts
      partner.ts

  symbol-data-sync/        # Symbol-level D/W/M bar ingestion and onboarding
    symbol-data-sync.ts    # Nightly scheduler/orchestrator
    symbol-data-backfill.ts # Reusable per-symbol D/W/M backfill
    symbol-data-symbol-added.ts # Pub/Sub consumer for partner-symbol-added
    intraday-wm-sync.ts    # Intraday weekly/monthly sync helper

  rs/                      # RS domain (archives, signals, positions, activity)
    time-series/           # RS time-series ingestion, backfill, and jobs for archives
      rs-time-series-jobs.model.ts    # Job/run enums + Firestore paths (created by FRBARR T01)
      rs-time-series-jobs.helper.ts   # Shared job creation/enqueue helper (FRBARR T02)
      rs-time-series-jobs.worker.ts   # Cloud Tasks worker (FRBARR T03)
      rs-time-series-run.ts           # Backfill run orchestration helpers (optional)
      rs-time-series-realtime.ts      # Realtime compact refresh helpers/entrypoints (optional)
    core/                  # Core RS computation engine and write paths
      rs-series.ts
      rs-canonical-engine.ts
      rs-write-events.ts
      rs-events-consumer.ts
      signals-activity-writer.ts
      positions-manager.ts

  common/                  # Cross-cutting primitives shared by multiple feature modules
    pt-date-utils.ts       # PT date/run-ID utilities
    rh-agent-collections.ts # RH Agent Firestore collection constants
    rh-agent-runs.ts       # RH Agent run/job/status types
    rh-agent-shared-types.ts # Intraday snapshot, task payload
    rh-agent-run-creation.ts # Run document creation
    rh-agent-job-enqueueing.ts # Cloud Tasks enqueueing
    rh-agent-symbol-source.ts # Enabled symbol loading + intraday snapshots
    rh-agent-orchestration.ts # High-level startRhAgentRun orchestrator

  admin/                   # Cross-domain admin utilities (cleanup, maintenance)

  jobs/                    # (Transitional) RS jobs until fully moved to rs/jobs

  logging/                 # Logging + persistWarning

  config/                  # Shared configuration + constants

  shared/ | utils/         # Cross-cutting helpers (dates, Firestore utils, concurrency)

  types/                   # Domain contracts (RS, positions, signals, etc.)
```

Notes:

- `symbol-data-sync/` hosts the **symbol-level bar ingestion pipeline** (nightly sync, backfill logic, and the `partner-symbol-added` Pub/Sub consumer). It is a peer to `rs/`, not part of it.
- `common/` hosts **cross-cutting primitives** shared by multiple feature modules (e.g., PT date utilities, RH Agent collection constants, run/job types). It must not depend on feature modules; feature modules import from it.
- `rs/time-series` hosts **time-series specific entrypoints and helpers** (ingestion, backfill, and job orchestration for RS archives).
- `rs/core` hosts RS-domain **pure logic and services**, importable from both ingestion-style entrypoints and jobs.
- `partner/` isolates Savant integration and partner contracts so they can be reasoned about independently.

## Mapping: `webhooks` Directory → Target Structure

This section proposes where each `functions/src/webhooks` file would live in the new structure. No moves are performed as part of this effort; this serves as a map for future MAINT work.

> Source path: `functions/src/webhooks/*`

- **activity-from-writes.ts**
  - Current role: derive Signals Activity events from RS write events.
  - Target: `functions/src/rs/core/activity-from-writes.ts`.

- **admin-tasks.ts**
  - Current role: admin HTTP endpoints (backfill, diagnostics, market holidays, etc.).
  - Target split:
    - RS archive/backfill-specific endpoints (e.g., legacy `recomputeRegisteredBackfill`, RS-native `recomputeRsBackfillAdmin`, `backfillSignalsPipelineAdmin`, `ingestStaticPairsAdmin`) → `functions/src/rs/backfill/admin-tasks.ts` (or separate smaller files per concern).
    - Cross-domain admin utilities (if any) → `functions/src/admin/*`.

- **calendar.ts**
  - Current role: calendar and market holidays helpers (used by RS + admin tasks).
  - Target: `functions/src/rs/core/calendar.ts` (or `shared/` if used more broadly).

- **diagnostics.ts**
  - Current role: HTTP diagnostics for RS archives/ingestion.
  - Target: `functions/src/rs/backfill/diagnostics.ts` (admin-only diagnostics for RS domain).

- **hydrate-new-pair.ts**
  - Current role: hydrate new pair archives from Savant for registration/backfill.
  - Target: `functions/src/rs/backfill/hydrate-new-pair.ts`.

- **id-utils.ts**
  - Current role: helper utilities for building IDs.
  - Target: `functions/src/shared/id-utils.ts` (or `rs/core/id-utils.ts` if RS-specific).

- **pairs-writer.ts**
  - Current role: encapsulates `writeUnifiedSeries` and archive writes.
  - Target: `functions/src/rs/core/pairs-writer.ts`.

- **partner-events.ts**
  - Current role: types and helpers around partner events/runs.
  - Target: `functions/src/partner/partner-events.ts`.

- **partner-webhooks.ts**
  - Current role: partner data-ready subscriber and RS orchestrator (Pub/Sub/HTTP).
  - Target: `functions/src/rs/ingestion/partner-webhooks.ts` (still consuming partner events via `partner/` types).

- **positions-manager.ts**
  - Current role: manage RS positions and root position updates.
  - Target: `functions/src/rs/core/positions-manager.ts`.

- **registry-actions.ts**
  - Current role: callable/admin endpoints and helpers for pair-registry management.
  - Target: `functions/src/rs/backfill/registry-actions.ts` (or `rs/ingestion/registry-actions.ts` depending on usage patterns).

- **registry.ts**
  - Current role: registry read helpers used by ingestion/backfill.
  - Target: `functions/src/rs/core/registry.ts`.

- **rs-canonical-engine.ts**
  - Current role: canonical RS engine used by both backfill and realtime.
  - Target: `functions/src/rs/core/rs-canonical-engine.ts`.

- **rs-events-consumer.ts**
  - Current role: consume RS write events, update signals/positions.
  - Target: `functions/src/rs/core/rs-events-consumer.ts`.

- **rs-series.ts**
  - Current role: build phase-aware RS series from Savant bars.
  - Target: `functions/src/rs/core/rs-series.ts`.

- **rs-signal-detector.ts**, **rs-signals-engine.ts**, **rs-write-events.ts**
  - Current role: RS signal detection and write event modeling.
  - Target: `functions/src/rs/core/` (e.g., `rs-signal-detector.ts`, `rs-signals-engine.ts`, `rs-write-events.ts`).

- **signals-activity-writer.ts**
  - Current role: write Signals Activity mirrors from derived events.
  - Target: `functions/src/rs/core/signals-activity-writer.ts`.

- **symbol-fetch.ts**
  - Current role: wrapper around `callPartnerTimeSeries` for RS symbol fetches.
  - Target: `functions/src/rs/core/symbol-fetch.ts` (RS-flavored wrapper over `partner/partner-proxy.ts`).

- **webhooks-config.ts**
  - Current role: shared constants and enums for webhooks/admin functions.
  - Target: either:
    - `functions/src/rs/config/webhooks-config.ts` (if RS-only), or
    - `functions/src/config/rs-webhooks-config.ts` if used cross-domain.

## Migration Guidelines (New vs Existing Code)

- **New code (going forward)**:
  - Place symbol-level bar ingestion code under `functions/src/symbol-data-sync/*`.
  - Place cross-cutting primitives shared by multiple feature modules under `functions/src/common/*`. `common/` must not import from feature modules.
  - Place RS job-pipeline code (FRBARR) under `functions/src/jobs/*` (transitional) with the intention of moving to `functions/src/rs/jobs/*` in a future MAINT phase.
  - For any new RS-domain helpers, prefer `functions/src/rs/core/*` instead of `webhooks/*`.
  - For new partner integration utilities, use `functions/src/partner/*`.

- **Existing code**:
  - Remains in `functions/src/webhooks/*` for now.
  - Future MAINT efforts (e.g., `RS-BE-MAINT-CFSTR-2602-01`) will move specific files according to the mapping above, updating imports and `index.ts` exports incrementally.

## Timeline, Decisions & Deviations

### 2026-01-25

- **Status**:
  - Initial Cloud Functions structure effort defined in `3_BACKEND.md` as `RS-BE-MAINT-CFSTR-2601-01` (code `CFSTR`).
  - Implementation doc scaffolded with current filesystem overview, target structure, and a detailed mapping for `functions/src/webhooks/*`.
- **Decisions**:
  - Keep this effort focused on **design and documentation** only; actual file moves and import updates will be done in one or more follow-up MAINT efforts.
  - Use `jobs/` (and eventually `rs/jobs/`) as the home for RS job-pipeline code (FRBARR), while `rs/core/` hosts RS engine, series, positions, and signals.
  - Maintain a clean separation between `partner/` integration code and `rs/` domain logic.
- **Deviations from planning**:
  - The original 3_BACKEND directory-structure suggestion was callables/webhooks/admin/utils/services-focused; this effort refines and extends it with explicit `rs/`, `partner/`, and `jobs/` namespaces to support the unified RS ingestion and job pipelines.

## Implementation References

- **Current key code** (for structure/mapping):
  - `functions/src/webhooks/*` – existing RS + partner + admin logic.
  - `functions/src/partner-proxy.ts` – partner time-series/tracked symbols proxy.
  - `functions/src/logging/*` – logging helpers.
  - `functions/src/types/*` – shared contracts.
  - `functions/src/jobs/rs-time-series-jobs.model.ts` – initial RS job model for FRBARR.

- **Planned future locations**:
  - `functions/src/rs/core/*` – RS engine, RS series, writers, positions, signals, activity.
  - `functions/src/rs/ingestion/*` – partner-data-ready driven entrypoints.
  - `functions/src/rs/backfill/*` – admin backfill entrypoints and tools.
  - `functions/src/rs/jobs/*` – RS jobs and workers.
  - `functions/src/partner/*` – Savant integration and partner event contracts.

- **Primary commits** (to be filled as work progresses):
  - `<hash> – RS-BE-MAINT-CFSTR-2601-01: scaffold Cloud Functions structure implementation doc`
