**Topic:** Option chain percent change grid  
**Topic Slug:** option-chain-pct-change-grid  
**Thread:** Contract chart popup  
**Thread Slug:** contract-chart-popup  
**Issue:** #403  
**Thread Parent:** #400  
**Topic Parent:** #326  
**Task:** #406  
**Domain:** OPTIONS  
**Type:** Code Review  
**Status:** Complete  
**Created:** 2026-09-18  
**Last Updated:** 2026-09-18  

---

# Code Review — Task #406: Add contract selection state to store

## Verdict: PASS (after fixes)

## Scope reviewed

- `src/app/features/savant-trader/pages/option-chain-pct-change/option-chain-pct-change.store.ts`
  — `SelectedContractCell`, `ContractCellRef`, `toSelectedCell`, `SELECTION_CLEARED`,
  `selectedCell`/`isContractPinned` state, `selectedContractSeries` computed,
  `previewContract`/`pinContract`/`clearContractSelection`, selection clearing
  across all snapshot/grid-invalidating methods
- `src/app/features/savant-trader/pages/option-chain-pct-change/option-chain-pct-change.store.spec.ts`
  — 19 contract-selection tests

## Standards axis

- **File size** — store is ~650 lines, past the 400-line guideline. Pre-existing;
  addition is ~90 lines. Noted; a config-CRUD extraction is a candidate
  follow-up, not blocking.
- **`setTimeout(50)` in the new async test** — follows the file's existing
  convention (~10 sites); `fakeAsync` is the documented preference. Accepted
  for consistency.
- **Duplicated clear-selection patch** — fixed via `SELECTION_CLEARED`
  constant spread into every invalidating `patchState`.
- **Duplicated cell literal** — fixed via `toSelectedCell` (explicit field
  pick; `{ ...cell }` would leak extra `PctChangeCell` fields into state —
  caught by a test).
- **Method signatures** — tightened from `PctChangeCell` to
  `ContractCellRef = Pick<..., 'contractID'|'strike'|'expiration'>`; a cell
  remains structurally assignable.

## Spec axis

All Task #406 acceptance criteria met:

- `selectedCell` holds contract identity + grid targetDate
- `isContractPinned` boolean
- `selectedContractSeries` → `ContractSeriesPoint[]` via `extractContractSeries`,
  spanning ALL snapshots (multi-target test added)
- `previewContract` transient; `pinContract` pinned; both no-op while pinned
  (PRD: "don't do anything until the existing pinned overlay is closed")
- `clearContractSelection` resets both
- Selection clears on snapshot invalidation (symbol, startDate, type,
  bulk targetDates, runAnalysis, selectConfig, reset)

Spec-silent additions (justified): strike+expiration in the stored identity
(required by extractContractSeries' economic-identity fallback); signature
takes `ContractCellRef` not bare `contractID` (same reason — the IMPL doc's
`(contractID, targetDate)` signature predates the #404 evolution; the #407
call site should pass the cell).

## Thermo-nuclear axis

Three majors, all fixed:

- **`removeTargetDate` dangling pin** — selection now clears when the
  removed date matches `selectedCell.targetDate`; kept otherwise.
- **`resolvePctChangeTargets` success** — replaces targetDates wholesale;
  now clears selection (same class as `setTargetDates`).
- **`runAnalysis` error paths** — canRun-fail and fetch-error patches now
  clear selection too (no zombie pin blocking previews with no data).

Minors noted/accepted:

- `state.type()` vs `filter().type` duplication — kept in sync by
  convention (`setType`, `selectConfig`); flagged as future-drift risk.
- `removeTargetDate` doesn't drop `targetSnapshots[dt]` — pre-existing
  leak, adjacent but out of scope.
- Discriminated-union selection model considered; `SELECTION_CLEARED`
  achieves the auditability goal at lower churn.
- File size noted (pre-existing, ~650 lines).

## Test results

- Pct-change suite: **225/225 pass** (+4 new tests: multi-target series,
  removeTargetDate clear/keep, runAnalysis-error zombie-pin).

## Findings summary

| Severity | Count | Status |
|---|---|---|
| Critical | 0 | — |
| Major | 3 | All fixed (removeTargetDate, resolvePctChangeTargets, error paths) |
| Minor | 4 | 2 fixed (signature, duplication), 2 documented |
| Nit | 2 | Documented |
