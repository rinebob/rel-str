**Topic:** Scanner Chart View  
**Topic Slug:** scanner-chart-view  
**Thread:** Bar-Count Range Pills  
**Thread Slug:** bar-count-range-pills  
**Issue:** #1619  
**Thread Parent:** #1616  
**Topic Parent:** #1232  
**Domain:** CHART-REVIEW  
**Type:** IMPL  
**Status:** Draft  
**Created:** 2026-11-18  
**Last Updated:** 2026-11-18  

# Implementation Plan — FE: Bar-Count Range Pills

## Architecture overview

One shared change flows through three layers: the `ChartRange` union gains numeric bar-count members and loses `'recent'`; `ChartToolbarStateService` swaps its single `selectedRange` signal for a per-chart map (`rangesByInterval`, same shape as `selectedIdsByInterval`) plus an `activeRange` computed; the consumers — `signal-detail`'s `rangeBars*` computeds and both toolbar pill groups — read per-chart values. `setRange` writes to the *active* chart (`activeChartInterval`, already correct in both layouts: `setInterval` keeps it synced in single mode, cell clicks via `setActiveChart` in triple mode).

## Boundary

**Covers:** the `ChartRange` union and its consumers — `chart-toolbar-state.service`, `signal-detail` (range→bars mapping + toolbar binding), `chart-view-toolbar` (live pill group), `chart-toolbar` (hidden pill group inside `signal-detail`, parity).

**Does NOT cover:** any other `visibleBars` consumer (`swing-analysis-page`, `flex-chart-sandbox`, rs/sync/heatmap chart views — none use `ChartRange`), `contract-list-picker` (`applyChartRange` is a brushed *date* bound, unrelated), persistence across page visits, per-symbol memory, zoom/brush behavior. No backend, no Firestore, no root `shared/` contracts — `flex-chart.types.ts` is app-side.

## Files

```
src/app/features/shared/components/flex-chart/flex-chart.types.ts
  — modified: ChartRange union + doc comment
src/app/features/savant-trader/services/chart-toolbar-state.service.ts
  — modified: selectedRange → rangesByInterval + activeRange + setRange targets active chart
src/app/features/savant-trader/services/chart-toolbar-state.service.spec.ts
  — spec coverage for per-chart map, defaults, active-chart targeting
src/app/features/savant-trader/components/signal-detail/signal-detail.component.ts
  — modified: rangeBarsFor numeric members + 'recent' removal, RECENT_* constants deleted,
    per-chart rangeBars computeds
src/app/features/savant-trader/components/signal-detail/signal-detail.component.html
  — modified: [selectedRange] binding reads active chart's range
src/app/features/savant-trader/components/signal-detail/signal-detail.component.spec.ts
  — spec coverage: literal counts, per-chart independence, 'recent' gone
src/app/features/savant-trader/components/chart-view-toolbar/chart-view-toolbar.component.html
  — modified: pill set 25|50|100|6M|1Y|5Y|All, active via activeRange
src/app/features/savant-trader/components/chart-view-toolbar/chart-view-toolbar.component.spec.ts
  — spec coverage: pill set, active class follows active chart
src/app/features/savant-trader/components/chart-toolbar/chart-toolbar.component.html
  — modified: identical pill set (parity for the hidden toolbar)
src/app/features/savant-trader/components/chart-toolbar/chart-toolbar.component.spec.ts
  — spec coverage: parity pins
```

## Modules

### 1. `flex-chart.types.ts` — `ChartRange` (modified)

```ts
/** Time-range presets offered by chart range pill groups. Numeric members
 *  are literal bar counts ('25'|'50'|'100'); the rest are calendar presets. */
export type ChartRange = '25' | '50' | '100' | '6m' | '1y' | '5y' | 'all';
```

`'recent'` is removed — update every reference (union, service, `rangeBarsFor`, both templates, three spec files; `RECENT_LIST_ID` in `spread-list.service` is unrelated).

### 2. `chart-toolbar-state.service.ts` — per-chart range state (modified)

- Delete `selectedRange` signal; add:

  ```ts
  /** Selected time-range preset PER CHART — keyed by ChartIntervalKey,
   *  same pattern as selectedIdsByInterval. Defaults: '50' on every interval. */
  readonly rangesByInterval = signal<Record<ChartIntervalKey, ChartRange>>({
    [ChartIntervalKey.DAILY]:   '50',
    [ChartIntervalKey.WEEKLY]:  '50',
    [ChartIntervalKey.MONTHLY]: '50',
    [ChartIntervalKey.TWO_DAY]: '50',   // Record exhaustiveness only — sandbox interval
  });

  /** The range the pills display/affect — the active chart's selection.
   *  `activeChartInterval` is already correct in both layouts. */
  readonly activeRange = computed(
    () => this.rangesByInterval()[chartIntervalKey(this.activeChartInterval())],
  );
  ```

- `setRange(range)` → immutable update of `rangesByInterval` at the active key (same `update` + object-spread pattern as `applyIndicatorToggle`).
- Update the class docblock: the "one selection controls `visibleBars` on all charts" line is now false — each chart owns its range.

