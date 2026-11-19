**Topic:** Scanner Chart View  
**Topic Slug:** scanner-chart-view  
**Thread:** Bar-Count Range Pills  
**Thread Slug:** bar-count-range-pills  
**Issue:** #1619  
**Thread Parent:** #1616  
**Topic Parent:** #1232  
**Domain:** CHART-REVIEW  
**Type:** TEST  
**Status:** Draft  
**Created:** 2026-11-18  
**Last Updated:** 2026-11-18  

# Test Plan — FE: Bar-Count Range Pills

## Scope

Per-chart range selection on the Chart View page: the `ChartRange` union (`'25'|'50'|'100'` in, `'recent'` out), `ChartToolbarStateService.rangesByInterval`/`activeRange`/`setRange`, `signal-detail`'s `rangeBarsFor` + per-chart computeds, and the pill groups in `chart-view-toolbar` (live) and `chart-toolbar` (hidden, parity).

## E2E User Journeys

Covered by specs + manual UAT (no Cypress/Playwright harness in this repo — journeys are verified manually per UAT conventions):

1. **Defaults on load** — open `/trading/chart-view`; daily shows last ~100 bars (≈5 months), weekly ~100 (≈2yr), monthly ~50 (≈4yr); `100` pill lit for daily/weekly, `50` for monthly.
2. **Per-chart independence (triple)** — set daily `25`; click the weekly cell (active marker moves); pill highlight shows weekly's own range; set `5Y`; daily stays 25 bars.
3. **Highlight follows active chart** — click between triple cells; the group's `.active` pill always reflects the clicked chart's selection.
4. **Single-mode targeting** — switch D→W via interval pills; the range pills show weekly's selection; a click writes weekly only.
5. **Symbol traversal** — pick `100`, step through list symbols; the window stays 100 per chart (no reset).
6. **Short history** — chart a symbol with <100 daily bars on `100`; all bars render, no error.
7. **Revisit** — navigate away and back; charts reopen at defaults (page-scoped state).

## Integration Tests

- `signal-detail.component.spec.ts` — per-chart `chartConfig{Daily,Weekly,Monthly}.visibleBars` diverge when ranges differ; template `[selectedRange]` passes the active chart's range into `chart-toolbar`; triple-cell click flips `activeChartInterval` and the pill binding follows.

## Unit Tests

### `chart-toolbar-state.service.spec.ts`

- Default map is `{ daily:'100', weekly:'100', monthly:'50', 'two-day':'100' }`.
- `setRange('50')` writes only `rangesByInterval[activeChartInterval]` — other keys unchanged.
- Single mode: `setInterval(W)` moves `activeChartInterval`; `setRange` then writes the weekly slot.
- Triple mode: `setActiveChart(M)`; `setRange` writes monthly; `activeRange` returns monthly's value.
- `activeRange` tracks map updates reactively.

### `signal-detail.component.spec.ts`

- `rangeBarsFor` returns 25/50/100 for numeric members on every `BarsInterval` (interval-agnostic literal).
- `'6m'|'1y'|'5y'|'all'` mappings unchanged (regression pin); `'recent'` is no longer a valid `ChartRange` (type-level + no switch case).
- `rangeBars{Daily,Weekly,Monthly}` read independent map slots.

### `chart-view-toolbar.component.spec.ts` / `chart-toolbar.component.spec.ts`

- Pill group renders exactly `25 50 100 6M 1Y 5Y All` — `Recent` absent.
- `.active` class sits on the active chart's current range; after `setActiveChart` + different per-chart ranges, the highlighted pill changes.
- Click emits `setRange`/`rangeChange` with the right token.

## Test Seams

- `rangeBarsFor` is a `private static` pure function — tested through the public `chartConfig*` computeds (no export needed; follow existing spec style).
- `ChartToolbarStateService` is an injectable provided on the page — construct directly in spec (existing spec already does).
- `UiStateService.chartLayout` — drive single vs triple by stubbing the layout signal (existing specs do this for the indicator-scope tests).

## Test data / fixtures

- No Firestore, no bars fixtures needed — `visibleBars` math is pure.
- For "active chart" assertions use `BarsInterval.{DAILY,WEEKLY,MONTHLY}` directly; `chartIntervalKey` mapping is already spec-covered elsewhere.

## Existing Test Coverage

- `chart-toolbar-state.service.spec.ts` — covers `selectedRange`/`setRange`; **rewrite**: single shared default → per-chart map + active targeting.
- `signal-detail.component.spec.ts` — `rangeBarsFor` cases incl. `'recent'`; **rewrite**: numeric members + removed `'recent'`.
- `chart-toolbar.component.spec.ts` — `'recent'` pill assertions; **rewrite**: new pill set.
- `chart-view-toolbar.component.spec.ts` — pill assertions; extend for new set + active-follows behavior.

## Edge Cases

- `TWO_DAY` key required for `Record` exhaustiveness — pin its presence in the default-map spec even though the interval is sandbox-only.
- Unknown/out-of-union token can only arise from a cast — the `default` branch still returns `ALL_BARS_MAX`; keep the default arm.
- `visibleBars` larger than data length — tolerated today (`ALL_BARS_MAX` precedent); pin that `rangeBarsFor('daily','100')` returns 100 regardless of data length (chart-side clamping is existing `flex-chart` behavior).
- Hidden `chart-toolbar` receiving `'25'` — parity spec: every union member has a matching pill.

## Verify relay

```bash
npx jest chart-toolbar-state signal-detail chart-view-toolbar chart-toolbar --coverage=false
npx tsc --noEmit
npx jest --coverage=false   # suite sweep — ChartRange is shared
```
