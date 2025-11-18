# RS Heatmap & Chart Prototype Task List

## Planning & Project Setup
- [ ] Update this file with today’s date: 2025-09-11

## Backend (Registry-driven RS-only)
- [ ] Create `pairRegistry` and callables: `RegisterPairs`, `UnregisterPairs`
- [ ] Scheduler reads `pairRegistry` and computes RS for registered pairs (pre/post); write combined per-day docs to `pairs/{BASE}_{SYMBOL}/rs/{t}` and update `latest` (+ optional `latest30`)
- [ ] Persist canonical signals for active baselines to `pairs/{PAIR}/signals` and `signalsSummary`
- [ ] Implement `GetHeatmapData`, `GetPairRSData`, `QueryPairsByThreshold`, `GetAppSchedule`, `ValidateTickerSymbol`
- [ ] Implement `GetSectorConstituents` callable returning `{ baseline, members, updatedAt }` (reads optional `sectors/{ETF}` cache or upstream and normalizes)
- [ ] Implement `GetCurrentSignals` callable that returns the full set from the latest completed run (across active baselines); no request filters; FE filters client-side
- [ ] Indexing Plan (no code yet): signals feed (type+t), optional server-side threshold filtering on `pairs.latest.post.rs`
- [ ] Implement `GetBacktestResults` callable (RS + OHLCV + TA series) for interactive FE filtering; MVP TA: EMA(20/50/200), RSI; defaults: Daily, 1y lookback; cap TBD
- [ ] Implement Backtest presets callables: `SaveBacktestPreset`, `ListBacktestPresets`, `DeleteBacktestPreset` (persist in Firestore without Auth initially)
- [x] Implement Partner Data-Ready Webhook (HTTPS, Gen2): `POST /partner/data-ready` with Google OIDC allowlist (`ALLOWED_SERVICE_ACCOUNT_EMAILS`); validate v1 payload and return `202` on enqueue. See [docs/partner/partner-webhooks.md](../partner/partner-webhooks.md)
- [ ] Create Pub/Sub topic `rs-data-ready` and publish from webhook handler with attributes (`runId`, `version`, `phase`, `env`)
- [ ] Implement Pub/Sub subscriber (Gen2) to process runs: compute RS for registry pairs, update `pairs/*` dual-phase branches (`pre` and `post`), generate canonical signals, update `runs/{runId}` status/counts
- [ ] TODO: Retire legacy v1 RS subscriber (`processDataReadyRun`) and ratio-based writer once V2 is validated in prod; v1 export disabled in `functions/src/index.ts` so only V2 runs.
- [ ] Write minimal Firestore log for webhook accepts at `partnerEvents/{runId}` and `runs/{runId}` (status: received/completed)
- [x] 2025-11-10: Implement year-sharded storage for positions/signals with `open` bucket and `{YYYY}-closed` shards (design, writers, readers, indexes, migration). Replaced magic string 'items' with `ITEMS_SUBCOLLECTION`.

## Frontend (RS-only, baseline-aware)
- [ ] Heatmap reads `pairs/{BASELINE}_{SYMBOL}.latest` (+ optional `latest30`); sorting/highlighting; baseline selector
- [ ] Heatmap row actions: `View Chart` (routes to `rs-chart`) and `History` (opens Signal History)
- [ ] Timeframe interval selector (Daily/Weekly/Monthly) updates metrics and sparklines
- [ ] New `RsChartView` at route `rs-chart` with `RsChartRenderService` (Renderer2/SVG)
  - [ ] Fetch RS series from Firestore (`rs` range + `latest` freshness)
  - [ ] Fetch OHLCV via backend callable (SavantAPI backend-only)
  - [ ] RS-based candle coloring; threshold inputs; markers (transient/canonical)
  - [ ] Optional RS separate pane
