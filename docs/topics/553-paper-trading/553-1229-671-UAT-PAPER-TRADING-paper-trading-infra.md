**Topic:** Paper Trading Infra  
**Topic Slug:** paper-trading-infra  
**Thread:** Trade Exits  
**Thread Slug:** trade-exits  
**Issue:** #1229  
**Thread Parent:** #652  
**Topic Parent:** #553  
**Task:** #671  
**Domain:** PAPER-TRADING  
**Type:** UAT  
**Status:** Complete  
**Created:** 2026-10-22  
**Last Updated:** 2026-10-22  

# UAT — #671 FE: Dashboard close/cancel actions + confirm + CANCELLED chip

Acceptance for the paper-trading dashboard's trade-exit surface: per-row
Close/Cancel actions behind a confirm dialog, per-status chips (CANCELLED
visible + dimmed), and a Status filter including CANCELLED. Service/store
plumbing shipped in #670 — this task wires the UI.

## Prerequisites

- Dev server: `npm start` (running at `http://localhost:4200`)
- Signed-in session with paper trades in Firestore — the acceptance
  surface needs at least one **OPEN** and one **PENDING** paper trade.
  If none exist, mint them via the signal gallery or a manual paper
  order before starting (PENDING trades fill at the noon-PT pass —
  check `trading/paper` before then or use an unfilled expression
  trade).
- DevTools console open throughout — record any errors.

## Start

Navigate to `trading/paper` (Paper Trading in the app nav). Let the
account header + trades table finish loading.

## Scenarios

### S1 — Action column renders per status

1. In the trades table, scan the new rightmost **Action** column.
2. **Expected:** OPEN rows show a close icon (`exit_to_app`); PENDING
   rows show a cancel icon (`cancel`); CLOSED, EXPIRED, ASSIGNED, and
   CANCELLED rows show nothing (empty cell).

**Result:** PASS — user-confirmed browser pass on :4200 (S6 finding fixed + re-verified: banner ✕ dismisses, Retry reloads)

### S2 — Close flow (OPEN row)

1. Click the close icon on an OPEN trade.
2. **Expected:** confirm dialog shows the trade summary — id, symbol,
   expression, qty, governing variant, latest mark (when present).
3. Confirm. **Expected:** spinner while the action is in flight; the
   dialog closes on settle; the row flips to **CLOSED** with realized
   P&L; the account header's cash/equity updates.

**Result:** PASS — user-confirmed browser pass on :4200 (S6 finding fixed + re-verified: banner ✕ dismisses, Retry reloads)

### S3 — Cancel flow (PENDING row)

1. Click the cancel icon on a PENDING trade → confirm → settle.
2. **Expected:** same dialog shape (Cancel verb); row flips to
   **CANCELLED** and the chip renders dimmed — terminal-never-held, not
   failure-red.

**Result:** PASS — user-confirmed browser pass on :4200 (S6 finding fixed + re-verified: banner ✕ dismisses, Retry reloads)

### S4 — Cohort drill-down rows expose the same actions

1. Group by → **Signal cohort** → expand a cohort containing an OPEN or
   PENDING trade.
2. **Expected:** the drill-down table's Action column shows the same
   close/cancel icon on actionable rows; clicking it opens the same
   dialog.

**Result:** PASS — user-confirmed browser pass on :4200 (S6 finding fixed + re-verified: banner ✕ dismisses, Retry reloads)

### S5 — Status filter + CANCELLED chip

1. Header **Status** select → confirm the option list includes
   `CANCELLED` (plus All, PENDING, OPEN, ASSIGNED, CLOSED, EXPIRED).
2. Select `CANCELLED`. **Expected:** the table reloads to show only
   cancelled trades; their chips render dimmed.
3. Select `All`. **Expected:** filter clears; full list returns.

**Result:** PASS — user-confirmed browser pass on :4200 (S6 finding fixed + re-verified: banner ✕ dismisses, Retry reloads)

### S6 — In-flight + failure behavior

1. On an actionable row, open the dialog and confirm — watch the
   confirm button during the flight.
2. **Expected:** spinner replaces the verb; both dialog buttons are
   disabled; a second row-click while any dialog is open does nothing.
3. If a callable error is reproducible (e.g., cancel after the fill
   pass already ran) → **Expected:** snackbar/error banner visible,
   row unchanged.
4. Dismiss the banner via its **✕ button** → **Expected:** banner clears
   without reloading (`store.clearError()`).
5. The **Retry** button re-fires `loadAll` → **Expected:** banner clears
   when the reload *succeeds* (it's the affordance for a failed LOAD,
   not for re-attempting the close — retry the close from its row).

**Result:** PASS — user-confirmed browser pass on :4200 (S6 finding fixed + re-verified: banner ✕ dismisses, Retry reloads)

**UAT findings (fixed in-pass):** close on `260927-sig-SNDK-LC-050-30`
returned `unavailable: no live quote … — close not attempted`. The
backend validates (auth/ownership/OPEN/legs) → computes the exit price
→ only then writes, so the trade was left untouched (OPEN, retryable).
Findings fixed: (a) the error banner had **no dismiss path** — `error`
clears only at load start and a failed action skips reload; the banner
now has a ✕ dismiss (`clearError`) plus a Retry button; (b) Retry's
semantics were ambiguous — it retries the *load*, which succeeds even
when the quote-less close would still fail; comment + this doc now
state that plainly; (c) a quote-less close is an atomic no-op by BE
design — manual close *requires* a live mark.

### S7 — Regression smoke

1. Group by several dims (symbol, sector, direction); sort a column
   asc/desc; expand/collapse cohort sections.
2. **Expected:** all pre-existing behavior intact; no console errors.

**Result:** PASS — user-confirmed browser pass on :4200 (S6 finding fixed + re-verified: banner ✕ dismisses, Retry reloads)

## Refinement pass (manual UI/UX)

- [x] Action icon hit target + column alignment at typical widths
- [x] Chip legibility — CANCELLED/EXPIRED read dimmed/inactive
- [x] Dialog layout — summary rows legible, confirm disabled while busy
- [x] No double-submit possible while the spinner shows

## Traceability

| Acceptance criterion | Scenario |
|---|---|
| OPEN → Close (confirm + spinner); PENDING → Cancel; terminal → none | S1, S2, S3, S6 |
| Cohort drill-down rows expose same actions | S4 |
| `unavailable`/`failed-precondition` visible; row unchanged | S6 |
| CANCELLED chip + status-filter entry | S1, S3, S5 |
| Store selector for cancelled trades | S5 + store spec (automated) |
| Component specs per TEST doc | automated (below) |

## Automated evidence

- Focused: **66/66** — `paper-trading.store.spec` + `paper-trading.component.spec`
  + `paper-trade-action-dialog.component.spec`
- Paper-trading batch: **125/125**
- Full suite: **4451/4451** (259/259 suites)
- `tsc --noEmit -p tsconfig.app.json` — clean
- `git diff --check` — clean (EOL warnings only)
- Code review: `553-664-671-CODE-REVIEW-PAPER-TRADING-paper-trading-infra.md` — PASS (two rounds, converged)
