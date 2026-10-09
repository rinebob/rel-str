# Code Review — Trigger Bands dots, dev-mode gate and sandbox wiring (#880)

**Topic:** Trading Indicator Library  
**Topic Slug:** indicator-lib  
**Thread:** Implement ST Trigger Bands in ST Indicator Library  
**Thread Slug:** st-trigger-bands  
**Issue:** #875  
**Thread Parent:** #862  
**Topic Parent:** #261  
**Task:** #880  
**Domain:** INDICATOR-LIB  
**Type:** Code Review  
**Status:** Complete  
**Created:** 2026-10-08  
**Last Updated:** 2026-10-08  

## Verdict: **PASS**

Standards **PASS** · Spec **PASS** · Thermo-nuclear **PASS**. No critical or major findings after severity review; all findings are advisory and recorded below — several are explicitly scoped to the prod-promotion task. Three parallel review sub-agents ran against the scoped diff; the working tree carries ~200 unrelated modified files from other threads (Anchored VWAP, options, nav), which were excluded.

## Scope

Reviewed the uncommitted Trigger Bands changes for #880. Several files also carry already-reviewed #879 hunks; the band renderer was substantially rewritten during #880 (six `StepLine` state-series → two `MultiColoredLine` series with step-expanded data → hinge+level geometry), so the current state of the trigger-bands hunks was reviewed in full.

- `shared/flex-chart-indicator-visuals.ts` — Pine palette (`ST_TRIGGER_BANDS_COLORS` per-band, `ST_TRIGGER_BANDS_DOT_COLORS`), uniform `ST_TRIGGER_BANDS_LINE_WIDTH`
- `functions/src/st-cloud-function/indicator-computation.ts` — armed-state pullback dots (`longPullbackState`/`shortPullbackState`) + breakout dots
- `functions/scripts/verify/indicator-lib-877-callable.ts`, `tests/functions/st-trigger-bands-series.test.ts`
- `flex-chart.types.ts` (`FlexChartConfig.dev`, `StIndicator.ST_TRIGGER_BANDS_DOTS`, `triggerBandData`), `flex-chart.component.ts` (`effectiveConfig` dev strip, `MultiColoredLineSeriesService`), `.html` (bespoke band series + dots scatter), `.spec.ts` (dev-gate specs)
- `indicators/indicator-registry.ts` (`DEV_INDICATOR_TYPES`, `ST_DEV_INDICATOR_OPTIONS`) + new spec
- `indicators/st-trigger-bands.indicator.ts` (new — `computeTriggerBandLines` step expansion; replaces deleted `st-trigger-band.indicator.ts`) + spec
- `services/chart-data-adapter.service.ts` (`triggerBandSeries`, per-point colors) + spec
- `utils/chart-indicators/` — `convertTriggerBandsDotMarkers`, `injectTriggerBandsData`, base-indicators extras channel, `trigger-bands-chart.spec.ts`, `base-indicators.spec.ts`, `indicator-converters.spec.ts`
- `stores/chart.store.ts` — lean opt-in request constants
- `pages/flex-chart-sandbox/` — indicator picker entry, lean request effect, extras merge, "TB dots" sub-toggle (default off), synthetic-mode guards
- Docs: FE IMPL "As built in #880", BE/FE TEST updates
- signal-detail: all earlier wiring reverted to `prod` — verified no diff remains

## Standards

Passes the documented standards. Dev gating is well-designed: `DEV_INDICATOR_TYPES` + a single strip in `effectiveConfig` (the one funnel into adapter, lifecycle facade, axis labels), `ST_DEV_INDICATOR_OPTIONS` kept out of `ST_INDICATOR_OPTIONS`. `StrategyFamily.TRIGGER_BANDS` as a fallback-suppressor is real and documented (`indicator-series.ts:68`, `chart.store.ts:47-53`). Syncfusion usage (`MultiColoredLine` + `pointColorMapping` + `Gap` empty points) matches repo patterns. Backend specs use `node:test` like 56 sibling files; jest specs use `jest.fn`/`expect`, no `jasmine.clock` or `setTimeout` flushes. No public invokers, no `cors: true`. Old `st-trigger-band.indicator.ts` has no remaining references.

Findings:

- **Minor — `signalType` wire literals duplicated across the boundary** (guideline §2 "shared constants must exist once"). `indicator-computation.ts:477-480` emits raw `'TRIGGER_BANDS_LONG_PULLBACK'` etc.; `ST_TRIGGER_BANDS_DOT_COLORS` (`flex-chart-indicator-visuals.ts:130-133`) re-keys the same literals. Both sides already import the shared module via `@flex-chart/indicator-visuals`. Rated minor rather than major: consistent with the codebase's existing marker convention (`cross-zero` literals at `indicator-computation.ts:242`), and both sides are pinned by tests (BE golden fixture asserts the exact strings; the FE spec iterates all four keys). Drift would still silently drop dots — tighten with a shared union/const before promotion.
- **Minor — dead contract slot** `signals.triggerBands` (`indicator-computation.ts:113,168`; FE mirror `indicator.types.ts:78`) — declared, never populated.
- **Minor — type-erased fixtures in new spec code** (§10): `flex-chart-sandbox.component.spec.ts:416` casts the `responseFor` stub `as never`; `:498` uses `{ target: { checked: true } } as unknown as Event`.
- **Minor — file size (§1)**: the diff deepens three already-oversized files (`chart-data-adapter.service.ts` 527, `flex-chart-sandbox.component.ts` 421, `indicator-computation.ts` 647 lines). Pre-existing debt; the per-indicator engine-module precedent suggests extracting `triggerBandSeries` next time the adapter is touched.
- **Nit — naming**: `TriggerBandsPoint` (wire) vs `TriggerBandPoint` (renderer) differ by one character; `triggerBandsDots` is a boolean signal in the sandbox vs `ChartExtras.triggerBandsDots` array.
- **Nit — loose index signature**: `ST_TRIGGER_BANDS_DOT_COLORS: Record<string, string>` types every string as a valid key; a keyed union fixes it together with finding 1.
- **Nit — redundant cast**: `indicator-computation.ts:439-440` `as number` after a null check that already narrows.

## Spec

Every acceptance criterion is met or was superseded by explicit user clarification:

| Acceptance criterion (#880) | Result |
|---|---|
| `convertTriggerBandsDotMarkers` maps `dotMarkers.triggerBands` to scatter points; long/short and breakout/pullback visually distinct | Met — `signal-marker-converters.ts:106-115`, Pine two-hue vocabulary; side carried by position (backend ATR offset) |
| One toggle enables bands and dots together | Met per clarification — user directed a separate sandbox-only "TB dots" sub-toggle defaulting **off** (supersedes the AC wording; noted on #880) |
| `FlexChartConfig.dev` render gate; `ST_DEV_INDICATOR_OPTIONS` keeps dev types out of prod menus | Met — single-funnel strip verified across all render paths (`flex-chart.component.ts:135-149`); gate specs `flex-chart.component.spec.ts:311-379` |
| Enabling adds `IndicatorFamily.TRIGGER_BANDS` via separate lean request with own cache key; disabling leaves request unchanged; default response never invalidated | Met — `chart.store.ts:47-53`, sandbox effect `:352-369` with `untracked`; `cacheKey` sorts/joins filter arrays so the keys are distinct |
| Older backend without `triggerBands` renders nothing, logs no errors | Met — `injectTriggerBandsData`/`triggerBandSeries`/dot converter all yield `[]`; specs cover it |
| Manual sandbox check (D/W, TradingView comparison) | Deferred to QA by design — needs the deployed callable |
| Specs pass | Met — see test results |

Scope creep: minimal. The dead TB branch in `injectCallableIndicatorData`/`convertIntervalIndicators` is prod-path prep — see findings. Dot semantics verified against the clarified requirement (armed-state pullback dots until breakout; golden fixture at `st-trigger-bands-series.test.ts:117-126`). Step-expansion left-endpoint coloring and warm-up gaps spec-pinned.

Test-plan coverage: all unit targets covered (dots live in `trigger-bands-chart.spec.ts` rather than extending `signal-marker-converters.spec.ts` — equivalent coverage, different file than the plan named). One literal gap: no `IndicatorSeriesStore` spec asserting the two cache keys coexist — the mechanism was verified by trace (finding 15). Component wiring on quick-charts/signal-detail is deferred per the dev-first scope change.

## Thermo-nuclear

Full-path trace verified: sandbox pick → `enabledIndicators` → lean `loadIfNeeded` → callable filter → `injectTriggerBandsData` + `convertTriggerBandsDotMarkers` → `effectiveConfig` dev-strip → adapter → `MultiColoredLine` + scatter. The signal-detail pivot left no dead UI plumbing; the dev gate is the right shape (registry-owned lists, one funnel). Step expansion is an honest data-space encoding of a Syncfusion gap, spec-pinned edge cases, uniform width.

Findings:

- **Minor — template exclusion chain** now five `!==` clauses (`flex-chart.component.html:224`; same for scatter at `:290`). The adapter already knows which types have bespoke series — a `BESPOKE_SERIES_TYPES` set consulted once would localise it. Pre-existing pattern (TB added the fifth clause); carry to the promotion task.
- **Minor — dead wiring survives the pivot**: `convertIntervalIndicators` `triggerBands` field + `case StIndicator.ST_TRIGGER_BANDS` in `injectCallableIndicatorData` (`indicator-converters.ts:104-123,176-177`) is unreachable — opt-in data only ever flows through `injectTriggerBandsData`. Delete at promotion or mark explicitly.
- **Minor — sandbox `config` computed** duplicates the enable-guard predicate (`:213-216` vs `:355-358`) and carries two near-identical `addChartExtras` branches (`:253-267`); a `tbRequested` computed + interval-keyed extras would halve it.
- **Minor — opt-in is payload-only**: the backend always computes TB series+dots for D/W/M; `filterResponse` trims. Cheap today; worth a comment so nobody assumes compute is gated.
- **Nit — missing `console.warn`**: unmatched points are silently dropped in `computeTriggerBandLines` (`st-trigger-bands.indicator.ts:120`) where sibling paths warn.
- **Nit — `IndicatorConfig` bespoke payloads** (`data`/`bandData`/`triggerBandData`) don't scale; a `customSeriesData` slot before the fourth.
- **Nit — `dev?: boolean`** is terse vs the config's descriptive vocabulary; `enableDevIndicators` reads better.

## Findings

| # | Severity | Finding | Disposition |
|---|---|---|---|
| 1 | Minor | Dot `signalType` wire literals duplicated BE↔FE (Standards §2) | Advisory — shared union/const in `@flex-chart/indicator-visuals` before promotion |
| 2 | Minor | Dead `signals.triggerBands` contract slot (BE + FE mirror) | Advisory — delete at promotion |
| 3 | Minor | `as never` / `as unknown as Event` in new sandbox spec | Advisory — typed fixture cleanup |
| 4 | Minor | Adapter/sandbox/computation files already >400 lines | Pre-existing; flagging per §1 |
| 5 | Minor | Template exclusion chain (5 clauses) for bespoke types | Advisory — `BESPOKE_SERIES_TYPES` at promotion |
| 6 | Minor | Dead TB branch in `injectCallableIndicatorData`/`convertIntervalIndicators` | Advisory — delete or mark for promotion |
| 7 | Minor | Duplicated enable-guard + twin extras branches in sandbox `config` | Advisory — simplify at promotion |
| 8 | Minor | Backend always computes TB (opt-in trims payload only) | Advisory — comment the contract |
| 9 | Minor | Neutral `#ffffff` has no `colorRemap` — invisible on light theme | **Must fix before prod promotion** (dev-gated, dark-only today) |
| 10 | Nit | `StrategyFamily.TRIGGER_BANDS` sentinel encodes "no strategies" | Advisory — pre-existing shape |
| 11 | Nit | Naming: `TriggerBandsPoint` vs `TriggerBandPoint`; `triggerBandsDots` boolean vs array | Advisory |
| 12 | Nit | Missing `console.warn` on dropped points; redundant `as number` cast | Advisory |
| 13 | Nit | `dev?: boolean` flag name | Advisory |
| 14 | Info | AC "one toggle" superseded by user-directed dots sub-toggle (default off) | Documented on #880 |
| 15 | Info | No `IndicatorSeriesStore` keying spec; mechanism verified by trace | Advisory — add at promotion or fold into QA |
| 16 | Info (unrelated) | `shared/screenshot-capture-contracts.spec.ts` fails: `PositionType` enum extended by the options thread (uncommitted `shared/screenshot-capture-contracts.ts`) while the spec asserting stock-only is untouched | Not this task's diff — flag to the options/screenshot thread |

In-loop fix: stale `ST_TRIGGER_BANDS_WIDTHS` / "Widths 1.5 / 2 / 3" reference corrected to `ST_TRIGGER_BANDS_LINE_WIDTH` in the FE IMPL doc, and the dots sub-toggle documented.

## Test results

- Full jest suite (`npx jest`): **203/204 suites, 3195/3196 tests** — the single failure is `shared/screenshot-capture-contracts.spec.ts` (`PositionType` stock-only assertion), caused by an uncommitted enum extension from the options thread; spec file untouched by this work. Not a #880 blocker.
- Scoped jest suites (trigger-bands indicator, adapter, flex-chart component, sandbox, converters, base-indicators): all pass, including the 4 new dev-gate specs and 5 sandbox wiring specs (earlier count 111/111 across the six related suites; re-verified inside the full run).
- Backend `tsx --test`: **35/35** engine + **14/14** series/filter.
- `functions` build clean; app `tsc` shows only the two pre-existing unrelated errors (`bulk-swing-sweep.ts`, `indicator-config-dialog.component.ts`).
- `git diff --check` clean on the scoped files.
- Not run here: live render check — deliberately deferred; user has already eyeballed the sandbox and approved the current rendering.
