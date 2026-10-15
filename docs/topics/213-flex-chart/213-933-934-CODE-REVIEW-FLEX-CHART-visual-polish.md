**Topic:** Flex Chart Visual Polish  
**Topic Slug:** visual-polish  
**Thread:** Dev Flex Chart - enable save settings for dev use  
**Thread Slug:** dev-save-settings  
**Issue:** #933  
**Thread Parent:** #908  
**Topic Parent:** #213  
**Task:** #934  
**Domain:** FLEX-CHART  
**Type:** CODE-REVIEW  
**Status:** Draft  
**Created:** 2026-10-09  
**Last Updated:** 2026-10-09  

# Code Review — FE: Persist sandbox settings to localStorage (restore, auto-save, reset)

## Scope under review

Uncommitted working-tree changes for task #934:

- `src/app/features/savant-trader/pages/flex-chart-sandbox/sandbox-settings.ts` (new)
- `src/app/features/savant-trader/pages/flex-chart-sandbox/sandbox-settings.spec.ts` (new)
- `src/app/features/savant-trader/pages/flex-chart-sandbox/flex-chart-sandbox.component.{ts,html,spec.ts}` (persistence portions only)
- `src/app/features/shared/components/flex-chart/services/chart-data-adapter.service.ts` (one-line type widening — pre-existing build break, see below)

Out of scope but visible in the same diffs: the user's in-flight Trigger Bands
prod-promotion refactor (`bindTriggerBandsRequest`, `callableOnlyOptionIds`,
`injectTriggerBandsData` signature) — not reviewed here.

## Standards

Two documented-standard violations and several smells were found; all were
fixed during the review:

| Finding | Severity | Resolution |
|---|---|---|
| `type DataMode` redeclared in the component while `SandboxDataMode` was exported unused (canonical-types-once + dead export) | major→minor | Fixed — component now uses `SandboxDataMode` |
| `as unknown as` casts in `sandbox-settings.spec.ts` (fabricating malformed blobs) | minor | Fixed — specs build untyped literals instead |
| `'weekly'` literal instead of `ChartIntervalKey` enum | minor | Fixed |
| Auto-save effect re-enumerated the `SandboxSettings` field list (data clump) | minor | Fixed — extracted `settingsSnapshot()` |
| Commit/load validation asymmetry: `onAvwapParam` didn't clamp to `min`/`max`; only the load sanitizer did | minor | Fixed — number commits clamp on commit |
| Symbol restored un-normalized (`'  msft '` would reach `loadCharts`) | minor | Fixed — load trims + uppercases |
| `clearSandboxSettings()` in `resetSettings()` looked near-dead | nit | Comment clarified (destroy-before-flush window) |
| Stale spec header citing task #477 | nit | Fixed |
| Duplicate `flex-chart.types` import | nit | Fixed |
| Component file size (~500 lines, mostly predates this change) | context | Persistence logic correctly extracted to `sandbox-settings.ts`; noted, no action |

## Spec

US-1 (restore), US-3 (reset), US-4 (prod isolation), US-5 (tolerant merge)
verified against the code path; US-2 is deferred to #935 by design.

| Finding | Severity | Resolution |
|---|---|---|
| TEST-doc target uncovered: generic override path proven only for AVWAP | minor | Fixed — new test seeds a ZigZag override and asserts `config().params` |
| TEST-doc target uncovered: component render when `localStorage` throws | minor | Fixed — new test mocks `getItem`/`setItem` throwing |
| Restore test didn't assert `dataMode`/`preset` | minor | Fixed — seeds and asserts `synthetic`/`penny` |
| Module-spec edge gaps: non-array `enabledIndicators`, non-record `paramOverrides`, blank symbol, `options[]` membership branch | minor | Fixed — all four added |
| `readSandboxSettings` not in the IMPL API sketch | nit | Trivial convenience over `load` + storage guard; kept |
| IMPL says "coerce numbers" but implementation drops them | nit | IMPL wording drift; TEST doc's "wrong-type → dropped" is the intended semantics |

## Thermo-nuclear

Verdict from the axis: **no critical or major findings** — module is
appropriately deep; the fix list was tightening, not restructuring.
Dev/prod isolation verified structurally: the storage key is referenced only
by sandbox files, and unknown persisted ids are dropped on load, so a removed
dev indicator can never smuggle past the `dev: true` gate.

Remaining accepted nits (deferred, non-blocking):

- `buildDefaultConfig` bakes param defaults into `options.name`; overridden
  params don't retitle the legend. Predates #934; noted for #935's editor work.
- `DEFAULT_SANDBOX_SYMBOL`/`DEFAULT_SANDBOX_INDICATORS` exported but consumed
  only inside the module + specs — kept deliberately (spec asserts literals).

## Pre-existing build break fixed in passing

`flex-chart.component.html` calls `bespokeMainPaneTypes.has(config.type)` where
the set was `ReadonlySet<StIndicator>` and `config.type` is `IndicatorType` —
a type error from the in-flight TB refactor, unrelated to #934 but blocking
`ng build`. Widened the declared type at
`chart-data-adapter.service.ts:27` — semantics identical.

## Test results

- `npx jest src/app/features/savant-trader/pages/flex-chart-sandbox` — **73/73 pass**
- `npx jest src/app/features/shared/components/flex-chart` — **297/297 pass**
- `npx ng build` — **green**
- Full suite `npx jest` — 3308/3351 pass. The 43 failures sit in two suites
  **unrelated to this task's surface** (pre-existing breakage from other
  in-flight work):
  - `signal-order/order.component.spec.ts` — `NG0201: No provider found for
    Functions` (`OrderExecutionService → ScreenshotService`; needs a Firebase
    Functions stub — screenshot-capture WIP).
  - `shared/screenshot-capture-contracts.spec.ts` — `PositionType` gained
    option values (`vertical-debit-spread`, `calendar`, `option-single`);
    spec still asserts stock-only.

## Verdict

**PASS** — no critical or major findings; all review findings were fixed or
accepted as nits during the review. The unrelated suite failures are recorded
here for the QA issue's awareness, not as task findings.