- [ ] Signal History view/panel for a pair
  - [ ] List last 30 signals ordered by time desc; filters by type/date/source; link to open at `rs-chart` centered on event
  - [ ] Empty states/loading; pagination or infinite scroll if >30
- [ ] Sector baseline dropdown in dashboard header
  - [ ] Switch baseline to selected sector ETF (or SPY) in settings store
  - [ ] Fetch sector constituents via `GetSectorConstituents` and replace current list
  - [ ] Refresh heatmap data; preserve sort/filter and interval selections
- [ ] Sector Strength button in dashboard header
  - [ ] On click, set baseline to `SPY` and populate targets with sector ETF symbols (SPDR list)
  - [ ] Refresh heatmap and preserve current sort/filter and interval selections
- [ ] Signals View
  - [ ] Route `signals` with standalone `SignalsView` component (template + scss)
  - [ ] Load latest-run canonical signals via `GetCurrentSignals`
  - [ ] Table with client-side sorting/filtering (baseline/type/source) and pagination
  - [ ] Row action to open `rs-chart` centered on the signal date
- [ ] Backtest View
  - [ ] Route `backtest` with standalone `BacktestView` (template + scss)
  - [ ] Load RS from Firestore; fetch OHLCV + TA via `GetBacktestResults`
  - [ ] Chart with TA overlays; Filter Builder (scope baseline/target/both) with AND-only rules
  - [ ] Live results table (totals, remaining, filtered; win%); annotate kept vs filtered signals on chart
  - [ ] Presets: save/load rule sets via callables (no Auth yet)
- [ ] rs-chart parity with sync-chart
  - [ ] Bottom mini-chart carousel of current list pairs with click-to-load
  - [ ] Main chart zoom/pan/scroll controls
  - [ ] Keep existing SyncFusion chart view and route for transition; add UI toggle/link
- [ ] Replace FE static data with BE-sourced dynamic data:
  - [ ] Wire heatmap and charts to Firestore `pairs/{PAIR}.post.latest` (after close) and `pairs/{PAIR}.pre.latest` (during market hours) and `post.series` for history
  - [ ] Use callables for OHLCV/TA; remove legacy local data imports
  - [ ] Add loading/fallbacks while initial RS backfill completes

## Development Identity (No Fallbacks)

- DO NOT use identity fallbacks in client code (no random/localStorage/dev-generated UIDs).
- In no-auth workflows, always use a single explicit dev user id: `rinebob`.
  - Reads and writes MUST target `users/rinebob/...` to avoid hidden persistence paths.
  - This eliminates hard-to-debug mismatches where reads/writes go to different user roots.
- When authentication is enabled, remove the dev user and use `auth.currentUser.uid` everywhere.
- Services now ensure a `users/{uid}` document exists with minimal metadata (displayName, dev, timestamps) before list reads/writes to avoid phantom users in the emulator.

## Auth & Lists (Deferred/TBD)
- [ ] Auth flows (email/password, Google) [In Progress - 2025-10-24]
- [ ] Profile & subscription UI [Deferred]
- [ ] Pair list management via `SelectStockPanel` wired to registry callables

## Testing
- [ ] Jest unit tests: RS calc utilities, registry callables validation, scale/mapping helpers, SVG snapshots
- [ ] Integration: Emulators for Firestore; callable flows for `GetPairRSData` and registry
- [ ] E2E: Cypress main user flow (baseline select → heatmap → rs-chart → thresholds → history)

## Documentation & Polish
- [ ] README updates (setup/run/test, env/secrets, emulator usage)
- [x] Update `/docs` sections completed (schema RS-only, backend registry, API callables, frontend rs-chart, signal history)
- [ ] Add link to `docs/partner/savantapi-data-ready-webhook.md` and document webhook/Pub-Sub flow in planning (6_API_COMMUNICATION.md already contains high-level section)
- [x] 2025-11-04: Update planning docs to reflect as-built RsSignalHistory (functions, schema, pairs from pair-registry only; opened.openPrice/closed.closePrice; trades human-readable fields; analytics summary fields; signals-daily naming).
- [ ] 2025-11-10: Archive-first initial-load and route-switching performance plan — see `docs/planning/2025-11-archive-first-initial-load-and-route-switching.md`

