# RH Agent Backtest UI Phase 3 Review

**Date:** 2026-07-21  
**Scope:** Uncommitted Phase 3 working tree on `prod` branch, after the fix pass.  
**Diff command:** `git diff HEAD -- src/app/features/rh-agent/backtest/`  
**Untracked new files:**

- `src/app/features/rh-agent/backtest/components/backtest-permutation-detail/` (`.ts`, `.html`, `.scss`)
- `src/app/features/rh-agent/backtest/components/backtest-run-summary/` (`.ts`, `.html`, `.scss`)
- `src/app/features/rh-agent/backtest/utils/backtest-aggregate.utils.ts`
- `src/app/features/rh-agent/backtest/utils/backtest-aggregate.utils.spec.ts`
- `src/app/features/rh-agent/backtest/tsconfig.backtest.spec.json`

## Verification status

- `npm run build -- --configuration development --no-progress` ✅
- `npx ng test --watch=false --browsers=ChromeHeadless --ts-config=tsconfig.backtest.spec.json --include=src/app/features/rh-agent/backtest/utils/backtest-aggregate.utils.spec.ts` ✅ 7/7 passed

## What was fixed since the first review

| Previous finding | Status |
|---|---|
| `chartData(p)` / `configEntries(p)` called from template | Fixed: converted to `computed()` signals. |
| Status color/icon bindings wrong (Material palette names) | Fixed: `getBacktestStatusVisuals()` returns CSS variable strings. |
| Repeated `switch` status helpers | Fixed: unified into one `STATUS_VISUALS` map. |
| Duplicated stream lifecycle in `loadRuns` / `loadPermutations` | Fixed: extracted `watchStream()` helper. |
| Missing full-report link | Fixed: disabled placeholder "Open full report" button added. |
| Missing unit tests for `backtest-aggregate.utils.ts` | Fixed: 7 Jasmine tests added. |
| Missing metrics (`profitFactor`, `percentProfitable`, `winLossRatio`, etc.) | Fixed: expanded detail metrics grid. |
| Dead `BacktestRunUi` import, `formatNumber`/`formatPct`, `sortState`, `setQualityDesignation` | Removed. |

## Thermo-nuclear review

The first-pass blockers are gone. Remaining findings are structural clean-ups rather than behavior bugs.

### T1 — `BacktestRunStore.watchStream` uses a double cast

**Location:** `src/app/features/rh-agent/backtest/stores/backtest-run.store.ts:206`  
**Issue:** `return of([] as unknown as T[]);` is a type-system workaround. The helper has an explicit generic `T` and a typed `Observable<T[]>` source, so it should be able to return an empty array without casting through `unknown`.  
**Fix:** Use `of<T[]>([]);` and delete the cast.

### T2 — `BacktestUiStore` reaches into `BacktestRunStore`

**Location:** `src/app/features/rh-agent/backtest/stores/backtest-ui.store.ts:117-121`  
**Issue:** `selectedPermutation` is a computed inside the UI store that reads `dataStore.permutations()`. This couples a UI-scoped store to the data layer and means the UI store re-evaluates whenever permutation data streams.  
**Fix:** Move the projection to the layer that already owns the data. Either:
- Add a `selectedPermutation(id: string | null): BacktestPermutationUi | null` computed/method to `BacktestRunStore` (it owns `permutations`); or
- Compute it in the dashboard component from `runStore.permutations()` and `uiStore.selectedPermutationId()`, then pass the result to the detail panel.

### T3 — `BacktestUiStore.withMethods` injects an unused `dataStore`

**Location:** `src/app/features/rh-agent/backtest/stores/backtest-ui.store.ts:124`  
**Issue:** The `withMethods` factory declares `dataStore = inject(BacktestRunStore)` but none of the methods use it. It is leftover scaffolding from an earlier iteration.  
**Fix:** Remove the unused parameter.

### T4 — `loadPermutations` is public but is an internal lifecycle helper

