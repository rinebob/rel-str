**Topic:** On-demand Screenshot Capture  
**Topic Slug:** screenshot-capture  
**Thread:** Auto-Capture  
**Thread Slug:** auto-capture  
**Issue:** #763  
**Thread Parent:** #747  
**Topic Parent:** #746  
**Task:** #765  
**Domain:** SCREENSHOT  
**Type:** CODE-REVIEW  
**Status:** Approved  
**Created:** 2026-10-03  
**Last Updated:** 2026-10-03  

# Code Review — #765 Contracts: screenshot-capture spec + result types

## Scope reviewed

- `shared/screenshot-capture-contracts.ts` (new)
- `shared/screenshot-capture-utils.ts` (new)
- `shared/screenshot-capture-contracts.spec.ts` + `shared/screenshot-capture-utils.spec.ts` (new)
- `tsconfig.json`, `functions/tsconfig.json`, `jest.config.js` — `@screenshot-capture/{contracts,utils}` alias wiring
- `functions/src/st-cloud-function/indicator-computation.ts` + `src/app/features/savant-trader/common/indicator.types.ts` — `ChartInterval` unified to the shared canonical enum via re-export

## Standards axis

0 critical · 0 major · 3 minor · ~4 nits. Alias wiring matches the `@*/contracts` convention exactly; `storage.rules` fallback already grants authenticated read on `st-trade-screenshots/**` (backend writes bypass rules — no rules change needed).

Findings and dispositions:

- **minor** — `intervals?: CaptureInterval[]` rejected the `readonly` default → **fixed** (`readonly CaptureInterval[]`).
- **minor** — `CaptureInterval` was yet another interval-enum copy (documented §2 drift) → **fixed** by unifying `ChartInterval` in `shared/` and converting both existing declarations to re-exports.
- **minor** — `CaptureEvent` members have no emitter yet → **kept**; PRD-defined wire contract, values stabilize now so the follow-on Thread doesn't break callers.
- nits — symbol not path-sanitized → **fixed** (alnum+dot sanitize); `pngPath!` in spec → **fixed** (removed).

## Spec axis

Issue #765 requirements: spec fields MET, `{svg, paths}` result MET (superset with `artifacts` — required for per-interval D+W display), `CaptureEvent` four values MET, `positionType` stock-only MET, `visibleBars` number-or-`'all'` MET, dual-context compile MET.

- **UNMET → fixed** — PRD/IMPL specified `intervals?: ChartInterval[]`; initial `CaptureInterval` enum used uppercase wire values incompatible with the existing `ChartInterval` (`'daily'|'weekly'|'monthly'`). `ChartInterval` is now canonical in `shared/`; `CaptureInterval` is the `DAILY | WEEKLY` subset type, enforcing the monthly exclusion at the type level.
- Stale doc fixed — TEST doc said "deterministic overwrite" for same-day re-capture; corrected to never-overwrite via `HHmmss`. IMPL contract block updated to the implemented shape.

## Thermo-nuclear axis

Approval bar initially NOT met; two majors, both remediated:

- **major → fixed** — `CaptureChartResult` denormalization: `svg`/`paths` were independently settable duplicates of `artifacts` data. Now documented as derived conveniences and produced only via `buildCaptureChartResult(artifacts)`; spec asserts the invariant including the empty-artifacts edge.
- **major → fixed** — path-builder logic inside a contracts file violated the `*-contracts` (shapes) vs `*-ids`/`*-utils` (builders) layering precedent. Moved to `shared/screenshot-capture-utils.ts` under `@screenshot-capture/utils`.
- **minor → fixed** — mutable `intervals` array (see Standards).
- **minor → fixed** — tautological shape assertions replaced with the readonly-assignability regression test and result-builder invariant tests.
- Considered and rejected: three unemitted `CaptureEvent` values and single-value `PositionType` are defensible wire-contract stabilization; `VISIBLE_BARS_ALL` is a fair sentinel.

## Test results

- `npx jest` full suite: **174 suites / 2529 tests — all PASS** (includes both new spec files, 17 tests).
- `cd functions && npx tsc --noEmit`: clean.
- Live checks: `@screenshot-capture/{contracts,utils}` aliases resolve under `tsx` in the functions context; `ChartInterval` re-exported from `indicator-computation.ts` is reference-identical to the shared enum.
- Caveat: full `ng build` not run (heavy); jest's type-check + tsc + alias smoke cover the changed surface.

## Round 2 (2026-10-03) — verification pass on remediated code

Second full pass over the post-fix state. All round-1 fixes verified landed (ChartInterval canonical + re-exports, utils split, `buildCaptureChartResult` derivation, readonly `intervals`). New findings, all addressed:

- **minor (fixed)** — `sanitizeSegment` doc still described symbol use after the refactor split it to refId-only; comment corrected.
- **minor (fixed)** — empty-symbol edge emitted `st-trade-screenshots//...` — `buildScreenshotStoragePath` now throws when the symbol sanitizes to nothing; spec case added.
- **minor (fixed)** — `CaptureInterval` imported as a value binding in utils — moved to `type` import.
- **nit (fixed)** — duplicated `[^a-zA-Z0-9.]` regex literal hoisted to `PATH_SAFE_PATTERN`; spec gaps filled (≤6-char refId passthrough, dotted refId, empty-symbol throw).
- **nit (documented)** — `ChartIntervalKey` in `flex-chart.types.ts` is a pre-existing UI-layer enum with identical wire values; contracts comment now names it as a known residual duplicate. Merging it is a separate refactor, not #765 scope.
- **nit (fixed)** — doc drift: IMPL Storage section attributed the path builder to the contracts file, module layout omitted `screenshot-capture-utils.ts`, PRD still said `intervals: ChartInterval[]` and `screenshots/` prefix — all corrected.

Axes: Standards CLEAN · Spec all-MET · Thermo-nuclear **approval bar met**.

## Test results

- `npx jest` full suite, post-remediation: **176 suites / 2545 tests — all PASS**.
- `cd functions && npx tsc --noEmit`: clean.
- Alias + re-export chain verified live via `tsx` in the functions context.
- Caveat: full `ng build` not run (heavy); jest type-check + tsc + tsx smoke cover the changed surface.

## Verdict

**PASS** — two review rounds; all majors and actionable minors remediated with regression tests. Remaining items are documented judgement calls (unemitted `CaptureEvent` values as wire-contract stabilization; `ChartIntervalKey` residual duplicate tracked for a separate refactor).

## Next

`/proj qa 746 765`
