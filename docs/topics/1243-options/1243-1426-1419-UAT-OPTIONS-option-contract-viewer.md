**Topic:** Option Contract Time-Series Viewer  
**Topic Slug:** option-contract-viewer  
**Thread:** Selected Contract List Picker  
**Thread Slug:** contract-list-picker  
**Issue:** #1426  
**Thread Parent:** #1352  
**Topic Parent:** #1243  
**Task:** #1419  
**Domain:** OPTIONS  
**Type:** UAT  
**Status:** Complete  
**Created:** 2026-11-05  
**Last Updated:** 2026-11-05  

# UAT — #1419 BUG: Chunk live-drive emits but picker selection/lines stay stale

Verifies the #1419 sync-model fix: `selection` is the single source of
truth, the chart plots only on an explicit Send, and the picker Send
emits + closes (with the >50 confirm opening on a clean page).

Supersedes the live-drive expectations in the #1363 UAT — where those
docs describe "stepping re-plots behind the dialog", the behavior under
test here is **nothing emits while the dialog is open**.

## Prerequisites

- Dev server at `http://localhost:4200` (`npm start`)
- The 204-pick QQQ list doc: `2026-11-01_sun_105552_manual_anjw5z_QQQ`
  (template `csp-45-20`, 204 picks / 4 misses)
- Open the picker via:

  `http://localhost:4200/options/chart?list=2026-11-01_sun_105552_manual_anjw5z_QQQ`

  The `?list=` nav loads the doc, activates the session, and opens the
  picker dialog.

## Scenarios

| # | Scenario | Steps | Expected | Result |
|---|---|---|---|---|
| S1 | No emit while dialog open | Open the picker → Chunks tab → step `▶` several times, click timeline ticks | The chart behind the dialog does **not** change — no chips swap, no series load. The chunk readout `i/n` moves. `lastEmitted` untouched (Lines tab still previews the selection, not a chunk) | PASS — user-verified live on 204-pick QQQ doc |
| S2 | Add-chunk accumulates | On Chunks: step to a chunk → **Add chunk to selection** → step to another → **Add chunk** again | Both chunks' days checked on the Rows tab; the first addition survives the second step; Lines preview grows to cover both | PASS — user-verified live on 204-pick QQQ doc |
| S3 | Send plots + closes | Check a mix of rows (or add two chunks) → **Send N rows to chart** | The dialog **closes immediately**; the chart loads exactly the checked set — chips per unique contract, per-day marker dots; the pairs textarea shows the sent lines | PASS — user-verified live on 204-pick QQQ doc |
| S4 | Reopen shows truth | Click **Picker** on the mini-controls strip | The reopened dialog shows checks matching exactly what was just plotted (Send emitted the selection; nothing diverged) | PASS — user-verified live on 204-pick QQQ doc |
| S5 | Abort keeps the chart | Reopen → change the selection (uncheck a few rows) → **Close** (the button, not Send) | Chart unchanged; no emit happened. Reopen → the edited selection is still there (workspace persists — flagged semantics, see Findings) | PASS — user-verified live on 204-pick QQQ doc |
| S6 | >50 confirm on clean page | `All` on the Rows toolbar → **Send 204 rows to chart** | The picker closes first, *then* the "This will load 204 option contracts…" confirm appears over the page — **no double-stacked dialogs**, no dark double-backdrop; keyboard focus lands in the confirm | PASS — user-verified live on 204-pick QQQ doc |
| S7 | Confirm cancel leaves everything | Trigger S6 again → click **Cancel** on the confirm | **Chart unchanged AND textarea unchanged** — the cancelled send must not rewrite the pairs input (the R1 drift fix). Chips/series identical to before | PASS — user-verified live on 204-pick QQQ doc |
| S8 | Confirm approve writes + loads | Trigger S6 → click **Load** | Textarea now holds the 204 lines; the chart loads the full set | PASS — user-verified live on 204-pick QQQ doc |
| S9 | Mini-controls navigate only | Close the picker → strip `◀ ▶` several times; change **Size** to 20 | Chart does **not** move — `i/n` and cursor move only. (The strip has no emit except All) | PASS — user-verified live on 204-pick QQQ doc |
| S10 | Mini-controls All emits | Click **All** on the strip | The >50 confirm opens; approve → all 204 plot; **no picker involved** | PASS — user-verified live on 204-pick QQQ doc |
| S11 | Reopen after All | Reopen the picker | **All** rows checked on the Rows tab (sendAll selected-then-emitted — selection follows the emit) | PASS — user-verified live on 204-pick QQQ doc |
| S12 | Cursor/selection preserved | Reopen → step to a mid chunk, check a few rows → Close → reopen | Same cursor position and checks restored (`rs-optlist` persistence) | PASS — user-verified live on 204-pick QQQ doc |
| R1 | Rows tab regression | Toolbar: all/none/invert, stride=10, random N, date range, contains filter | Ops check the expected rows; no-selection marker rows stay disabled; ↻ repeat badges render | PASS — user-verified live on 204-pick QQQ doc |
| R2 | Lines tab regression | Lines tab | Preview mirrors the current selection exactly; `N lines` count matches; **Copy** writes `date,id` lines to clipboard | PASS — user-verified live on 204-pick QQQ doc |
| R3 | ?list= nav regression | Reload with the `?list=` URL while a session is active | Doc reloads, picker auto-opens once (no stacking); cross-symbol or bad docId still lands on a named error without touching the chart | PASS — user-verified live on 204-pick QQQ doc |