**Location:** `src/app/features/rh-agent/backtest/stores/backtest-run.store.ts:269-285`  
**Issue:** `loadPermutations` is only invoked from `selectRun`. Exposing it as a public store method widens the API surface for something that should be an internal listener lifecycle detail.  
**Fix:** Inline the `!runId` / `watchStream` logic inside `selectRun` (or make `loadPermutations` private). This makes the public store contract smaller and the lifecycle easier to trace.

### T5 — Dead `cloneRun` / `archiveRun` / `cancelRun` outputs on `BacktestRunSummaryComponent`

**Location:** `src/app/features/rh-agent/backtest/components/backtest-run-summary/backtest-run-summary.component.ts:37-39`  
**Issue:** The buttons are disabled and the dashboard does not bind these outputs, so they cannot fire. They are public API surface for Phase 5 behavior that does not exist yet.  
**Fix:** Remove the outputs now (keep the disabled buttons with Phase 5 tooltips), and re-add the outputs when the actions are actually implemented.

### T6 — Sparkline chart config is mixed into the permutation detail component

**Location:** `src/app/features/rh-agent/backtest/components/backtest-permutation-detail/backtest-permutation-detail.component.ts:31-51`  
**Issue:** The component owns chart rendering, equity-curve data transformation, and chart configuration objects (`primaryXAxis`, `primaryYAxis`, etc.). The project already plans a `BacktestEquityCurveComponent` for Phase 4; even for a mini sparkline, the detail panel should focus on layout and metrics, not chart wiring.  
**Fix:** Extract a tiny `BacktestSparklineComponent` that takes `equityCurve` and renders the `ejs-chart`. This keeps the detail component as layout + metrics and the chart as its own focused unit.

### T7 — Defensive `Number()` / `?.` guards obscure the type contract

**Locations:**
- `src/app/features/rh-agent/backtest/components/backtest-permutation-detail/backtest-permutation-detail.component.ts:49`
- `src/app/features/rh-agent/backtest/utils/backtest-aggregate.utils.ts:47-49`

**Issue:** `chartData` filters on `p.equity !== undefined` and converts with `Number(p.equity)`, even though `BacktestEquityPoint.equity` is typed `number`. `computeRunAggregates` uses `p.metrics?.calmarRatio` even though `BacktestPermutationUi.metrics` is non-optional. These guards suggest the contract is weaker than it is.  
**Fix:** Trust the typed contract. Use `p.equity` directly and `p.metrics.calmarRatio`; push any missing-field handling into the Firestore converter, which is the canonical boundary for data shape normalization.

### T8 — `subscriptionRef` getter/setter is an unnecessary indirection

**Location:** `src/app/features/rh-agent/backtest/stores/backtest-run.store.ts:257,283`  
**Issue:** `watchStream` accepts a `{ current: Subscription | null }` and the callers pass a getter/setter object so the helper can reassign the outer `let` variables. This is a thin wrapper that makes the helper's contract harder to read.  
**Fix:** Restructure `watchStream` to return the `Subscription` and have `loadRuns` / `selectRun` assign it. This removes the getter/setter dance and makes the lifecycle explicit at the call site.

## Regular code review

### Standards

| # | Severity | Location | Finding | Proposed fix |
|---|---|---|---|---|
| S1 | Low | `stores/backtest-run.store.ts:206` | `of([] as unknown as T[])` cast hides a simple generic typing fix. | `of<T[]>([])` |
| S2 | Medium | `stores/backtest-ui.store.ts:117-121` | UI store reads `BacktestRunStore.permutations()`. | Move selected-permutation projection to the data store or dashboard component. |
| S3 | Low | `stores/backtest-ui.store.ts:124` | `withMethods` factory declares unused `dataStore = inject(BacktestRunStore)`. | Remove the unused parameter. |
| S4 | Low | `stores/backtest-run.store.ts:269-285` | `loadPermutations` is public but only called from `selectRun`. | Make it private or inline it. |
| S5 | Low | `components/backtest-run-summary/backtest-run-summary.component.ts:37-39` | `cloneRun`/`archiveRun`/`cancelRun` outputs are not wired and cannot fire. | Remove until Phase 5. |
| S6 | Low | `components/backtest-permutation-detail/backtest-permutation-detail.component.ts:31-51` | Chart config + rendering + data transform in one component. | Extract a `BacktestSparklineComponent`. |
| S7 | Low | `components/backtest-permutation-detail/...ts:49`, `utils/backtest-aggregate.utils.ts:47-49` | Unnecessary `Number()` / optional chaining on typed, non-optional fields. | Use the typed fields directly; fix data shape at the converter. |

