# UAT — #1284 Run dialog entry + template picker (FE)

**Topic:** Options Backtest  
**Topic Slug:** backtest  
**Thread:** Selection Replay  
**Thread Slug:** selection-replay  
**Issue:** #1324  
**Thread Parent:** #1240  
**Topic Parent:** #1238  
**Task:** #1284  
**Domain:** BACKTEST  
**Type:** UAT  
**Status:** Complete  
**Created:** 2026-10-29  
**Last Updated:** 2026-10-29  

**Verdict:** PASS

## Evidence

| # | Scenario | Method | Result |
|---|---|---|---|
| 1 | "New Replay" button opens dedicated dialog (sim dialog untouched) | `backtest-dashboard.component.ts` — `openNewReplayDialog()` → `dialog.open(OptionsReplayNewRunDialogComponent)` | PASS |
| 2 | Template dropdown bound to `REPLAY_TEMPLATES` | spec: `binds the template dropdown to REPLAY_TEMPLATES` | PASS |
| 3 | Each option renders name + description | spec: `renders each template with name + description` | PASS |
| 4 | Closed trigger shows name only (no description mash) | review-pass-2 fix: `mat-select-trigger` renders `selectedTemplateName()` | PASS |
| 5 | Submit emits correct `OptionsReplayStartRequest` payload | spec: `submit emits the correct OptionsReplayStartRequest payload` | PASS |
| 6 | Symbols parse: comma/space-separated → uppercased array | `parseSymbols` + spec 5 payload assertion | PASS |
| 7 | Impossible date `2026-02-30` rejected | spec: `rejects an impossible date (2026-02-30)` — `marketDateValidator` | PASS |
| 8 | Malformed date string rejected | spec: `rejects a malformed date string` | PASS |
| 9 | Empty/whitespace-only symbols do not close | spec: `does not close when symbols parse to nothing` | PASS |
| 10 | Cancel closes with `undefined` → no callable | spec: `cancel closes with undefined` | PASS |
| 11 | Success path calls `optionsReplayStart` + `selectRun(runId)` → detail panel opens | store spec: `startReplay` success → service mock + selectRun assertion | PASS |
| 12 | Failure path → snackBar, no selection change | store spec: `startReplay` error → snackBar + selectedRunId unchanged | PASS |
| 13 | Callable name + request shape match #1281 contract | `httpsCallable<OptionsReplayStartRequest, OptionsReplayStartResponse>(fns, 'optionsReplayStart')` | PASS |
| 14 | No double-submit window | dialog `close()` synchronous on `submit()` | PASS |
| 15 | Sim section untouched | dashboard diff — additive only (verified at review gate) | PASS |
| 16 | Empty `REPLAY_TEMPLATES` registry → submit disabled | `REPLAY_TEMPLATES[0]?.id ?? ''` + `required` validator | PASS (code trace) |

## Suite evidence

`npx jest options-replay` → **53/53** across 7 suites (converter 5, run-list 7,
run-detail 4, dialog 7, store 8, shared templates, shared contracts).
NG0914 zoneless/Zone.js warnings are existing test-env noise.

## Traceability

| AC | Scenario(s) |
|---|---|
| Separate button/dialog; template dropdown bound to `REPLAY_TEMPLATES`; name + description | 1–4 |
| Symbols input → parse; startDate `YYYY-MM-DD` | 5–9 |
| Submit `optionsReplayStart`; success → select/open run + list-doc streaming | 11–13 |
| Existing sim dialog untouched | 15 |

## Residuals

- No live-data run verified yet — `optionsReplayStart` + `optionsReplayPermutation`
  are deployed; first real end-to-end run is a manual UAT on the deployed app.
- Duplicate symbols pass through; BE dedupes server-side (verified #1281).
- Future `startDate` accepted by UI; worker produces a visible `failed` list doc
  ("No symbol-data daily bars") rather than silent wrong data — by design.