---
## Discovered During Work
- 2025-09-04: Deprecate legacy `chart-view` in favor of `sync-chart-view`.
  - [x] Route `/chart` now redirects to `/sync-chart` in `src/app/core/core-routes.ts`.
  - [x] Updated internal navigation to prefer `sync-chart` in `src/app/core/common/constants.ts`.
  - [x] Heatmap navigation now routes to `sync-chart` instead of `chart` in `src/app/core/common/heatmap/heatmap.component.ts`.
  - [x] Added visible deprecation banner and JSDoc `@deprecated` to `chart-view` component.
  - [x] After a grace period, remove `src/app/features/chart-view/` once no references remain. (2025-09-04)
    - Utilities needed by shared components were relocated to `src/app/features/shared/utils/shared.util.ts`.
  - [ ] Ensure E2E and unit tests target `sync-chart-view` (create/update tests as needed).
- 2025-09-04: Refactor legacy imports from `features/common` to `features/shared`.
  - [x] Created `src/app/features/shared/types/rs.interfaces.ts` (copy of `features/common/interfaces-rs.ts`).
  - [x] Created `src/app/features/shared/constants/rs.constants.ts` (copy of `features/common/constants-rs.ts`).
  - [x] Updated imports across app to use `features/shared` paths (components, services, utils, data).
  - [x] Updated `features/utils/rs.ts` to import/re-export types and helpers from `shared/types`.
  - [ ] Manually update remaining large data files to shared imports:
    - `src/app/features/data/QQQ_DATA.ts`: `import { OHLCDatum } from "../shared/types/rs.interfaces";`
    - `src/app/features/data/MSFT_WITH_COLORS.ts`: `import { MockCandleWithRSColor } from "../shared/types/rs.interfaces";`
  - [ ] Verify build passes and run tests after refactor.
- 2025-09-10: Transition planning to live partner data pipeline (Alpha Vantage -> normalized Firestore -> app consumption).
  - [ ] Update planning docs to reflect partner endpoint `partnerTimeSeriesV2` and prod URL.
  - [ ] Document RS calculation in Cloud Functions with separate pre-close and post-close series; seed last ~2 months (post-close only) on symbol add.
  - [ ] Clarify frontend uses Firestore + callable functions only (no direct partner endpoint calls).
- 2025-10-10: Added root npm scripts `emulators:start`/`emulators:stop` and configured Pub/Sub emulator in `firebase.json` (port 8085). Updated stop script to match project ports (hub 4410, auth 9100, functions 5002, firestore 8086, storage 9200, ui 4010, logging 4510).
- 2025-10-10: Emulator wiring + Pub/Sub + OIDC for local SavantAPI calls.
  - [x] Added npm scripts:
    - `emulators:start` builds functions and imports `.firebase/emulator-data`.
    - `emulators:stop` now forces an export before stopping, then attempts Hub REST export and kills ports.
    - `emulators:export` for manual snapshotting.
    - `pubsub:topic` creates `projects/rel-str/topics/partner-data-ready` in Pub/Sub emulator.
    - `pubsub:list:topics` and `pubsub:list:subs` to inspect emulator state.
    - `pubsub:hb` publishes a heartbeat message.
    - `pubsub:run` publishes a `ts_daily_post` message with an auto-generated runId.
  - [x] Functions emulator topic switch: when `FUNCTIONS_EMULATOR==='true'`, subscriber binds to `projects/rel-str/topics/partner-data-ready` (real remains `projects/alpha-vantage-proxy-api/topics/partner-data-ready`).
  - [x] Seed `pair-registry` via `seedPairRegistryManual` HTTP function.
  - [x] Local OIDC to SavantAPI:
    - Create a JSON key for `rel-str-partner-caller-prod@rel-str.iam.gserviceaccount.com` and store under `keys/` (gitignored).
    - Set `GOOGLE_APPLICATION_CREDENTIALS` to `keys/rel-str-partner-caller-prod.json` before `npm run emulators:start`.
    - Ensure Cloud Run Invoker on the Partner Time Series service for this SA.
    - Fixed OIDC client init by removing OAuth scopes in `functions/src/partner-proxy.ts#getPartnerIdTokenClient`.
  - [x] Test flow:
    1. `npm run emulators:start`
    2. `npm run pubsub:topic` (once per fresh emulator session, or rely on import)
    3. Seed pairs: `curl -sS -X POST http://127.0.0.1:5002/rel-str/us-central1/seedPairRegistryManual -H "Content-Type: application/json" -d '{}'`
    4. Publish data-ready: `npm run pubsub:run`
    5. Verify Firestore emulator: `partner-events/*` status, `pairs/*` series/latest
