# CODE-REVIEW — #1285 Contract-list table + contract-series dialog (FE)

**Topic:** Options Backtest  
**Topic Slug:** backtest  
**Thread:** Selection Replay  
**Thread Slug:** selection-replay  
**Issue:** —  
**Thread Parent:** #1240  
**Topic Parent:** #1238  
**Task:** #1285  
**Domain:** BACKTEST  
**Type:** CODE-REVIEW  
**Status:** Complete  
**Created:** 2026-10-29  
**Last Updated:** 2026-10-29  

**Verdict:** PASS

## Scope reviewed

New: `options-replay-contract-list-table/` (4 files), `options-replay-contract-series-dialog/` (4 files).
Modified: `options-replay-run-detail` (ts/html/scss/spec), IMPL-FE as-built bullet.
Diff verified — only #1285 hunks; foreign working tree untouched.

## Standards axis — PASS

- Table is pure presentational over `ContractListRow[]` — inputs in, `inspect` output out; parent owns the dialog. Matches the codebase-design seam (pure render, fully fixture-testable).
- Dialog follows the #1284 dialog conventions: standalone + OnPush, `MAT_DIALOG_DATA` injection, Material dialog modules in its own `imports`.
- Fetch seam is `OptionsContractService.getHistoricalOptionsContract$` — injectable, stubbed in specs per TEST-FE; `takeUntilDestroyed()` in the constructor covers teardown.
- SVG mark line reuses the `contract-mini-chart` visual idiom (viewBox, min/mid/max ticks deduped by label, tick guides, date footer) — no charting lib, as planned.
- `iv | percent` display matches the codebase's `iv * 100` fraction convention (verified against SA's `parseStrict(implied_volatility)` write path — verbatim fraction).
- `side` mapped `TradeSide.SHORT→STO` / `LONG→BTO`; reason labels map `miss/gap/out-of-range` → `no match / data gap / out of range` with raw-value fallback for unknown reasons.

## Spec axis — all 7 ACs PASS

| AC | Evidence |
|---|---|
| Pick rows render all columns; marker rows explicit | 13-column table; marker row = entry cell + colspan=12 muted reason row, never omitted |
| Repeat contractIds labeled, each its own row | `↻ repeat` badge on `repeatsPrevious`; rows remain distinct |
| Coverage header: pick/miss counts, range, gridVersion | one `pickDocMeta` line — `8 picks · 2 misses · first→last · grid v3` |
| Row action opens dialog, fetches exactly that contractId | `inspect` → `openSeriesDialog` → `getHistoricalOptionsContract$(symbol, contractId)` — spec asserts exact args |
| Loading → line → error/empty; error names contractId | 4-state switch; error text contains contractId + message |
| No contract data persisted | fetch is read-only; nothing written client-side |
| Tests per TEST-FE | +16 specs (8 table, 6 dialog, 2 run-detail wiring) |

## Thermo-nuclear axis — zero unresolved findings

- **Found & fixed during implement:** `MatDialogModule` in the run-detail's `imports` re-provided `MatDialog` at the element injector, shadowing the TestBed stub (real dialog opened → `Functions` unprovided). Removed — the host only injects the service (`providedIn: 'root'`); the dialog component keeps the module for its own directives.
- Marker colspan verified against the 13-column header.
- Sort is non-mutating (`[...rows].sort`); `track entryDate` safe (one row/day).
- Filtered-out observations (blank date / unparseable mark) can't produce a broken chart — all-dropped → `empty` state.
- Single-observation series renders a dot via `singleDotY` (scaled, not hardcoded).
- Collapsed-by-default per-symbol toggle avoids hundreds-of-rows DOM across multi-symbol runs; expansion state survives run-switch harmlessly.

## Convergence log

- Implement pass 1: table + dialog + run-detail wiring; 2 fixes caught by tests (spec re-export import, MatDialogModule shadowing). 69/69 green.
- Implement pass 2 (re-read): IV-scale verification + boundary re-check — zero changes.
- Review pass 1: this document — PASS, no findings requiring remediation.

## Evidence

`npx jest options-replay` → 69/69 across 9 suites · `tsc --noEmit -p tsconfig.app.json` clean.
