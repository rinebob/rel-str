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

## Auth & Lists (Deferred/TBD)
- [ ] Auth flows (email/password, Google) [Deferred]
- [ ] Profile & subscription UI [Deferred]
- [ ] Pair list management via `SelectStockPanel` wired to registry callables

## Testing
- [ ] Jest unit tests: RS calc utilities, registry callables validation, scale/mapping helpers, SVG snapshots
- [ ] Integration: Emulators for Firestore; callable flows for `GetPairRSData` and registry
- [ ] E2E: Cypress main user flow (baseline select → heatmap → rs-chart → thresholds → history)

## Documentation & Polish
- [ ] README updates (setup/run/test, env/secrets, emulator usage)
- [ ] Update `/docs` sections completed (schema RS-only, backend registry, API callables, frontend rs-chart, signal history)

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