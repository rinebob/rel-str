**Topic:** Portfolio Dashboard  
**Topic Slug:** portfolio-dashboard  
**Thread:** Portfolio Dashboard — Update Stop Loss  
**Thread Slug:** update-stop-loss  
**Issue:** #1316  
**Thread Parent:** #829  
**Topic Parent:** #219  
**Task:** #888  
**Domain:** PORTFOLIO  
**Type:** UAT  
**Status:** Complete  
**Created:** 2026-10-28  
**Last Updated:** 2026-11-04  

# UAT — Task #888: Update mode in stop-loss dialog + positions-table Update Stop

## Scope

The manual Update Stop flow end to end: protected equity positions get an
enabled **Update Stop** action that resolves the symbol's updatable live
stops, opens `StopLossDialogComponent` in update mode (picker when multiple
candidates, prefill of stop price + original TIF/hours), and submits through
`updateEquityStopOrder` with a `stop_loss_update` ticket. Place-phase
failures surface the unprotected warning; retry re-places without
re-cancelling; dismissal after an attempt refreshes the dashboard.

Task acceptance criteria (#888):

- Protected equity rows show enabled "Update Stop"; click resolves the
  symbol's updatable stops and opens the dialog in update mode
- Multiple candidates render the picker first; single candidate goes
  straight to the form
- Prefill: current stop price, original `timeInForce`/`marketHours`
  (defaults `gtc`/`regular_hours` when absent)
- Submit calls the primitive; place-phase failure shows the unprotected
  warning and manual retry re-places without re-cancelling
- Dismissal after success refreshes the dashboard

## Prerequisites

- Repo: `C:\aa\projects\rel-str`, dependencies installed.
- Commands run from the repo root in PowerShell or bash.
- No credentials needed for scenarios 1–15 — everything executes under Jest
  mocks. Scenarios 16–18 (live UI) require `npm start`, an authenticated
  agent-enabled Robinhood session, and ≥1 equity position protected by a
  resting stop order.

## Start instructions

```powershell
cd C:\aa\projects\rel-str
# Focused suites:
npx jest src/app/features/portfolio-dashboard/components/stop-loss-dialog `
  src/app/features/portfolio-dashboard/components/equity-positions-table.component.spec.ts `
  src/app/features/portfolio-dashboard/portfolio-dashboard.component.spec.ts `
  src/app/features/portfolio-dashboard/utils/portfolio-pnl.util.spec.ts `
  src/app/shared/components/stop-loss-form --coverage=false
# Regression gate:
npx jest src/app/features/portfolio-dashboard src/app/shared/components/stop-loss-form --coverage=false
npx ng build
# Live UI (scenarios 16–18):
npm start   # then open http://localhost:4200 → Portfolio → Equity Positions
```

## Scenarios

Each spec-driven scenario names the Jest spec(s) asserting it. Run the
focused suites and confirm each listed spec reports PASS; `-t "<name>"`
runs one spec in isolation.

### 1. Protected + updatable row → enabled "Update Stop"

- **Spec (`equity-positions-table.component.spec.ts`):** Update Stop
  button enabled when `updatableSymbols` contains the symbol; emits
  `updateStopLoss` with the position on click.
- **Expected:** the row's stop action renders "Update Stop" (not the
  disabled "Add Stop" fallback); clicking emits the position.

### 2. Protected but not updatable → disabled "Add Stop" fallback

- **Spec:** symbol in `stopLossProtectedSymbols` but NOT `updatableSymbols`
  → disabled button (e.g., a `stop_limit` protective order).
- **Expected:** same disabled fallback as before #888 — a protected
  non-updatable position can never enter the update flow.

### 3. Unprotected row → enabled "Add Stop" (unchanged)

- **Spec:** existing add-stop tests still green.
- **Expected:** no regression — unprotected rows keep the original action.

### 4. Dashboard resolves candidates and opens update mode

- **Specs (`portfolio-dashboard.component.spec.ts`):** `onUpdateStop`
  reads `updatableStops().get(symbol)`, opens `StopLossDialogComponent`
  with `{ position, currentPrice, accountNumber, update: { candidates } }`;
  does NOT open when the candidate list is empty; stop-limit orders are
  excluded from candidates.
- **Expected:** dialog data carries the update block; guard prevents a
  dead-end picker.

### 5. Single candidate skips the picker

