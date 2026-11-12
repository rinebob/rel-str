**Topic:** Option Contract Time-Series Viewer  
**Topic Slug:** option-contract-viewer  
**Thread:** Multi-symbol input  
**Thread Slug:** multi-symbol-input  
**Issue:** #1468  
**Thread Parent:** #1244  
**Topic Parent:** #1243  
**Task:** #1440  
**Domain:** OPTIONS  
**Type:** UAT  
**Status:** Complete  
**Created:** 2026-11-11  
**Last Updated:** 2026-11-12  

# UAT — Symbol swap clears the prior session's plotted contracts (#1440)

## Scope

#1440 is a correctness fix: a symbol swap used to leave the previous
symbol's plotted option-contract series, chips, focus, and in-flight
loads alive under the new symbol's underlying — a meaningless, misleading
overlay. The fix makes every symbol switch an atomic session reset and
guards every async path that could write stale state afterward.

Task acceptance criteria:

1. `onSymbolChange` clears plotted contracts + chips + focus.
2. Plotted-set input behavior decided + implemented (clear — the
   textarea empties on swap).
3. Spec: symbol swap empties the plotted set; regression on existing
   swap-path specs.

Review-round fixes this UAT also confirms at runtime (all spec-pinned):

- **Stale focused-contract drop** — a single-contract load resolving
  after a swap cannot repaint the old contract or yank the underlying
  back (sequence-guarded).
- **Stale underlying fetch drop** — an old-symbol bars response landing
  after a swap cannot overwrite the new symbol's bars (latest-request-wins).
- **Underlying clears on swap** — the old symbol's price line vanishes
  immediately; nothing foreign renders during the refetch gap.
- **Page remount reset** — leaving and re-entering `/options/chart`
  starts a clean session; the root-scoped store no longer re-mounts the
  previous session's contracts under the default symbol.
- **Confirm-dialog await gap** — a >50-line load whose confirmation
  dialog is open across a symbol swap drops the stale parsed set instead
  of plotting it under the new symbol.

## Prerequisites

