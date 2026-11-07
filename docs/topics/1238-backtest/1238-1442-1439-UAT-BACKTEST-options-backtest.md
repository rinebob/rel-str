**Topic:** Options Backtest  
**Topic Slug:** backtest  
**Thread:** Selection Replay  
**Thread Slug:** selection-replay  
**Issue:** #1442  
**Thread Parent:** #1240  
**Topic Parent:** #1238  
**Task:** #1439  
**Domain:** BACKTEST  
**Type:** UAT  
**Status:** Complete — 2026-11-06 — QA PASS (8/8 scenarios verified)  
**Created:** 2026-11-06  
**Last Updated:** 2026-11-06  

# UAT — #1439: Delete Selection Replay run (cascade run + list + results)

## Scope

A Selection Replay run can now be deleted. The `optionsReplayDelete`
callable cascade-deletes the run doc, its contract-list doc
(`docId == runId`), and every `st-options-analysis-results` doc whose
`contractListDocId == runId`, in one atomic batch — returning deletion
counts. The callable is auth-guarded (`request.auth?.uid →
unauthenticated`) and idempotent (missing docs count as deleted, never
errors). The run list exposes a trash icon on every row; the dashboard
confirms (dialog names the run), then the store deletes — the row
disappears via the realtime listener, and a selected run's detail panel
clears.

## Prerequisites

- `optionsReplayDelete` deployed — `firebase deploy --only functions`
  (done 2026-11-06; `optionsReplayDelete(us-central1)` exists).
- Dev server: `npm start` → `http://localhost:4200`, signed in.
- Admin SDK access for backend verification (script uses ADC).
- A disposable run to delete (the scripted path creates its own).

## Getting to the feature

Route: `/options/strategy/backtest` — nav: Savant Trader → Backtest.
The Selection Replay section's run list shows one row per run; the
**Actions** column holds a trash-can `delete` icon on every row (and a
`replay` rerun icon on failed rows). Click the trash icon → confirm
dialog → row disappears.

## Scenarios

### S1 — Unauthenticated call rejected *(backend — scripted)*

Feature: auth guard on the new callable.
Steps: POST the callable protocol `{"data":{"runId":"…"}}` to
`https://us-central1-rel-str.cloudfunctions.net/optionsReplayDelete`
with **no** `Authorization` header.
Expected: `{error: {status: "unauthenticated"}}`.
Result: **PASS** — `401 UNAUTHENTICATED` on the real deployed callable
(driver S1, 2026-11-06).

### S2 — Failed run deletes cleanly *(backend — scripted)*

Feature: the motivating case — a wrong-symbol failed run.
Steps: `optionsReplayStart {symbols:["ZZZZZ"], templateId:'csp-45-20',
startDate:'2026-01-01'}` → wait for run `failed` → authenticated
`optionsReplayDelete {runId}`.
Expected: response `{deletedRun:true, deletedLists:1, deletedResults:0}`;
run + list docs gone in Firestore.
Result: **PASS** — run `2026-11-06_fri_171034_manual_sokewk_ZZZZZ`;
response `{deletedRun:true, deletedLists:1, deletedResults:0}`; admin
reads confirmed run + list docs gone (driver S2, 2026-11-06).

### S3 — Completed run + analysis results cascade *(backend — scripted)*

Feature: full cascade including result docs.
Steps: `optionsReplayStart {symbols:["SPY"],…}` → wait `completed` →
`optionsAnalysisStart {contractListDocId}` → wait 6 result docs →
authenticated `optionsReplayDelete`.
Expected: `{deletedRun:true, deletedLists:1, deletedResults:6}`; run,
list, and all six `{runId}_{exitId}` docs gone.
Result: **PASS** — SPY run completed, `optionsAnalysisStart` accepted,
6 result docs written, then delete returned
`{deletedRun:true, deletedLists:1, deletedResults:6}`; admin reads
confirmed run, list, and all 6 result docs gone (driver S3,
2026-11-06).

### S4 — Idempotent re-delete *(backend — scripted)*

Feature: already-deleted / never-existed runId is a clean no-op.
Steps: call `optionsReplayDelete` a second time on S3's runId, plus once
on `qa-never-existed`.
Expected: `{deletedRun:false, deletedLists:0, deletedResults:0}` — no
error either time.
Result: **PASS** — re-delete of the SPY runId and `qa-never-existed`
both returned `{deletedRun:false, deletedLists:0, deletedResults:0}`
with no error (driver S4, 2026-11-06).

### S5 — UI: confirm → delete → row disappears *(user)*

Feature: the user-facing flow end-to-end.
Steps: dev server → Backtest → Selection Replay → trash icon on any row
→ confirm dialog.
Expected: dialog reads `Delete {SYMBOL} run {formatted runId}?` with
Back/Delete buttons; on Delete, a "Deleted run for {SYMBOL}" toast
appears and the row disappears **without refresh** (realtime listener).
Result: **PASS** — user-confirmed live, 2026-11-06.

### S6 — UI: deleting the selected run clears the detail panel *(user)*

Feature: no ghost detail card.
Steps: select a run row → detail card shows its contract list → trash
icon on that same row → confirm.
Expected: detail panel closes/empties (selection cleared), toast + row
gone.
Result: **PASS** — user-confirmed live, 2026-11-06.

### S7 — UI: cancel path *(user)*

Feature: confirm is not a formality — cancel aborts.
Steps: trash icon → dialog → **Back**.
Expected: dialog closes, run untouched, no toast.
Result: **PASS** — user-confirmed live, 2026-11-06.

### S8 — Refinement pass *(user)*

Checks: trash icon renders on every status (pending/running/success/
failed); button disabled while a delete is in flight; Actions column
header + failed badge + both icons lay out cleanly; dialog copy is
clear; no visual regression in the run list (`.symbol-* → .list-*`
classes unaffected).
Result: **PASS** — user-confirmed live, 2026-11-06.

## Traceability

| Task AC | Scenario |
|---|---|
| Callable deletes run + list + all result docs; returns counts | S2, S3 |
| Unauthenticated → `unauthenticated` | S1 (+unit test) |
| UI confirm → delete → row disappears without refresh | S5, S6, S7 |
| Unit tests: cascade counts, idempotent re-delete, auth guard | jest/tsx suites (review doc) |

## Regression / smoke checklist

- [x] Run-list retry button still works on failed rows (unchanged cell)
- [x] Portfolio "Cancel order" confirm dialog still works (shared
      `ConfirmDialogComponent` migration — portfolio-dashboard)
- [x] pct-change "Delete this saved configuration?" dialog shows
      Back→Cancel button label unchanged
- [x] Option-chart "load all contracts" confirm still works
- [x] Run detail card: Analyze → View Results unaffected
- [x] No stray dialogs/stale toasts after rapid delete clicks

(All user-confirmed live, 2026-11-06.)

## Findings

None. Backend driver: `functions/scripts/qa-1439-delete.ts` (minted a
disposable `qa-1439-delete` auth user via service-account custom-token
exchange; user deleted after the run).