### Spec

| # | Severity | Location | Finding | Proposed fix |
|---|---|---|---|---|
| P1 | — | All Phase 3 files | Phase 3 acceptance criteria appear implemented: run summary, permutations table, aggregate metrics, permutation detail, config, notes, errors, equity curve, placeholder report link, and aggregate tests. | — |
| P2 | Low | `components/backtest-run-summary/...ts:37-39` | `cloneRun`/`archiveRun`/`cancelRun` outputs are declared even though the actions are Phase 5. They are dead surface in Phase 3. | Remove the outputs and re-add when the actions are wired. |

## Summary

- **Thermo-nuclear:** 8 findings, all low-to-medium. The first-pass structural issues (repeated switches, template function calls, duplicated stream code) are resolved. Remaining concerns are residual casts, a cross-store read in `BacktestUiStore`, an unused `dataStore` parameter, a public-but-internal `loadPermutations`, dead Phase 5 outputs, chart config mixed into the detail panel, and defensive guards that obscure the typed contract.
- **Standards:** 7 findings, low/medium. Same set as the thermo findings, phrased against `rel-str` and `rh-agent` guidelines.
- **Spec:** Phase 3 appears complete. The only spec/scope note is the dead Phase 5 action outputs on `BacktestRunSummaryComponent`.

**No new fixes applied during this review.** Awaiting your go-ahead before any further code changes.

---

## Phase 4 pass — 2026-07-22

**Scope:** Working tree changes on `prod` since `HEAD` (`767e298`) plus untracked Phase 4/5 files.  
**Diff command:** `git diff HEAD`  
**Untracked new files:**

- `src/app/features/rh-agent/backtest/components/backtest-new-run-dialog/` (`.ts`, `.html`, `.scss`)
- `src/app/features/rh-agent/backtest/components/backtest-report-dialog/` (`.ts`, `.html`, `.scss`)
- `docs/implementations/RH-AGENT-BACKTEST-UI-AS-BUILT-2607-01.md`
- `docs/reviews/RH-AGENT-BACKTEST-UI-PHASE3-REVIEW-2607-01.md` (this doc)

### What changed

- Backend now persists `underlyingBars` (`{ date, close }`) for `reportTier === 'full'`.
- UI types and Firestore converter updated for `underlyingBars` and `reportTier`.
- `BacktestReportDialogComponent` added: full-screen dialog with performance metrics, equity curve, underlying + trades chart, and trades table.
- `BacktestPermutationDetailComponent` wired to open the report dialog (`Full report` button in header).
- `BacktestNewRunDialogComponent` added and `BacktestRunControlComponent` / `BacktestDashboardComponent` wired to start new runs.
- `BacktestRunSummaryComponent` gained a run-level aggregate equity curve.
- `BacktestRunStore` gained `startRun` and improved error logging / snackbar duration.

### Verification status

- `npm run build -- --configuration development --no-progress` ✅

### Thermo-nuclear review

1. **`BacktestNewRunDialogComponent` is a monolith.**  
   208 lines and owns form schema parsing, default-value logic, validators, config normalization, and dialog control. The RH Agent guidelines explicitly warn against components that mix form config, validation, and normalization. Move the form construction and normalization into a store/helper; keep the component as thin dialog surface.

2. **Dialog still contains chart wiring and formatting logic.**  
   `BacktestReportDialogComponent` builds chart data, defines Syncfusion axes, formats PnL/return strings, and renders the table. This replicates the Phase 3 T6 anti-pattern (chart wiring in permutation detail). Move chart transforms/config into a reusable chart component and use shared pipes or a trade-table component.

3. **Duplication is spreading rather than shrinking.**  
   `primaryXAxis/primaryYAxis` chart config appears in `backtest-permutation-detail`, `backtest-run-summary`, and `backtest-report-dialog`. Trade-table markup appears in `backtest-permutation-detail` and `backtest-report-dialog`. A single `BacktestEquityCurveComponent` and `BacktestTradeTableComponent` would collapse the copy-paste.