- 2025-10-10: Dual-phase RS persistence model finalized
  - [x] Persist both `pre` (intraday) and `post` (EOD) phases under `pairs/{BASE}_{SYMBOL}` with branches `pre` and `post`
  - [x] Branch shape: `{ latest, series, seriesMeta, seriesUpdatedAt }` with `seriesMeta = { interval: "DAILY", rsWindow: 5, retention: N, source: "intraday"|"adjustedClose" }`
  - [x] FE consumption: use `pre.latest` intra-day; use `post.latest` after close; use `post.series` for historical analyses
- 2025-10-22: V2 Heatmap wiring fix
  - [x] Updated `src/app/features/dashboard-v2/heatmap/heatmap.component.html` to guard on `rsAppStore.selectedStockListV2()` (was `selectedStockList()`), ensuring the v2 heatmap renders from the correct store signal.
- 2025-10-24: Authentication implementation started
  - [x] Added `AuthStore` (`src/app/core/auth/auth.store.ts`) with email/password and Google sign-in, and Firestore bootstrap of `users/{uid}`.
  - [x] Added `authGuard` and protected feature routes in `src/app/core/core-routes.ts`.
  - [x] Wired `LoginComponent` and `SignupComponent` with reactive forms, templates, and styles.
  - [x] Connected Auth emulator in `src/app/app.config.ts` for local dev.
  - [ ] Add header user menu (profile, sign out) and conditional nav items based on auth state.

## Next Phase Plan (High-level)
- [x] Implement Partner Data-Ready Webhook + Pub/Sub subscriber to drive backend RS updates without polling. See [docs/partner/partner-webhooks.md](../partner/partner-webhooks.md)
- [ ] Backfill initial RS series for registered pairs and verify `latest` mirrors.
- [ ] Switch frontend to dynamic reads from Firestore and callable OHLCV/TA; remove static demo data.

### Discovered During Work
- 2025-11-17: Consolidated position management into `functions/src/webhooks/positions-manager.ts` (moved helpers from `partner-webhooks.ts` and removed `hot-archive.ts`). Updated imports across callables/backfill/cleanup. Added `ITEMS_SUBCOLLECTION` constant and replaced magic strings. Updated planning docs `5_DATABASE_SCHEMA.md` and `14_DATA_FLOW_AND_FUNCTIONS.md` accordingly.
- Centralize all webhooks constants/types into `functions/src/webhooks/webhooks-config.ts`.
- Move registry callables and seeding into `functions/src/webhooks/registry-actions.ts`.
- Document full RS pipeline and Firestore schemas in `docs/partner/partner-webhooks.md` and planning docs.
- 2025-11-04: Rename fields and collections in planning to match implementation: `opened.price -> opened.openPrice`, `closed.price -> closed.closePrice`, `signalsDaily -> signals-daily`. Backfill pairs enumerated from `pair-registry` only; admin-protected HTTP.