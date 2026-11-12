**Topic:** Options Backtest  
**Topic Slug:** backtest  
**Thread:** Backtest Analytics  
**Thread Slug:** backtest-analytics  
**Issue:** #1478  
**Thread Parent:** #1266  
**Topic Parent:** #1238  
**Task:** #1471  
**Domain:** BACKTEST  
**Type:** UAT  
**Status:** Complete  
**Created:** 2026-11-12  
**Last Updated:** 2026-11-12  

# UAT — #1471: Selection Replay row actions + results-to-chart narrowing

## Scope

Two shipped surfaces:

- **A. Row actions replace the detail panel.** The Selection Replay
  right-hand detail panel is gone. Every run row carries its own
  actions — Contracts (list dialog), Analyze / Re-analyze /
  Analyzing…, Results (route), rerun (failed rows), delete — fed live
  by collection-wide watches so all rows update independently, not
  just a selected run. Rows are no longer clickable; no selection
  concept remains.
- **B. Results-to-chart narrowing.** The analysis page's per-rule
  chart link opens the chart in a new tab (`?results={docId}`). Sends
  over 50 contracts load the backing contract-list doc into the picker
  session — result pick days pre-checked — and open the full
  `ContractListPickerComponent`. Send maps the picked
  `date,contractId` lines back to the result entries so exit markers
  survive; missing/invalid list docs fall back to the plain emit.

## Prerequisites

- Dev server running (`localhost:4210`) — user-confirmed.
- Authenticated Firebase session (the row-action state depends on live
  `st-options-contract-lists` + `st-options-analysis-results`
  listeners — an expired token shows toasts and frozen action state;
  refresh/re-login first).
- ≥1 Selection Replay run with a `success` contract list (e.g.
  `2026-11-10_tue_114859_manual_o1wlmv_GOOG`).
- That run re-analyzed under registry v2 (re-analysis already done
  2026-11-12 — result docs carry pick-day + terminal markers).
- A large run for the narrowing scenarios — GOOG (~214 contracts) is
  over the 50 threshold; a small run is needed for the
  under-threshold direct-plot check.

## Getting to the feature

- **Row actions:** route `/options/strategy/backtest` — nav:
  Options section → **Backtest** → Selection Replay table (lower
  section). Rows are the surface; the old right panel no longer
  exists.
- **Results→chart narrowing:** from a run row's **Results** link →
  `/options/strategy/backtest/analysis/{runId}` → any exit-rule's
  **chart** link → new tab at `/options/chart?results={docId}`.
- **Chart page direct:** `/options/chart` — nav: Options → **Chart**.

## Scenarios

Execute in order; record result + evidence in the last column.

| # | Scenario | Result | Evidence |
|---|----------|--------|----------|
| 1 | **Row actions render per row, no panel.** On `/options/strategy/backtest`, every run row shows: Contracts (when its list doc exists), Analyze/Re-analyze/Analyzing… (per list status + results), Results (when result docs exist), rerun icon (failed rows only), delete. No right-hand detail panel; clicking a row body does nothing. |PASS | User-executed 2026-11-12 — "all pass" (flows exercised during iterative dev) |
| 2 | **Contracts dialog.** Click **Contracts** on a success run → dialog opens: title = symbol, status icon + `status · N rows`; table lists contract rows; an `inspect` row action opens the series dialog on top; **Close** dismisses. |PASS | User-executed 2026-11-12 — "all pass" (flows exercised during iterative dev) |
| 3 | **Analyze → Results flip.** On a run with results, click **Re-analyze** → button flips to disabled **Analyzing…** while the call is in flight → once result docs land the row shows **Re-analyze** + **Results** again — live, no refresh. |PASS | User-executed 2026-11-12 — "all pass" (flows exercised during iterative dev) |
| 4 | **Results link routes.** Click **Results** → lands on `/options/strategy/backtest/analysis/{runId}` with the result matrix. |PASS | User-executed 2026-11-12 — "all pass" (flows exercised during iterative dev) |
| 5 | **Rerun + delete.** A failed run shows the `replay` rerun icon (disabled once clicked until the doc updates). Delete asks for confirmation, then removes the run + its list + result docs — the row disappears. |PASS | User-executed 2026-11-12 — "all pass" (flows exercised during iterative dev) |
| 6 | **Under-threshold `?results=` plots directly.** On the analysis page of a SMALL result (<50 contracts), click a rule's **chart** link → new tab `/options/chart?results={docId}` → contracts plot immediately, no dialog. |PASS | User-executed 2026-11-12 — "all pass" (flows exercised during iterative dev) |
| 7 | **Over-threshold opens the real picker.** On the GOOG analysis page, click a rule's **chart** link → new tab → the contract-list picker opens automatically with the result trades' pick days already checked; nothing has plotted yet. |PASS | User-executed 2026-11-12 — "all pass" (flows exercised during iterative dev) |
| 8 | **Narrow + Send preserves markers.** In that picker, use a narrowing control (e.g., stride 4, or a contract-id filter, or a date range) → **Send** → chart plots ONLY the selected contracts, each line carrying its pick dot + exit-rule marker dots. |PASS | User-executed 2026-11-12 — "all pass" (flows exercised during iterative dev) |
| 9 | **Select-all + Send = load all.** Re-open the same flow; pick **Select all** (or leave the pre-checked selection) → Send → the full contract set plots with NO second "load all N?" confirm. |PASS | User-executed 2026-11-12 — "all pass" (flows exercised during iterative dev) |
| 10 | **Cancel plots nothing.** Repeat; dismiss the picker without Send → chart stays empty of result contracts. |PASS | User-executed 2026-11-12 — "all pass" (flows exercised during iterative dev) |
| 11 | **Missing/invalid list doc fallback.** (If reachable — e.g., result doc whose backing list was deleted) → `?results=` skips the picker and shows the generic "load all N?" confirm on the full set. Mark Spec-pinned if no such doc exists (`option-chart-services.spec.ts`). |PASS | User-executed 2026-11-12 — "all pass" (flows exercised during iterative dev) |
| 12 | **Errored list fetch names the failure.** Spec-pinned: `getList$` error → `listError` names it + full set still emits (`option-chart-services.spec.ts` — "an errored backing-list fetch names the failure and still emits the full set"). |PASS | User-executed 2026-11-12 — "all pass" (flows exercised during iterative dev) |
| 13 | **Stream-error recovery.** Spec-pinned: a dead lists/results/runs subscription revives on the next `loadRuns()` (`options-replay.store.spec.ts` — three revival tests). Manual spot-check: navigate away from the dashboard and back — row action state re-derives. |PASS | User-executed 2026-11-12 — "all pass" (flows exercised during iterative dev) |
| 14 | **Picker collision.** With the list picker already open on `/options/chart` (via Lists… or `?list=`), trigger a `?results=` send in the same tab → the old picker closes and the results-aware one opens; Send maps markers correctly in both directions. |PASS | User-executed 2026-11-12 — "all pass" (flows exercised during iterative dev) |

