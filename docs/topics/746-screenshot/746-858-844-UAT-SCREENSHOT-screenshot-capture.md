**Topic:** On-demand Screenshot Capture  
**Topic Slug:** screenshot-capture  
**Thread:** Screenshot Auto-capture with Orders  
**Thread Slug:** order-lifecycle-capture  
**Issue:** #858  
**Thread Parent:** #826  
**Topic Parent:** #746  
**Task:** #844  
**Domain:** SCREENSHOT (BE-SH)  
**Type:** UAT  
**Status:** Complete  
**Created:** 2026-10-07  
**Last Updated:** 2026-10-07  

# UAT — #844 Contracts: groupId + PositionType tags + grouped path

## Scope

Adds `groupId` to `CaptureChartSpec` (campaign-level directory level in the
storage path) and strategy `PositionType` tags (`vertical-debit-spread`,
`calendar`, `option-single`) for the order-lifecycle capture thread. Pure
contract/path-surface change — no UI, no new runtime surface beyond the
existing callable's request shape.

## Prerequisites

- Repo at `C:\aa\projects\rel-str`, Node 22+, `functions/` deps installed.
- ADC for the real-bucket scenario: `gcloud auth application-default login`
  (or `GOOGLE_APPLICATION_CREDENTIALS`), project `rel-str`.

## Start instructions

All commands run from the repo root unless noted. Unit specs run through the
root jest; the verify script runs from `functions/` via `npx tsx`.

## Scenarios

1. **Grouped storage path (real bucket).**
   - Steps: `cd functions && npx tsx scripts/verify/screenshot-capture-844-contracts.ts GOOG`
   - Expected: all `✔` — grouped capture writes
     `st-trade-screenshots/GOOG/verify-cohort-844/…-order-filled-option-single-leg1-daily.{svg,png}`,
     the object exists and round-trips, the `{symbol}/{groupId}/` prefix
     lists it, all four `positionType` values parse, non-string `groupId`
     → `invalid-argument`.
   - Cleanup: none needed — fixed timestamp overwrites the same objects.

2. **Backward compatibility — flat path when no groupId.**
   - Steps: `npx jest shared/screenshot-capture-utils.spec.ts --coverage=false`
   - Expected: green — existing path-shape tests unchanged; new cases prove
     `groupId` adds a dir, sanitizes (hyphens/dots kept), and omits the dir
     when the segment has no alphanumeric (`///`, `..`, `-.-`, `''`).

3. **Callable surface — parse + handler.**
   - Steps: `npx jest tests/functions/screenshot-capture/capture-chart.spec.ts --coverage=false`
   - Expected: green — strategy `positionType` accepted; unknown value
     rejected; `groupId` echoes on the spec and nests artifact paths;
     non-string `groupId` → `invalid-argument`.

4. **Consumer regression — dev screenshot page.**
   - Steps: `npx jest src/app/features/dev-screenshot --coverage=false`
   - Expected: green — enum/field additions don't break existing callers.

5. **Type surfaces.**
   - Steps: `cd functions && npm run build` and repo-root `npx tsc -p tsconfig.spec.json --noEmit`
   - Expected: clean.

## Traceability

| Criterion | Scenario |
|---|---|
| `groupId` on spec → `{symbol}/{groupId}/` level | 1, 3 |
| PositionType strategy tags accepted | 1, 3 |
| Missing/degenerate groupId → flat path (no `..` dir) | 2, 3 |
| No regression for existing callers | 1, 2, 4, 5 |

## Regression / smoke

- `st-trade-screenshots/` prefix and existing filename shape unchanged when
  `groupId` absent (scenario 2).
- `renderOnly` default (true) unchanged — playground calls still write
  nothing (capture-chart spec).

## Results

| # | Scenario | Result | Evidence |
|---|---|---|---|
| 1 | Grouped path, real bucket | PASS | 12/12 checks ✔; `gs://rel-str.appspot.com/st-trade-screenshots/GOOG/verify-cohort-844/` objects exist |
| 2 | Path-builder spec | PASS | green incl. new groupId cases |
| 3 | Callable parse/handler spec | PASS | 4 positionType values accepted; grouped write path asserted; invalid groupId rejected |
| 4 | dev-screenshot specs | PASS | green — no contract breakage |
| 5 | functions build + FE tsc | PASS | clean |