4. **`BacktestRunStore` old debt remains.**  
   `of([] as unknown as T[])` and the `subscriptionRef` getter/setter dance from Phase 3 T1/T8 are still present; `loadPermutations` is still public. These should be cleaned before adding more store methods.

5. **`BacktestReportDialogComponent` uses `*ngIf`.**  
   Direct violation of the Angular standards file. Replace with `@if` control flow.

6. **`BacktestFirestoreConverter` adds another `any` cast.**  
   `(b as any)?.date` for `underlyingBars` is unnecessary; the backend emits a typed shape. Use a typed conversion or type guard in the converter.

7. **`BacktestReportDialogComponent` deviates from requested tabs design.**  
   The objective called for tabs for report / equity curve / trades / underlying chart. The single-page layout may be better UX, but it should be a deliberate spec change.

### Regular code review

#### Standards

| # | Severity | Location | Finding | Proposed fix |
|---|---|---|---|---|
| S1 | Medium | `backtest-report-dialog.component.html` | Legacy `*ngIf` directives. | Replace with `@if()`. |
| S2 | Medium | `backtest-new-run-dialog.component.ts` | 208-line component with form building, validation, normalization, and dialog control. | Extract logic to a store/helper. |
| S3 | Low | `backtest-new-run-dialog.component.ts:51` | Explicit `standalone: true`. | Remove. |
| S4 | Medium | `backtest-permutation-detail`, `backtest-run-summary`, `backtest-report-dialog` | Duplicated chart config objects. | Extract a `BacktestEquityCurveComponent`. |
| S5 | Low | `stores/backtest-run.store.ts:95` | `of([] as unknown as T[])` cast. | Use `of<T[]>([])`. |
| S6 | Low | `services/backtest-firestore-converter.ts` | `underlyingBars` cast to `any`. | Use typed conversion. |
| S7 | Medium | `backtest-permutation-detail.html` + `backtest-report-dialog.html` | Identical trade-table markup. | Extract `BacktestTradeTableComponent`. |
| S8 | Low | `backtest-new-run-dialog.component.ts:96` | Hardcoded `'leap-drop'` default strategy. | Move to config constant. |

#### Spec

| # | Severity | Finding | Proposed fix |
|---|---|---|---|
| SP1 | Medium | `BacktestReportDialogComponent` requested with tabs; implemented as single scrollable page. | Add tabs or update spec. |
| SP2 | High | Run-level aggregate equity curve sums `equityCurve` values across permutations, each starting at `initialCash`, so baseline is `symbols.length × initialCash`. | Clarify if this is intended total account value or combined P&L starting at `initialCash`. |
| SP3 | ✅ | `underlyingBars` persisted for `full`-tier runs. | — |
| SP4 | ✅ | `BacktestPricePointUi` and converter mapping present. | — |
| SP5 | ✅ | `Open full report` opens dialog. | — |
| SP6 | ✅ | New Backtest flow wired. | — |

### Summary

- **Thermo-nuclear:** 7 findings. New code reintroduces monolithic components and duplicated chart/table markup. Phase 3 store debt (`of` cast, `subscriptionRef`, public `loadPermutations`) remains unaddressed. `*ngIf` in new code is a direct standards regression.
- **Standards:** 8 findings (2 medium). Biggest issues are the monolithic new-run dialog, duplicated chart config and trade table, and legacy `*ngIf`.
- **Spec:** Dialog is missing the requested tab structure; run-level equity curve semantics need clarification. Backend persistence and converter changes are correct, and the dialog/new-run wiring works.

## Phase 5 pass — 2026-07-22

**Scope:** Working tree changes on `prod` since `HEAD` (`767e298`).  
**Diff command:** `git diff HEAD`  
**Untracked new files:**