### 3. `signal-detail.component.ts` — range mapping + computeds (modified)

- `rangeBarsFor`: handle numeric members first — `const n = Number(range); if (!Number.isNaN(n)) return n;` — then the calendar switch (`'6m'|'1y'|'5y'`, default → `ALL_BARS_MAX`). Delete `RECENT_*_BARS` constants and the `'recent'` case. `TRADING_DAYS_PER_YEAR` etc. stay (calendar presets still use them).
- Per-chart computeds read the map:

  ```ts
  private rangeFor(key: ChartIntervalKey) { return this.toolbarState.rangesByInterval()[key]; }
  rangeBars        = computed(() => rangeBarsFor(this.selectedInterval(), this.rangeFor(chartIntervalKey(this.selectedInterval()))));
  rangeBarsDaily   = ... DAILY key ...   // same for Weekly/Monthly
  ```

- `readonly selectedRange = this.toolbarState.selectedRange` → `readonly activeRange = this.toolbarState.activeRange` (template binds `[selectedRange]="activeRange()"` into `chart-toolbar` — input/output contract unchanged).

### 4. Toolbar templates — pill groups (modified)

Both `chart-view-toolbar.component.html` (~L70–75) and `chart-toolbar.component.html` (~L45–51) render, in order:

```html
<button class="pill" [class.active]="... === '25'"  (click)="setRange('25')">25</button>
<button class="pill" [class.active]="... === '50'"  (click)="setRange('50')">50</button>
<button class="pill" [class.active]="... === '100'" (click)="setRange('100')">100</button>
<button class="pill" ... '6m'>6M</button>
<button class="pill" ... '1y'>1Y</button>
<button class="pill" ... '5y'>5Y</button>
<button class="pill" ... 'all'>All</button>
```

- `chart-view-toolbar`: `[class.active]="toolbarState.activeRange() === '25'"`, clicks `toolbarState.setRange(...)`. Remove the `Recent` button.
- `chart-toolbar` (hidden): `[class.active]="selectedRange() === '25'"`, clicks `rangeChange.emit('25')`. Same set for parity.

## Contracts

None — self-contained FE state; `chart-toolbar`'s `selectedRange: ChartRange` input + `rangeChange` output are unchanged in shape (wider union flows through).

## Decisions

- **Bare numeric tokens `'25'|'50'|'100'`** over `'b25'`/`'bars25'` — terse-union convention; `rangeBarsFor` parses with `Number()` so new counts need zero switch cases. Rejected: discriminated `{kind:'bars'}` object — every consumer binding gets noisier for no payoff.
- **`rangesByInterval` Record keyed by `ChartIntervalKey`** over a three-field object — exact precedent of `selectedIdsByInterval`; `TWO_DAY` key required for exhaustiveness (sandbox-only interval, defaults `'50'`).
- **`setRange` targets `activeChartInterval`** — reuses the existing active-chart mechanism (`setInterval` syncs it in single mode, `setActiveChart` in triple) rather than adding a new target concept.
- **Mirror the hidden `chart-toolbar`** — a stale pill group fed `'25'` with no matching button would highlight nothing if ever re-enabled; three lines of markup buys the consistency.
- **Drop `'recent'` entirely** (not alias) — no persisted state exists to migrate (service is page-scoped), and its role is covered by bar counts + calendar presets.

## Sequence / phases

Single FE phase — two tasks, ordered:

1. **FE Task — range state model** — union, service map/`activeRange`/`setRange` targeting, `rangeBarsFor` + computeds + `RECENT_*` removal, service + signal-detail specs. Lands the whole behavior change; toolbars still compile (old presets remain valid members).
2. **FE Task — pill UI** — both toolbar templates, pill ordering, active-class bindings, toolbar specs. Depends on Task 1 for `activeRange`.

## Prior art / regression

- `selectedIdsByInterval` + `applyIndicatorToggle` — per-interval Record + immutable batch update; copy this shape exactly.
- `activeChartInterval` / `setActiveChart` / `.active-chart` cell styling — the active-chart mechanism this feature rides on.
- `chart-toolbar-state.service.spec.ts`, `signal-detail.component.spec.ts`, both toolbar specs — update in place; every spec referencing `'recent'` needs a rewrite.
- Regression: `visibleBars` semantics, zoom/pan, `ALL_BARS_MAX` sentinel, log-scale pill, indicator menu behavior — all unchanged.

## Verify relay

- `npx jest chart-toolbar-state signal-detail chart-view-toolbar chart-toolbar --coverage=false`
- `npx tsc --noEmit` (catches any missed `'recent'` reference)
- `npx jest --coverage=false` (suite sweep — `ChartRange` is shared)

## Risks / open seams

- `ds-elements.families.ts` references `chart-view-toolbar` in catalog metadata — verify no ds-elements sandbox/spec asserts the old pill set.
- Symbols with fewer bars than the selection show all available — `visibleBars` already tolerates overshoot; pin in a spec.
- In-flight third-party readers of `ChartRange` outside this repo: none (app-internal type).