- **Spec (`stop-loss-dialog.component.spec.ts`, update-mode describe):**
  *"goes straight to editing on a single candidate with no target"*.
- **Expected:** `state === 'editing'`, `targetOrder` = the only candidate.

### 6. Multiple candidates render the picker; selection enters editing

- **Specs:** *"opens in picking when multiple candidates and no target"*;
  *"`selectCandidate` reseeds the form TIF/hours from the picked stop"*.
- **Expected:** `state === 'picking'` with one row per candidate (order id,
  stop price, qty); picking one sets `targetOrder`, re-seeds TIF/hours,
  transitions to `editing`.

### 7. Prefill — stop price + original TIF/hours

- **Specs:** *"prefills the form with the target stop price and the
  original TIF"*; *"falls back to gtc / regular_hours when the target
  order lacks TIF and market hours"*.
- **Expected:** form `initialStopPrice` = the stop's `stopPrice`; TIF pill
  reflects the original order (`gfd` etc.), defaults `gtc`; hours show the
  original value with extended/all-day disabled (RH rejects non-regular
  stops).

### 8. Submit calls the primitive — never `submitEquityOrder`

- **Spec:** *"submit calls updateEquityStopOrder with a stop_loss_update
  ticket — never submitEquityOrder"*.
- **Expected:** `updateEquityStopOrder(account, orderId, ticket)` once;
  `ticket.sourceRef = { type: 'stop_loss_update', id: <replaced orderId> }`;
  `marketHours: 'regular_hours'` pinned; `submitEquityOrder` not called.

### 9. Place-phase unprotected failure → warning + re-place retry

- **Spec:** *"place-phase unprotected failure retries by re-placing via
  submitEquityOrder — never re-cancels"*.
- **Expected:** `unprotectedWarning` renders; Retry calls
  `submitEquityOrder` with the retained ticket (same refId);
  `updateEquityStopOrder` NOT called again — no re-cancel.

### 10. Unconfirmed/conflict place failure → no armed retry (reconcile)

- **Specs:** *"place-phase unconfirmed failure (unprotected false) offers
  no retry"*; *"failed re-place with a ref-id conflict stamps
  place/unprotected:false — no retry, reconcile"*.
- **Expected:** `canRetry` false; the dialog's only exit is Cancel/Done,
  which closes `true` → dashboard refresh reconciles the broker state.

### 11. PLACEMENT_DEAD → fresh refId on retry

- **Spec:** *"PLACEMENT_DEAD retry re-places with a fresh refId"*.
- **Expected:** retry calls `submitEquityOrder` with a NEW `refId` (the
  dead placement likely consumed the original); success reaches `success`
  state.

### 12. Cancel-phase failure → retry re-runs the whole primitive

- **Specs:** *"cancel-phase retryable failure retries the whole primitive
  on the same ticket"*; *"thrown error from the primitive stamps cancel
  phase — retry re-runs cancel-first"*.
- **Expected:** retry calls `updateEquityStopOrder` again with the SAME
  ticket object (refId preserved); `submitEquityOrder` not called.

### 13. Dismissal semantics

- **Specs:** *"closes true on cancel after a submission attempt"*;
  *"blocks dismiss once a submission runs"*; `onDone` closes `true`.
- **Expected:** `disableClose` set once a submission runs (no ESC/backdrop
  dismiss); Cancel after an attempt closes `true`; the dashboard refreshes
  on `afterClosed` truthy (`openThenRefresh`).

### 14. `submitLabel` + success heading

- **Specs (`stop-loss-form.component.spec.ts`):** default label "Submit
  Stop Loss"; custom label renders. Update-mode dialog specs assert
  heading/copy.
- **Expected:** update mode shows "Update Stop" on the button and "Stop
  Loss Updated" on success; add mode unchanged.

### 15. Eligibility utility

- **Specs (`portfolio-pnl.util.spec.ts`):** `isUpdatableStopOrder` accepts
  live equity protective sell stops; rejects `stop_limit`, `type:'limit'`
  + `stopPrice`, non-equity, non-protective. `updatableStopsBySymbol`
  groups by symbol filtered against positive long positions.
- **Expected:** suite green — the same Map the store's `updatableStops`
  computed exposes.

### 16. LIVE — Update Stop end to end (user-driven)

- **Prereq:** `npm start`, agent-enabled account, a position with a resting
  stop.