- Dev server: `npm start` → http://localhost:4200.
- Signed in (contract lists are Firestore-backed).
- A valid OCC id present in the partner corpus —
  `QQQ261218P00645000` fetched clean on 2026-11-07 (a corpus miss
  surfaces `INTERNAL`; that's #1457, a backend chore, not a UI fail).
- A second symbol's contract list doc for the deep-link scenario —
  SPY: `2026-11-06_fri_120138_manual_09h45m_SPY` (from #1423 UAT, still
  valid unless docs rotated).
- No special tooling needed beyond the browser URL bar.

## Getting to the feature

Route: **`/options/chart`**. Entry point: app nav → **Options → Chart**.
You land on the option contract viewer:

- **Left drawer (collapsible, tune icon)** — symbol field at top, then
  contract-list chooser, replay dropdown, catalog search, group
  generator, and the dated `date,contractId` textarea + Load button.
- **Center** — the contract chart (full remaining height).
- **Right column** — plotted-set chips plus the rejected-token notice.

The symbol field is the first control in the drawer — that's the primary
swap surface under test.

## Automated evidence (executed this session)

- `npx jest src/app/features/savant-trader/pages/option-chart
  src/app/features/savant-trader/stores --coverage=false` —
  **29 suites / 658 tests green**, including the 10 #1440 pins
  (set-swap, focused-swap, mid-flight drop, error drop, same-id
  supersede, released-load completion, stale-bars drop, init-session
  reset, worker non-resurrection, mid-confirm swap drop).
- `npx tsc --noEmit` on touched files — clean.
- `git diff --check` — clean.
- Full `npx jest` — 5,465/5,477; the 12 failures are another session's
  uncommitted `src/app/core` sidenav `isActive` WIP, unrelated.

## Scenarios

### 1. Plotted set → symbol swap via drawer field

- **Feature:** the primary fix — set + chips + focus + input all clear.
- **Steps:** On `/options/chart` (QQQ default), paste into the textarea
  → Load:
  ```
  2026-10-01,QQQ261218P00645000
  2026-10-08,QQQ261218P00676000
  ```
  Confirm both chips render in the right column and both series draw.
  Then open the drawer, change the symbol field to `SPY`, confirm.
- **Expected:** The right chips column **empties**; both QQQ series
  vanish; the SPY underlying loads alone — no QQQ lines overlaid; the
  contract textarea is **empty**; no hover/pin/focus state survives.
- **Evidence/result:**

### 2. Re-plot post-swap — session is healthy

- **Feature:** the reset doesn't break subsequent loads.
- **Steps:** Immediately after scenario 1 (page on SPY), swap the symbol
  field back to `QQQ`, then paste:
  ```
  2026-10-01,QQQ261218P00645000
  ```
  → Load.
- **Expected:** The contract loads and plots normally — one chip, one
  series. The post-swap session is fully functional, not stuck in a
  cleared/locked state.
- **Note:** pasting a contract whose underlying ≠ the page symbol now
  **auto-swaps the symbol** to match the input (scenario 10) — the old
  `wrong-underlying` rejection still applies only to minority
  underlyings inside a mixed-underlying paste.
- **Evidence/result:**

### 3. Focused single-contract view → swap

- **Feature:** the focused contract view (no plotted set) also clears.
- **Steps:** With the symbol on `QQQ`, load a single **undated**
  contract id — `QQQ261218P00645000` → the focused single-contract view
  renders (one line, no set chips). Swap the symbol to `SPY`.
- **Expected:** The focused view closes — no old contract line over the
  SPY underlying, no stale legend/detail; SPY underlying alone.
- **Evidence/result:**

### 4. Underlying line — nothing foreign during the refetch gap

- **Feature:** the old symbol's underlying bars clear at swap, not when
  the new fetch lands.
- **Steps:** With a QQQ plotted set visible (and its QQQ underlying),
  swap to `SPY` and watch the chart during the refetch.
- **Expected:** The QQQ price line disappears **immediately** at the
  swap — there is no moment where the old underlying renders under the
  new symbol's session while waiting for data. SPY's line arrives alone.
- **Evidence/result:**

### 5. Cross-symbol `?list=` deep link

- **Feature:** deep-link switch paths run the same reset.
- **Steps:** With a QQQ plotted set on screen, navigate to
  `http://localhost:4200/options/chart?list=2026-11-06_fri_120138_manual_09h45m_SPY`
- **Expected:** The picker dialog opens by design — behind it the right
  column holds **no QQQ chips/series**; closing the picker shows a clean
  SPY session. Any rows sent from the picker plot SPY's set alone.
- **Evidence/result:**

### 6. Swap while a batch is loading

- **Feature:** in-flight `loadPlotted` workers can't resurrect the old
  set.
- **Steps:** Open the list chooser → pick the SPY doc → Send a large
  selection (the SPY doc has ~200 picks — progress chips take a moment).
  While chips are still resolving, swap the symbol to `QQQ`.
- **Expected:** The SPY progress/chips drop mid-flight; no late-arriving
  SPY contract appears after the QQQ swap. QQQ's session is clean.
  (Hard to hand-time — the spec pin covers it; a fast visual glance is
  enough.)
- **Evidence/result:**

### 7. Page remount — stale session can't re-mount

- **Feature:** `initSession` reset (round-2 fix) — the root store
  survives page teardown.
- **Steps:** With a plotted set on `/options/chart`, navigate to another
  page (e.g. `/options/chain`), then come back to `/options/chart` via
  nav.
- **Expected:** A clean default session — **no** previously plotted
  contracts or chips re-appear. Underlying loads fresh.
- **Evidence/result:**

### 8. >50-line confirm dialog open across a swap

- **Feature:** the await-gap guard (round-2 fix).
- **Steps:** Paste >50 dated lines (duplicate the same contract across
  51 dates, e.g. `2026-10-01,QQQ261218P00645000` … `2026-11-20,...`)
  → Load → the "large set" confirmation dialog appears. **Leave it
  open.** Via the browser URL bar, navigate to
  `http://localhost:4200/options/chart?list=2026-11-06_fri_120138_manual_09h45m_SPY`
  — then dismiss the picker and click **Confirm** on the still-open
  dialog.
- **Expected:** The 51 QQQ entries do **not** plot under SPY — the stale
  parsed set is dropped. If the dialog auto-dismisses on navigation
  instead, that's equally correct — record which behavior occurred.
- **Evidence/result:**

### 9. Regression sweep

- **Feature:** untouched flows still work.
- **Steps:** (a) Symbol field swap with **no** plotted set — clean
  underlying swap as before; (b) swap to the **same** symbol the page
  is already on — no error; (c) after a swap, picker Send / replay pick
  / generator Send all still plot normally; (d) the rejected-token
  notice still appears on bad input and clears on swap.
- **Expected:** All behave as before; the reset adds clearing without
  breaking anything downstream.
- **Evidence/result:**

### 10. Foreign-underlying input auto-swaps the symbol

- **Feature:** the load path's symbol gate is removed — pasted/sent
  contracts pick the underlying instead of being blocked (folded into
  this task post-QA per user direction).
- **Steps:**

  **(a) Foreign paste — the auto-swap path.** On `/options/chart` with
  symbol `QQQ` and a plotted set visible, paste → Load (real corpus
  picks from the SPY list doc `2026-11-06_fri_120138_manual_09h45m_SPY`):
  ```
  2026-01-02,SPY260213P00655000
  2026-01-05,SPY260220P00660000
  ```

  **(b) Foreign-symbol list send.** Back on `QQQ`, navigate via the URL
  bar to
  `http://localhost:4200/options/chart?list=2026-11-06_fri_120138_manual_09h45m_SPY`
  → the picker opens on the SPY doc → select a few rows → Send.
  (Note: the `?list=`/`?results=` deep links swap the symbol at
  doc-read — `switchSymbolForDoc` — so this send arrives same-symbol;
  the send-path auto-swap is a safety net for programmatic callers and
  is covered by spec, not separately reachable through the UI.)

  **(c) Mixed-underlying paste — majority wins, minority rejected.**
  On `QQQ`, paste → Load:
  ```
  2026-01-02,SPY260213P00655000
  2026-01-05,SPY260220P00660000
  2026-10-01,QQQ261218P00645000
  ```
- **Expected:** (a) The symbol field flips to `SPY`, the session resets,
  and both SPY contracts load — chips + series under the SPY underlying;
  the textarea keeps the pasted lines. (b) The session lands on SPY with
  the picked rows plotting under the SPY underlying. (c) The page swaps
  to SPY (2-of-3 majority), both SPY contracts load, and the
  rejected-token notice shows `QQQ261218P00645000 — not a SPY contract`.
- **Evidence/result:**

## Manual UI/UX refinement pass

- [ ] Post-swap the chart + chips column settle cleanly — no flicker,
  no leftover load spinner, no orphaned progress text
- [ ] The swap is legible: old content gone *before/with* new content —
  never overlaid, even transiently
- [ ] Empty-after-swap state matches a fresh page load (same chrome,
  same placeholders)
- [ ] Both themes: no stale-color remnant on swap

## Regression / smoke

- [ ] `/options/chain` boots (shares the stores dir)
- [ ] Backtest analysis-results "chart" link still deep-links
  (`?results=` path — cross-symbol swap under deep-link)

## Traceability

| Criterion | Scenario(s) |
|---|---|
| AC1 swap clears set + chips + focus | 1, 4, 5, 6 |
| AC2 plotted-set input clears | 1 (textarea empty) |
| AC3 spec coverage | Automated evidence |
| Review: stale focused contract dropped | 3 (+ spec pin) |
| Review: stale underlying fetch dropped | 4 (+ spec pin) |
| Review: underlying clears at swap | 4 |
| Review: remount resets root store | 7 |
| Review: confirm-dialog await gap | 8 |
| Regression | 2, 9 + smoke |
| Auto-swap on foreign underlying | 10 |

## Results log

| # | Scenario | Result | Evidence |
|---|----------|--------|----------|
| 1 | Plotted set → drawer-field swap | PASS | User-executed 2026-11-12 |
| 2 | Re-plot post-swap | PASS | First run hit the `wrong-underlying` parse guard (QQQ id under SPY) — expected rejection, scenario steps corrected; re-run passed |
| 3 | Focused single contract → swap | PASS | User-executed 2026-11-12 |
| 4 | Underlying clears at swap | PASS | User-executed 2026-11-12 |
| 5 | Cross-symbol `?list=` deep link | PASS | User-executed 2026-11-12 |
| 6 | Swap mid-batch-load | PASS | User-executed 2026-11-12 |
| 7 | Page remount | PASS | User-executed 2026-11-12 |
| 8 | >50 confirm across a swap | PASS | User-executed 2026-11-12 |
| 9 | Regression sweep | PASS | User-executed 2026-11-12 |
| 10 | Foreign-underlying input auto-swaps symbol | PASS | User-executed 2026-11-12 — (a) foreign paste swaps + loads, (b) `?list=` send clean, (c) mixed paste majority-swaps + minority rejected |