## Refinement pass

- Send button label still honest now that it closes (`Send N rows to chart`)
- Post-Send: chart visible immediately — no hidden plot behind the dialog
- `chunk-hint` copy matches behavior ("Stepping navigates… Add chunk… Send to plot")
- Confirm-over-clean-page feels right (no flicker/stack)
- Narrow-width + dark/light theme unchanged
- **Design flag (TN F4):** after Close-abort, the persisted selection can diverge from what's plotted with no indicator — does the workspace model feel right live, or does it need a "pending ≠ plotted" affordance (candidates: #1420)?

## Traceability

| AC | Scenarios |
|---|---|
| AC1 — one sync model, recorded in IMPL | IMPL "Sync model (#1419)" section; S1–S5 verify it holds |
| AC2 — picker state matches plotted after any emit | S3, S4, S8, S10, S11 |
| AC3 — no new emit path | code-review verified; S3/S10 ride the existing onSend/emitSessionLines seam |
| AC4 — lastEmitted-vs-selection inside sendAll | S10, S11 |

## Automated evidence

- Review PASS doc: `1243-1359-1419-CODE-REVIEW-OPTIONS-option-contract-viewer.md`
- Touched sweep: 6 suites / 131 tests green; full suite 301/5,244 green; AOT clean
- Key specs: picker `send()` order `['close','send']` + literal line pin; no-emit assertions on step/jump; page confirm cancel (textarea + no loadPlotted) and approve (write + load)

## Results log

**Run 1 — 2026-11-05 — user-executed on `2026-11-01_sun_105552_manual_anjw5z_QQQ` (204 picks):**

All scenarios S1–S12 + regressions R1–R3 + refinement pass — **PASS** (user-reported).

**Findings routed (not #1419 defects):**

- Chunk timeline lacks a start/end-date readout + strip `◀▶` dead under cursor-only model (user decision: remove strip) → **#1427 — FE Task: Picker polish — chunk start/end dates + remove mini-controls strip** (Blueprint #1359; consolidates what were two findings)
- Chip-hover dim doesn't include start/end dots + cursor data window needs toggle/reposition → **#1422 — FE Task: Chart polish — connected-hover parity (strikes+dots) + data-window toggle** (Blueprint #1261; consolidates what were two findings)
- TN F4 design flag (persisted selection can differ from plotted after Close-abort): user observed workspace-persist behavior in S5 and did not flag it as a problem — disposition: accepted model, indicator idea stays available to #1420

