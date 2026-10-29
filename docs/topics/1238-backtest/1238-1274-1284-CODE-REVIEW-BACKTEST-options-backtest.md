**Topic:** Options Backtest  
**Topic Slug:** options-backtest  
**Thread:** Selection Replay  
**Thread Slug:** selection-replay  
**Issue:** #1242  
**Thread Parent:** #1240  
**Topic Parent:** #1238  
**Task:** #1284  
**Domain:** BACKTEST  
**Type:** CODE-REVIEW  
**Status:** Complete  
**Created:** 2026-10-28  
**Last Updated:** 2026-10-28  

# Code Review — Task #1284 (Run dialog entry + template picker)

## Verdict: PASS

Three axes against the converged working tree. No convergence findings.

## Standards

- Separate "New Replay" button + dedicated dialog — the sim dialog is
  untouched, matching the issue's stated preference.
- Dialog mirrors the sim dialog's shape (ReactiveForms `FormGroup`,
  `mat-dialog` structure, `dialogRef.close(request|undefined)`) minus
  the dynamic config schema the replay doesn't need.
- `OptionsReplayRunsService.startReplay` is a verbatim
  `httpsCallable` + `runInInjectionContext` mirror of
  `BacktestRunService.startRun`; `OptionsReplayStore.startReplay`
  mirrors `startRun` (isLoading patch, snackBar on failure, select-on-
  success).
- Shared `REPLAY_TEMPLATES` imported directly — no listing callable,
  per the registry's design comment.
- `marketDateValidator` is a small FE-side mirror of the callable's
  `isValidMarketDate` (functions-side, not shared) — the callable
  re-validates; FE validation is UX, not the trust boundary.

## Spec (issue #1284 ACs)

| AC | Result |
|---|---|
| Dropdown lists registry entries (name + description), emits `templateId` | **PASS** — `mat-select` bound to `REPLAY_TEMPLATES`, two-line options; spec asserts name+description per option and `templateId` in payload |
| Submit produces correct `OptionsReplayStartRequest` | **PASS** — spec asserts exact payload `{templateId, symbols, startDate}` with parse/normalize |
| Navigates to run detail on success | **PASS** — `startReplay` selects the returned runId → detail panel + lists stream (same effect as `selectRun`) |
| Tests per TEST-FE | **PASS** — template binding, payload shape, date validation, empty-symbols guard, start→select navigation, failure path |

## Thermo-Nuclear

- **Documented deviation (accepted):** symbols is free-text
  (comma/space-separated, sim convention) rather than a bounded
  multi-select — `SymbolListStore.trackedSymbols` would wrongly
  constrain input when SA pick docs can cover any symbol. Recorded
  in IMPL-FE as-built.
- **Input-boundary check traced:** duplicate symbols → `start.ts`
  dedupes; future date → `tradingDays: []` → failed list doc with a
  clear error on the symbol card; empty registry → `required` fails →
  disabled submit. Every bad input either re-validates or fails
  visibly — no silent hole.
- **No double-submit window** — dialog `close()` is synchronous.
- Deliberately not done: `max` attr on the date input (gates the
  picker only, typed input bypasses — the failure path is honest);
  FE-side symbol dedupe (BE owns normalization).

## Convergence log

- Implement pass 1: dialog + service/store wiring + dashboard button,
  one jest-vs-jasmine `expect` fix, 53/53 suite green.
- Implement pass 2: input-boundary + lifecycle re-read, zero changes.
- Review pass 2: found a UX wart — the `mat-option`'s two-line
  name+description div projects into the closed `mat-select` trigger,
  mashing description text into the trigger line. Fixed with
  `mat-select-trigger` (name only in trigger; description stays in the
  panel). 7/7 dialog specs re-verified.

## Test state at review

- `npx jest options-replay` — 53/53 (7 dialog + 2 new store specs)
- `tsc --noEmit -p tsconfig.app.json` — clean
- `ng build` — clean at #1283 gate; dashboard delta is additive wiring
- Deployed backend: `optionsReplayStart` + `optionsReplayPermutation`
  live in GCP (user deploy) — end-to-end run possible at QA/ship.