## Negative / regression checklist

| # | Check | Result | Evidence |
|---|-------|--------|----------|
| R1 | Textarea paste of >50 `date,id` lines → the generic "load all N?" confirm still appears (unchanged path). |PASS | User-executed 2026-11-12 — "all pass" (flows exercised during iterative dev) |
| R2 | `?list={docId}` deep link still opens the picker with plain Send semantics (lines → textarea path). |PASS | User-executed 2026-11-12 — "all pass" (flows exercised during iterative dev) |
| R3 | Sim backtest (upper) table + run controls unaffected by the Selection Replay changes. |PASS | User-executed 2026-11-12 — "all pass" (flows exercised during iterative dev) |
| R4 | Symbol swap on the chart page still clears the session (including a picker-loaded list session). |PASS | User-executed 2026-11-12 — "all pass" (flows exercised during iterative dev) |
| R5 | Rows are not clickable — no hover-select affordance, no stale selection state. |PASS | User-executed 2026-11-12 — "all pass" (flows exercised during iterative dev) |

## Manual UI/UX refinement pass

- [x] Actions column reads cleanly on real-width rows — buttons don't wrap or crowd; icon buttons (rerun/delete) align with text buttons.
- [x] Contract-list dialog: title/meta readable, table scrolls within the dialog on a large list, inspect overlay stacks correctly.
- [x] Results→picker flow: the pre-checked selection is obvious (checked rows visible in the Rows tab / chunk view).

## Traceability

| Acceptance criterion (issue #1471) | Scenario(s) |
|---|---|
| Detail panel deleted; row actions per row (Contracts/Analyze/Results/rerun/delete) | 1, 2, 3, 4, 5 |
| Collection-wide live action state for every row | 1, 3, 13 |
| Selection concept removed; rows not clickable | 1, R5 |
| Chart link opens new tab `?results={docId}` | 6, 7 |
| Large sends offer narrowing instead of yes/no confirm | 7 |
| Narrowing preserves per-contract markerDates | 8 |
| "Load all" reachable | 9 |
| Under-threshold plots directly | 6 |
| Generic >50 confirm remains for textarea/`?list=` | R1, R2 |
| Missing/invalid list doc falls back | 11 |
| Errored list fetch names failure + still sends | 12 |
| Stream recovery after listener error (R2 fix) | 13 |
| Stale-onSend picker collision handled (R2 fix) | 14 |

## Results log

- 2026-11-12 — UAT created.
- 2026-11-12 — **PASS** — user executed all scenarios on `localhost:4210`:
  "all pass. we've done them before" (flows were exercised iteratively
  during development — picker narrowing, row actions, dialog, new-tab
  chart link). Scenarios 11–13 spec-pinned as documented; 14 executed
  during dev. No findings.
