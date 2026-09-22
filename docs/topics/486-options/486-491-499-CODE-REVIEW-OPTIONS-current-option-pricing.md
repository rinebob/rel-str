# Code Review — #499 Chain store data pipeline

**Topic:** Current option pricing  
**Topic Slug:** current-option-pricing  
**Thread:** Today's option pricing view  
**Thread Slug:** today-option-pricing-view  
**Issue:** #491  
**Thread Parent:** #487  
**Topic Parent:** #486  
**Task:** #499  
**Domain:** OPTIONS  
**Type:** CODE-REVIEW  
**Status:** Complete  
**Created:** 2026-09-22  
**Last Updated:** 2026-09-22  

**Verdict: PASS** — all 14 task tests green, `tsc -p tsconfig.app.json`
clean, full jest suite green (119 suites / 1624 tests). Findings were
remediated during review (see below).

Scope: `option-chain.store.ts` + `option-chain.store.spec.ts` (new).

## Standards

- **`{} as never` fixture (hard violation, guidelines §10)** — replaced
  with a real `HistoricalOptionsAnalysisSummary` in the spec.
- **Duplicated reset patches (3×)** — extracted `resetChainState()`
  shared by `setSymbol`/`setDateInput`/`loadChain`; the drift it fixes
  (missing `underlyingLoading`/`underlyingBars` clears) was the source of
  the next finding.
- **Spec TestBed boilerplate (3 copies)** — consolidated into `setup()`
  with a `chain$`/`chainFor`/`bars` override seam.
- Contract conformance verified: `res.data.data` unwrap matches
  `GetHistoricalOptionsChainResponse`; compact `OhlcBar` `d`/`c` fields
  read correctly; nested-subscribe shape matches sibling store
  conventions (`options-contract-viewer.store.ts`).

## Spec

All acceptance criteria met after remediation:

- **Stale `underlyingLoading`/`underlyingBars` on cancellation** —
  `loadChain`'s reset didn't clear them and `setSymbol` skipped
  `underlyingLoading`; a cancelled bars fetch could leave the flag stuck
  `true` forever. Fixed via `resetChainState()` (clears all loaded
  slices) plus `underlyingLoading: false` everywhere.
- **Guard paths didn't cancel in-flight work** — `Symbol is required` /
  invalid-date returns left a live subscription that could overwrite the
  error. `cancelInFlight()` now runs before validation.
- **Prior-session fetch error overwrote global `error`** — a failed
  comparison fetch would nuke a successfully loaded session. New
  `priorError` slice keeps them separate (session stays clean; the grid
  can degrade chg to n/a). Test added.
- **US-2 "Today" semantics** — `dateInput` is now pinned to the resolved
  date on auto-resolve so the date control displays the session on
  screen. Test added.
- **`priorClose` robustness** — derived via a shared `sessionBars`
  computed (bars ≤ resolvedDate, sorted); prior close = the bar before
  the session bar, so a missing bar on `resolvedDate` can't slide the
  pair two sessions back.

## Thermo-nuclear

Post-remediation: nested subscribes judged honest (per-stage error
semantics; `switchMap`/`merge` would conflate them); supersede +
cancellation verified by test; 14-bar computed sort is proportionate.
The session-error message records `startDate` (first candidate), not the
actual failed walk date — noted as a known imprecision, acceptable.

## Test results

- `option-chain.store.spec.ts`: 14/14 pass
- Full suite: 119 suites / 1624 tests pass
- `tsc -p tsconfig.app.json --noEmit`: clean
