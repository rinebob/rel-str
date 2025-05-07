# RS Heatmap & Chart Prototype Task List

## Planning & Project Setup
- [ ] Create/Update `docs/tasks/TASK.md` with this prototype task list and today’s date
- [ ] Document the prototype’s goals, architecture, and data flow in `docs/planning/PLANNING.md`

## UI/UX: Symbol Input & Data Fetch
- [ ] Create a standalone `SymbolInputComponent` for entering up to five symbols (with validation)
- [ ] Add UI to trigger data fetch for entered symbols
- [ ] Show loading and error states for API requests

## API Integration & Data Fetching
- [ ] Research and select a third-party API for historical daily security data (e.g., Alpha Vantage, Yahoo Finance, Twelve Data)
- [ ] Implement `RsDataService` to fetch historical daily data for up to five symbols
- [ ] Store fetched data in an NgRx Signal Store for state management

## RS Calculation Logic
- [ ] Implement RS (Relative Strength) calculation logic as a reusable TypeScript function/service
- [ ] Write unit tests for RS calculation logic (Jest, if compatible)
- [ ] Integrate RS calculation into `RsDataService` or a dedicated calculation service

## Heatmap UI
- [ ] Create a standalone `HeatmapComponent` to display RS values as a heatmap table/grid
- [ ] Color code the heatmap cells based on RS values (use Sass variables and mixins for theming)
- [ ] Add support for light/dark mode in heatmap styling
- [ ] Allow user to click a row/symbol in the heatmap to select a security

## Chart UI
- [ ] Create a standalone `ChartComponent` to display a chart of the selected security
- [ ] Color the chart’s bars/candles using the heatmap colors for that security’s RS values
- [ ] Add basic chart interactions (zoom, tooltip, etc.)

## Integration & User Flow
- [ ] Wire up the symbol input, data fetch, RS calculation, heatmap, and chart for a seamless user journey
- [ ] Ensure state is managed cleanly with NgRx Signal Store

## Testing
- [ ] Write Cypress E2E tests for the main user flow: input symbols → fetch data → see heatmap → click row → see chart
- [ ] Write unit tests for RS calculation and data-fetching services

## Polish & Documentation
- [ ] Clean up example/test files and unused code
- [ ] Add usage instructions and screenshots to `README.md`
- [ ] Update `/docs` with architecture and design notes

## (Optional) Analysis & Correlation
- [ ] Add a simple UI or export option to help analyze correlation between RS values and buy/sell opportunities