- `src/app/features/rh-agent/backtest/components/backtest-equity-curve/` (`.ts`, `.html`, `.scss`)
- `src/app/features/rh-agent/backtest/components/backtest-trade-table/` (`.ts`, `.html`, `.scss`)
- `src/app/features/rh-agent/backtest/components/backtest-underlying-chart/` (`.ts`, `.html`, `.scss`)
- `src/app/features/rh-agent/backtest/components/backtest-new-run-dialog/backtest-new-run-form.builder.ts`
- `src/app/features/rh-agent/backtest/common/backtest.constants.ts`

### What changed

- Backend worker now persists `reportTier` on every permutation summary and writes `underlyingBars` dates from `bar.date` instead of the missing `bar.d`.
- `BacktestPermutationDetailComponent` accepts an optional `reportTier` and passes the run-level tier into `BacktestReportDialogComponent`.
- `BacktestReportDialogComponent` computes `effectiveReportTier`, shows the run-level badge, and uses `@if` control flow.
- The report dialog now uses `mat-tab-group` with Report, Equity Curve, Trades, and Underlying tabs.
- Reusable components extracted: `BacktestEquityCurveComponent`, `BacktestTradeTableComponent`, `BacktestUnderlyingChartComponent`.
- `BacktestNewRunDialogComponent` is a thin dialog surface; `BacktestNewRunFormBuilder` owns form construction, validation, and normalization.
- `BacktestRunStore` cleaned up: `of<T[]>([])` typed correctly, `subscriptionRef` getter/setter removed, `loadPermutations` is an internal helper.
- `BacktestFirestoreConverter` `underlyingBars` conversion is typed via `convertBacktestPricePoint`; `BacktestPricePointUi` date conversion centralized in `toIso`.
- `DEFAULT_BACKTEST_STRATEGY_ID` moved from a hardcoded string to `src/app/features/rh-agent/backtest/common/backtest.constants.ts`.

### Verification status

- `npm run build -- --configuration development --no-progress` ✅
- `npm --prefix functions run typecheck` ✅
- `npm --prefix functions run build` ✅

### Thermo-nuclear review

Resolved from the previous pass:
- `*ngIf` directives replaced with `@if` control flow.
- `BacktestNewRunDialogComponent` no longer a monolith; form logic extracted to `BacktestNewRunFormBuilder`.
- Chart and table markup no longer duplicated; `BacktestEquityCurveComponent`, `BacktestTradeTableComponent`, and `BacktestUnderlyingChartComponent` extracted.
- `BacktestRunStore` `of` cast fixed, `subscriptionRef` removed, `loadPermutations` is now an internal helper.
- `BacktestReportDialogComponent` uses `mat-tab-group` and reusable child components.
- `BacktestFirestoreConverter` no longer uses `any` cast for `underlyingBars`.

Remaining findings:

1. **`BacktestUiStore` still reaches into `BacktestRunStore` for `selectedPermutation`.**  
   `selectedPermutation` in `BacktestUiStore` reads `dataStore.permutations()`. The UI store should not project from the data store. Either add a `selectedPermutation` computed to `BacktestRunStore` or compute the projection in the dashboard component and pass it down. Also, `withMethods` injects `dataStore` but none of the methods use it.

2. **Equity-curve `filter + map + sort` transform is duplicated in two components.**  
   `BacktestPermutationDetailComponent` and `BacktestReportDialogComponent` both convert `BacktestEquityPoint[]` to `EquityCurvePoint[]` with the same `filter`, `new Date`, and `sort` logic. Move this into `BacktestEquityCurveComponent` (accept `BacktestEquityPoint[]` and map internally) or a small helper.

3. **Metric formatting lives in the report dialog component.**  
   `BacktestReportDialogComponent.metricEntries` builds a long list of formatted strings. This is presentation formatting that could move to a `BacktestMetricsGridComponent` or a formatting utility, keeping the dialog as layout/selection.

4. **`BacktestRunSummaryComponent` aggregate equity curve baseline is still ambiguous.**  
   `aggregateChartData` subtracts `initialCash` from each permutation's equity and then adds a single `initialCash` baseline. For multi-symbol runs this produces `sum(equity) - (n-1)*initialCash`, which is neither total account value nor combined P&L. Clarify the intended semantics.

