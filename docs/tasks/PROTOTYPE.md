# RS Heatmap & Chart Prototype Task List

## Planning & Project Setup
- [ ] Create/Update `docs/tasks/TASK.md` with this prototype task list and today’s date

## UI/UX: Symbol Input & Data Fetch
- [x] Scaffold `SymbolInputComponent` (CLI-style files, empty class/template/spec/style)
- [ ] Implement logic/UI/styles for `SymbolInputComponent` (validation, emit, etc)
- [ ] Add UI to trigger data fetch for entered symbols
- [ ] Show loading and error states for API requests

## API Integration & Data Fetching
- [ ] Research and select a third-party API for historical daily security data (e.g., Alpha Vantage, Yahoo Finance, Twelve Data)
- [x] Scaffold `RsDataService` (CLI-style file, empty class/spec)
- [ ] Implement data fetching logic in `RsDataService`
- [x] Scaffold NgRx Signal Store for RS data (CLI-style file, empty class/spec)
- [ ] Implement storage and state logic for fetched data in Signal Store

## RS Calculation Logic
- [ ] Scaffold RS calculation utility/service (CLI-style file, empty class/spec)
- [ ] Implement RS (Relative Strength) calculation logic as a reusable TypeScript function/service
- [ ] Integrate RS calculation into `RsDataService` or a dedicated calculation service

## Heatmap UI
- [ ] Scaffold `HeatmapComponent` (CLI-style files, empty class/template/spec/style)
- [ ] Implement logic/UI/styles for `HeatmapComponent` (display RS values as heatmap table/grid)
- [ ] Color code the heatmap cells based on RS values (use Sass variables and mixins for theming)
- [ ] Add support for light/dark mode in heatmap styling
- [ ] Allow user to click a row/symbol in the heatmap to select a security

## Chart UI
- [ ] Scaffold `ChartComponent` (CLI-style files, empty class/template/spec/style)
- [ ] Implement logic/UI/styles for `ChartComponent` (display chart, color bars/candles, interactions)

## Integration & User Flow
- [ ] Wire up the symbol input, data fetch, RS calculation, heatmap, and chart for a seamless user journey
- [ ] Ensure state is managed cleanly with NgRx Signal Store

## Testing
- [ ] Write Cypress E2E tests for the main user flow: input symbols → fetch data → see heatmap → click row → see chart
- [ ] Write unit test files for all components/services (Jest, CLI-style, even if not runnable)

## Polish & Documentation
- [ ] Clean up example/test files and unused code
- [ ] Add usage instructions and screenshots to `README.md`
- [ ] Update `/docs` with architecture and design notes

## (Optional) Analysis & Correlation
- [ ] Add a simple UI or export option to help analyze correlation between RS values and buy/sell opportunities

---
## Discovered During Work
- 2025-09-04: Deprecate legacy `chart-view` in favor of `sync-chart-view`.
  - [x] Route `/chart` now redirects to `/sync-chart` in `src/app/core/core-routes.ts`.
  - [x] Updated internal navigation to prefer `sync-chart` in `src/app/core/common/constants.ts`.
  - [x] Heatmap navigation now routes to `sync-chart` instead of `chart` in `src/app/features/dashboard/heatmap/heatmap.component.ts`.
  - [x] Added visible deprecation banner and JSDoc `@deprecated` to `chart-view` component.
  - [x] After a grace period, remove `src/app/features/chart-view/` once no references remain. (2025-09-04)
    - Utilities needed by shared components were relocated to `src/app/features/shared/utils/shared.util.ts`.
  - [ ] Ensure E2E and unit tests target `sync-chart-view` (create/update tests as needed).