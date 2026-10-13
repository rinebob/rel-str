# Code Review — Trigger Bands prod promotion (#932)

**Topic:** Trading Indicator Library  
**Topic Slug:** indicator-lib  
**Thread:** Implement ST Trigger Bands in ST Indicator Library  
**Thread Slug:** st-trigger-bands  
**Issue:** #875  
**Thread Parent:** #862  
**Topic Parent:** #261  
**Task:** #932  
**Domain:** INDICATOR-LIB  
**Type:** Code Review  
**Status:** Complete  
**Created:** 2026-10-09  
**Last Updated:** 2026-10-09  

## Verdict: **PASS** (rounds 2–3 remediated in-loop)

Standards **PASS** · Spec **PASS** · Thermo-nuclear **PASS** — after two in-loop remediation rounds. Round 1 produced two major findings (dead staleness check on an unreachable path; boundary-cast workaround in the BE filter). The round-3 re-review of the remediated patch found one more major (stale `symbolDataVersion` window on symbol switch → wasted callable + transient cross-symbol injection) plus four minors — all fixed and re-verified before this verdict. Three parallel review sub-agents ran against the scoped diff each round (`.devin/tmp/932-review*.diff`, ~1,700 lines across 24 files); the working tree carries ~100 unrelated modified files from other threads (#934 sandbox settings, order-ticket/screenshot work, paper trading), which were excluded.

## What shipped

- `ST_TRIGGER_BANDS` + `ST_TRIGGER_BANDS_DOTS` removed from `DEV_INDICATOR_TYPES`; `ST_TRIGGER_BANDS_INDICATOR` joined `ST_INDICATOR_OPTIONS`; `ST_DEV_INDICATOR_OPTIONS` emptied (gate mechanism retained for the next dev indicator).
- Signal-detail is the only prod surface with an ST indicator picker — quick-charts and gallery use fixed indicator sets (verified: neither consumes `ST_INDICATOR_OPTIONS`). Both TB options land in the D/W interval allowlists via a new `OPT_IN_INDICATOR_IDS` set, default-unchecked.
- Opt-in lean request (`IndicatorFamily.TRIGGER_BANDS`, DAILY+WEEKLY) under its own `IndicatorSeriesStore` cache key; the default response is never refetched or invalidated. `bindTriggerBandsRequest` (new, `chart-indicators/trigger-bands-request.ts`) is the shared binding used by signal-detail and the sandbox.
- `warnIfStaleSeries` extracted in `indicator-converters.ts`; the live injector `injectTriggerBandsData` now performs the staleness diagnostic (bars + label params). Dead `signals.triggerBands` slot removed BE+FE; the `injectCallableIndicatorData` TB case and `convertIntervalIndicators.triggerBands` field removed.
- Light theme: `colorRemap['#ffffff'] → '#9e9e9e'` (invisible neutral band fix; see Spec note on state colors).
- `BESPOKE_MAIN_PANE_INDICATORS` set replaces the five-clause `!==` template chain.
- `TRIGGER_BANDS_SIGNAL_TYPES` + `TriggerBandsSignalType` + `isTriggerBandsSignalType` shared consts; `ST_TRIGGER_BANDS_DOT_COLORS` keyed by the union — literal drift fails loudly both directions.
- Latent bug found by the new spec: `IndicatorSeriesStore.clearCache(symbol)` used `key.startsWith(symbol + '|')` but keys are `callable|symbol|…` — never matched. Fixed to `key.split('|')[1] === symbol`; pinned by spec.

## Findings and disposition

### Critical / Major — remediated in-loop

| # | Severity | Finding | Disposition |
|---|----------|---------|-------------|
| 1 | major | `injectCallableIndicatorData` staleness `families` still listed `triggerBands` on a path prod can never reach, while the live `injectTriggerBandsData` had no check — the #879 diagnostic silently died | **Fixed.** `warnIfStaleSeries` extracted; the lean injector calls it with `bars`/`label`; spec retargeted to the live path incl. a case pinning that the default injector ignores TB |
| 2 | major | `indicator-series-filter.ts` used `Record<string, unknown>` boundary casts to index `signals` by `StrategyFamily` | **Fixed.** `if (family === StrategyFamily.TRIGGER_BANDS) continue;` narrows the enum; typed indexing restored, casts and comment deleted |
| 3 | major (judgement) | `signal-detail.component.ts` grew to ~661 lines (>400 = strong smell per rel-str-coding-guidelines §1) | **Partially addressed + waived.** The `bindTriggerBandsRequest` extraction deleted the triplicated gate+arg-tuple+effect (~35 lines) and dedupes the sandbox twin. The file is an orchestration shell whose size predates #932; a fuller split is out of scope for this task |

### Minor — remediated in-loop

| # | Severity | Finding | Disposition |
|---|----------|---------|-------------|
| 4 | minor | Lean-request machinery duplicated near-verbatim between signal-detail and sandbox (gate + five-arg tuple + untracked effect) | **Fixed.** `bindTriggerBandsRequest({enabled, symbol, version, store})` in `chart-indicators/trigger-bands-request.ts` owns the effect + response lookup; both components pass their own gate |
| 5 | minor | `triggerBandsSelected` gated on selection but not scope — monthly-only view still fired the D/W request | **Fixed.** Gate now intersects with `indicatorScope()`; a monthly-only view does not fetch data it won't draw |
| 6 | minor | Stale comments: dots indicator "not a menu entry of its own" (now a prod menu entry); visuals comment said neutral white "needs a remap" (now exists) | **Fixed.** Both comments updated to describe post-#932 reality |

### Advisory — deferred / declined

| # | Severity | Finding | Disposition |
|---|----------|---------|-------------|
| 7 | minor (spec) | AC says "neutral band + state colors get `colorRemap` entries"; only `#ffffff` mapped — `#ffeb3b`/`#2962ff` pass through | **Deliberate deviation, recorded.** `colorRemap` is a global per-hex map, not per-indicator — remapping `#ffeb3b` would recolor every yellow element in the app (zones, trend-strength vocabulary). `#2962ff` is already legible on light. Yellow-on-white matches every other indicator's light appearance; the AC's intent (invisible element fixed) is met |
| 8 | minor | `key.split('|')[1]` magic index in `clearCache` | Declined — the adjacent comment documents the key layout; a one-use helper adds indirection without clarity |
| 9 | nit | `tbPoint`/`tbDot` fixtures duplicated across three specs and already drifting | Deferred — a shared `trigger-bands.fixtures.ts` is worth it when a fourth consumer appears |
| 10 | nit | Spec-local `ResponseLookup` redeclares the store's `responseFor` signature | Deferred — structural typing is honest; exporting a type solely for the mock adds surface |
| 11 | nit | Fixture `as SymbolIndicatorSeriesResponse` casts in the new store spec | Accepted — fixtures; no `as never`/`as any` remains in touched specs (diff removed two) |
| 12 | nit | Second `!==` chain survives at `flex-chart.component.html` for lower-pane scatter connectors | Intentional — different semantic (connector suppression, not series exclusion) |

### Round 3 — re-review of the remediated patch

| # | Severity | Finding | Disposition |
|---|----------|---------|-------------|
| 13 | major | `ChartStore.loadCharts` never blanks `symbolDataVersion` at fetch start — on a symbol switch A→B the binding fired `loadIfNeeded('B','vA')`: a guaranteed wasted callable, and if it resolved first, B's bands/dots could inject onto A's still-displayed bars. Pre-existing hole in the default path too; the new binding made it reachable on a prod surface | **Fixed.** `symbolDataVersion: ''` added to `loadCharts`' initial `patchState`; `chart.store.spec.ts` pins the blanked-version window (red → green) |
| 14 | minor | `warnIfStaleSeries`'s `!lastBarDate` early-return silently disabled the diagnostic for `date`-less bars | **Fixed** — comment documents the guard's purpose |
| 15 | minor | `indicator-series-filter.ts` still carried a write-side `Record<string, unknown>` cast in the indicators loop | **Fixed** — comment explains why the union-RHS write needs the escape and why it can't hide a missing slot |
| 16 | minor | `IndicatorSeriesState.cache` doc still described the pre-callable-name key layout | **Fixed** — comment now matches `cacheKey`'s `callable|symbol|…` layout |
| 17 | minor | Sandbox `triggerBandsEnabled` didn't gate on interval — monthly fired the D/W lean request nothing could draw | **Fixed** — gate now requires `interval() !== ChartIntervalKey.MONTHLY` |
| 18 | minor | Fixture duplication now spans ≥4 specs and is drifting (`version` literals, `signalType` shapes) | Deferred — a shared `trigger-bands.fixtures.ts` is justified but adds churn to an already-entangled diff; tracked for cleanup |
| 19 | nit | Lean-request failure is silent — `loadingFor`/`errorFor` exist on the store but no consumer surfaces them | Advisory — consistent with the default path's handling; worth revisiting when opt-in indicators multiply |
| 20 | nit | `warnIfStaleSeries` re-fires on every indicator computed while data is stale | Advisory — pre-existing pattern, acceptable noise |

**Round 4 — delta re-review (no new findings).** Scoped to the round-3 remediation delta (~40 lines: `chart.store.ts` version-blank + spec, sandbox monthly gate, three comment blocks). All five `symbolDataVersion` consumers guard `!version → undefined`; `clearCharts`/error branch already blanked it; `next` re-sets before the internal fetch — ordering correct. The binding's response `computed` additionally gates on `enabled`, so sandbox monthly is now no-fetch *and* no-lookup while the config branch already rendered nothing there. Cosmetic note: a same-symbol `loadCharts` refresh now blanks indicators during the refetch gap (previously the stale version kept the cached response visible) — more honest, reappears on cache-hit. Converged: review loop closed.

**Ship-planning advisory (Standards A1):** the #934 contamination is wider than the sandbox spec block — `sandbox-settings` imports, `stored` seeding, `paramOverrides`, auto-save effect, `resetSettings`, and the Reset button are interleaved through `flex-chart-sandbox.component.{ts,html}` plus two untracked files (`sandbox-settings.ts`, `sandbox-settings.spec.ts`). The component's `import './sandbox-settings'` breaks the build if that file is excluded. At ship time either include all five #934 files deliberately or do edit surgery on the field initializers — a spec-block-only hunk split will not compile.

### Process note — diff contamination

`flex-chart-sandbox.component.spec.ts` in the working tree contains the sibling task #934's `describe('Sandbox settings persistence (#934)')` block (+139 lines), which imports `./sandbox-settings` — a file owned by that session. At commit time the sandbox spec diff must be split (same technique as the #880 AVWAP split) so #932 ships only its own hunks.

## Test results

- Focused suites, post-remediation (rounds 2+3): **9 suites / 106 tests green** — signal-detail, sandbox, indicator-converters, trigger-bands-chart, indicator-series.store (new), chart.store (new `symbolDataVersion` blanking spec), flex-chart-indicator-visuals (new), flex-chart-theme, flex-chart.component.
- Full suite: **3293 passed / 47 failed across 3 suites — all unrelated to #932** (the failing files are untouched by this change):
  - `shared/screenshot-capture-contracts.spec.ts` (1) — `PositionType` enum extended by uncommitted #746 option work in the shared worktree.
  - `signal-order/order.component.spec.ts` (42) — `No provider for Functions` via `OrderExecutionService → ScreenshotService`; uncommitted order-ticket/screenshot edits from another session.
  - `flex-chart-sandbox` had 4 transient #934 failures during the run (the other session was mid-edit); a clean re-run shows the suite at 34/34.
- `functions` typecheck: my files clean; 3 errors in `functions/src/screenshot-capture/*` + `scripts/verify/screenshot-capture-826-lifecycle.ts` — uncommitted #746 work, not this change.
- App typecheck: 3 baseline errors on committed files (`bulk-swing-sweep.ts` ×2, `indicator-config-dialog.component.ts`) — all pre-existing on HEAD, none in the #932 file set.
- The new live-path staleness warning was observed firing correctly during the suite (sandbox + signal-detail console output).

## Verification map (acceptance criteria)

| Criterion | Where |
|-----------|-------|
| Dev types emptied, TB in prod menu | `indicator-registry.ts`; pinned by `flex-chart.component.spec.ts` dev-gate block |
| Opt-in lean request, own cache key, no invalidation | `bindTriggerBandsRequest`; `indicator-series.store.spec.ts` coexistence/no-refetch/no-invalidation specs |
| Light-theme invisible band | `flex-chart-theme.ts` + spec pin (see finding 7 for the deliberate single-hex scope) |
| Shared signalType consts, keyed dot map | `flex-chart-indicator-visuals.ts` + spec; BE emits via consts; FE guards with `isTriggerBandsSignalType` |
| Dead `signals.triggerBands` + converter branches removed | `indicator-computation.ts`, `indicator.types.ts`, `indicator-converters.ts`; pinned by spec ("default injector no longer handles TB") |
| `BESPOKE_SERIES_TYPES` set | `chart-data-adapter.service.ts` `BESPOKE_MAIN_PANE_INDICATORS` + template |
| Monthly decided | D/W only — allowlists, lean intervals, `triggerBandsSelected` scope gate |
| Sandbox keeps working | `callableOnlyOptionIds` (synthetic disable preserved); sandbox spec green |
| Store keying spec; `as never` cleanup | `indicator-series.store.spec.ts` (5 tests); `ResponseLookup`-typed mock replaces casts |