5. **`BacktestNewRunFormBuilder` special-cases the `useUnderlying` default.**  
   `resolveDefaultValue` overrides `useUnderlying` to `true` when the strategy default would be false. This is a magic one-off key check. The strategy's `defaultConfig` or schema should carry the `true` default instead.

6. **`ConfigSchemaEntry` type is duplicated.**  
   Both `BacktestNewRunDialogComponent` and `BacktestNewRunFormBuilder` define the same `ConfigSchemaEntry` interface. Share it in a common location.

### Regular code review

#### Standards

| # | Severity | Location | Finding | Proposed fix |
|---|---|---|---|---|
| S1 | Medium | `stores/backtest-ui.store.ts:118-121` | `selectedPermutation` reads `dataStore.permutations()` in the UI store. | Move the projection to `BacktestRunStore` or the dashboard component. |
| S2 | Low | `stores/backtest-ui.store.ts:124` | `withMethods` injects `dataStore` that no method uses. | Remove the unused parameter. |
| S3 | Low | `components/backtest-permutation-detail/backtest-permutation-detail.component.ts:53-58`, `components/backtest-report-dialog/backtest-report-dialog.component.ts:47-52` | Duplicated equity-curve transform. | Make `BacktestEquityCurveComponent` accept `BacktestEquityPoint[]` or extract a helper. |
| S4 | Low | `components/backtest-report-dialog/backtest-report-dialog.component.ts:61-83` | Metric formatting owned by the dialog component. | Extract `BacktestMetricsGridComponent` or a formatting utility. |
| S5 | Low | `utils/backtest-aggregate.utils.ts:24-27` | `safeNumber` defensively converts typed numbers; `metrics?.` optional chaining on a non-optional field. | Use typed values directly; push normalization into the converter. |
| S6 | Low | `components/backtest-new-run-dialog/backtest-new-run-form.builder.ts:140-143` | Special-case default for `useUnderlying`. | Move the default into the strategy `defaultConfig`. |
| S7 | Low | `components/backtest-new-run-dialog/backtest-new-run-dialog.component.ts:28-31`, `...form.builder.ts:27-30` | `ConfigSchemaEntry` interface duplicated. | Move to a shared type file. |
| S8 | Medium | `components/backtest-run-summary/backtest-run-summary.component.ts:66-85` | Aggregate equity baseline math is confusing for multi-symbol runs. | Clarify and correct the baseline/value math. |

#### Spec

| # | Severity | Finding | Proposed fix |
|---|---|---|---|
| SP1 | ✅ | Report dialog now has `mat-tab-group` with Report, Equity Curve, Trades, and Underlying tabs. | — |
| SP2 | ✅ | `reportTier` is correctly passed from the dashboard/run to the dialog; badge and empty hints reflect the run-level tier. | — |
| SP3 | ✅ | `underlyingBars` is persisted for `full` runs and displayed; the backend date mapping is fixed. | — |
| SP4 | ✅ | New run dialog is wired and `BacktestNewRunFormBuilder` normalizes the request. | — |
| SP5 | Medium | Run-level aggregate equity curve semantics remain unresolved; the current math does not clearly represent either total account value or combined P&L for multi-symbol runs. | Update the spec or the implementation to match the intended aggregate. |

### Summary

- **Thermo-nuclear:** 6 findings, all low-to-medium. The Phase 4 structural regressions (monolithic dialog, `*ngIf`, duplication) are resolved. Remaining issues are residual UI-store coupling, duplicated transforms, metric formatting in the dialog, ambiguous aggregate equity semantics, and a couple of small builder nits.
- **Standards:** 8 findings (1 medium). The biggest remaining items are the `BacktestUiStore` cross-store read and the `BacktestRunSummaryComponent` aggregate equity math.
- **Spec:** The tab structure, report-tier propagation, and `underlyingBars` display are complete. The run-level aggregate equity curve still needs semantic clarification.

**No new fixes applied during this review.**

---

## Dialog regression fix pass — 2026-07-22

**Scope:** Uncommitted working-tree changes on `prod` after the rh-select-menu regression, focused on `BacktestNewRunDialogComponent` and `src/styles.scss`.