- **Steps:** Portfolio → Equity Positions → click **Update Stop** on the
  protected row → (picker if multiple stops) → adjust the stop price →
  **Update Stop** → confirm success state → dismiss.
- **Expected:** old order reaches `cancelled` in RH; replacement appears in
  Open Orders at the new price; dashboard refreshes on dismiss.
- **If no live protected position exists:** BLOCKED — record and defer.

### 17. LIVE — picker + prefill + retry UX refinement pass

- **Steps:** with ≥2 stops on one symbol, verify picker rows (order id /
  stop / qty) are readable; TIF pill matches the picked order; extended/
  all-day hours disabled; error state copy is understandable; buttons
  sized/styled consistently with the add-stop dialog at ~1366px and mobile
  widths.
- **Expected:** no visual/copy defects; consistent with nearby dialogs.

### 18. LIVE — disabled-state scan

- **Steps:** find a `stop_limit`-protected position (or confirm none
  exists) → its stop action stays disabled with the fallback tooltip.
- **Expected:** protected-but-not-updatable never presents an enabled
  action.

## Traceability

| AC / checklist item | Scenario |
|---|---|
| Protected rows show enabled Update Stop → update-mode dialog | 1, 4, 16 |
| Multiple candidates → picker; single → straight to form | 5, 6, 17 |
| Prefill stop price + TIF/hours (defaults gtc/regular_hours) | 7, 17 |
| Submit → primitive; place failure → warning + re-place, no re-cancel | 8, 9, 10, 11, 12 |
| Dismissal after success refreshes dashboard | 13, 16 |
| Protected-but-not-updatable keeps disabled fallback | 2, 18 |
| Regression — add-stop flow, table, dashboard untouched | 3, 15, regression gate |

## Regression / smoke checklist

- [x] `portfolio-pnl.util.spec.ts` — eligibility + grouping (incl. `limit`+`stopPrice` stop-limit shape)
- [x] `stop-loss-dialog` specs — add mode unchanged; update mode picker/prefill/retry matrix
- [x] `equity-positions-table` specs — three button states
- [x] `portfolio-dashboard.component.spec.ts` — `updatableStops` derivation, candidate resolution, refresh-on-close
- [x] `stop-loss-form` specs — `submitLabel`, prefill, pinned hours
- [x] `order-execution.service.spec.ts` — `isRefIdConflictError` / `asUpdatePlaceFailure` exports
- [x] `npx ng build` — compiles clean (pre-existing `ds-gallery` SCSS budget failure at HEAD is unrelated)

## Results

| # | Scenario | Result | Evidence |
|---|---|---|---|
| 1–15 | Spec-driven acceptance | PASS | `npx jest` focused run 2026-10-28: 35 suites / 690 tests green across `portfolio-dashboard/`, `stop-loss-form/`, `order-execution.service.spec.ts` — covers every named spec in scenarios 1–15 incl. the update-mode retry matrix (scenarios 9–12), picker/prefill (5–7), ticket contract (8), and eligibility discriminators (15) |
| 16 | Live end-to-end update | PASS (partial) / DEFERRED | User ran the live flow 2026-11-04 ("it works pretty well") — update submitted, replacement landed, refresh-on-dismiss confirmed working. Deferred sub-checks (picker with multiple stops, warning states) deferred to post-#1397 UAT by user decision — the same live session will exercise both |
| 17 | Live UX refinement | DEFERRED | User accepted spec-only coverage 2026-11-04; to run with the #1397 UAT — picker rows, TIF pills, warning copy at real viewport sizes |
| 18 | Live disabled-state scan | DEFERRED | Same deferral — needs a stop-limit-protected position (or confirmation none exists) |

## Findings

- **None in the automated scope.** Every spec-driven scenario passes on the
  current worktree state.
- **Deferred observation (non-blocking):** the replacement ticket always uses
  the *position's* whole quantity, not the target order's quantity — flagged
  in the code review for product confirmation (a partial-coverage stop
  widens on update).
- **Live scenarios 16–18** were partially exercised 2026-11-04: the user ran
  the update flow live and it worked ("it works pretty well"). One real
  defect surfaced from that session — the full `refresh()` on dismissal
  locks the dashboard for ~10-15s — triaged as **BUG #1397** under this
  Blueprint. Remaining live checks (picker UX, warning copy, disabled-state
  scan) are user-deferred to the #1397 UAT cycle, which will exercise the
  same surface. The #887 live probe already validated the primitive's wire
  behavior end to end.