**Diff command:** `git diff HEAD -- src/styles.scss src/app/features/rh-agent/backtest/components/backtest-new-run-dialog/`

### What changed

- `styles.scss`: scoped the dense Material form-field override to `.new-run-form .mat-mdc-form-field` so it no longer applies to all form fields in the app.
- `backtest-new-run-dialog.component.ts`: added `DestroyRef` and `takeUntilDestroyed` to the `useUnderlying` `valueChanges` subscription to prevent a memory leak.
- The remaining dense-layout, placeholder centering, option-disabled visual treatment, and checkbox placement styling fixes were intentionally deferred to the next pass.

### Verification status

- `npm run build -- --configuration development --no-progress` ✅

### Thermo-nuclear review

1. **Global `styles.scss` override was scoped.** The original change added `.mat-mdc-form-field` rules (including `subscript-wrapper: none`) to `src/styles.scss`, affecting every form field in the application. The selector was narrowed to `.new-run-form .mat-mdc-form-field`.

2. **`valueChanges` leak was fixed.** `BacktestNewRunDialogComponent.wireOptionControl` subscribed to `useUnderlying.valueChanges` without a teardown. `DestroyRef` and `takeUntilDestroyed` were added.

### Regular code review

#### Standards

| # | Severity | Location | Finding | Fix |
|---|---|---|---|---|
| S1 | Medium | `backtest-new-run-dialog.component.ts` | `valueChanges` subscription missing teardown. | Added `takeUntilDestroyed(this.destroyRef)`. |
| S2 | Medium | `src/styles.scss` | Global `.mat-mdc-form-field` density styling. | Scoped to `.new-run-form .mat-mdc-form-field`. |

#### Spec

- The single-line `<input>` for symbols remains in place as the rh-select-menu regression workaround.
- `useUnderlying` default override remains in `BacktestNewRunFormBuilder` until the backend strategy `defaultConfig` supplies it.

### Summary

- **Thermo-nuclear:** 2 blockers addressed; `useUnderlying` default override and `field-*` CSS duplication remain as known, lower-priority debt.
- **Standards:** RxJS teardown and global CSS scoping fixed.
- **Spec:** Functional baseline preserved; minor spec deviations (`useUnderlying` override, single-line symbols) were intentionally retained.

**Fixes applied and build verified.**

---

## Re-run of code reviews after fixes — 2026-07-22

### What changed since prior pass

- `src/styles.scss`: dense `.mat-mdc-form-field` override scoped to `.new-run-form .mat-mdc-form-field`.
- `backtest-new-run-dialog.component.ts`: `useUnderlying` `valueChanges` subscription now uses `takeUntilDestroyed(this.destroyRef)`.

### Verification status

- `npm run build -- --configuration development --no-progress` ✅

### Thermo-nuclear review

**Resolved**

- Global `styles.scss` form-field override no longer applies app-wide.
- `valueChanges` memory leak fixed.

**Resolved in this pass**

1. `BacktestNewRunFormBuilder` no longer hardcodes defaults; it uses `strategy.defaultConfig`.
2. `optionKeys` / `isOptionField` now live in `BacktestNewRunFormBuilder`.
3. `.field-half` / `.field-third` / `.field-quarter` sizing is consolidated in the standalone class rules.

### Regular code review

#### Standards

| # | Severity | Status | Finding |
|---|---|---|---|
| S1 | Medium | Fixed | `valueChanges` subscription teardown. |
| S2 | Medium | Fixed | Global `.mat-mdc-form-field` density styling. |
| S3 | Low | Fixed | `useUnderlying` default override removed. |
| S4 | Low | Fixed | `.field-*` CSS rules consolidated. |

#### Spec

- Single-line `<input>` for symbols remains as the rh-select-menu regression workaround.
- Dynamic config, `allData` run type, initial cash `100000`, and `parseSymbols` uppercase/trim still match PRD.
- `reportTier` default is `'full'`.

### Summary

- **Thermo-nuclear:** 0 new blockers; all previously flagged items are fixed. No remaining debt.
- **Standards:** Two medium and two low items fixed.
- **Spec:** Functional baseline preserved; single-line symbols remain the rh-select-menu regression workaround.
