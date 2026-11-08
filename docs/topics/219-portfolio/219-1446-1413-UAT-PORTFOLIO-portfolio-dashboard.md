**Topic:** Portfolio Dashboard  
**Topic Slug:** portfolio  
**Thread:** Load Architecture & Order Surfacing  
**Thread Slug:** load-architecture-order-surfacing  
**Issue:** #1446  
**Thread Parent:** #1403  
**Topic Parent:** #219  
**Task:** #1413  
**Domain:** PORTFOLIO  
**Type:** UAT  
**Status:** Complete — user-verified 2026-11-07 — PASS  
**Created:** 2026-11-07  
**Last Updated:** 2026-11-07  

# UAT — #1413: Peak Since Entry derivation + historicals wiring

QA issue: #1446 — QA: Peak Since Entry derivation + historicals wiring
Review: `219-1407-1413-CODE-REVIEW-PORTFOLIO-portfolio-dashboard.md`
(PASS, 2 rounds, 2 in-gate fixes)

Peaks are store-only data until #1414 renders the column — these
scenarios verify the wiring at the Network layer. The derivation math
(zero-crossing walk, day-granularity peak scan, failure isolation) is
spec-covered (28 tests).

DevTools → Network, filter `get_equity`. Reminder: fills calls ride
`POST /batch` — expand the request payload → `calls[]` to see tool
names + args.

## Scenarios

### 1. Peaks derive after first paint, ungated

- **Steps:** Hard-reload while signed in → Portfolio tab.
- **Expected:** Positions table paints without waiting for peaks work.
  Then: one `POST /batch` whose `calls[]` contains
  `get_equity_orders` with `{account_number, symbol}` — one per equity
  position — followed by `POST /tools/get_equity_historicals` with
  `interval: "day"` and a `start_time` ≈ oldest entry date.
- **Result:** PASS (user-verified)

### 2. Deep entry paginates (margin account, QQQ)

- **Steps:** Same load — watch the margin account (640511655) section
  fill in during the prefetch wave.
- **Expected:** A second `/batch` round for QQQ carrying
  `args.cursor` (its entry predates the 200-order page-1 window —
  confirmed by the pre-implementation probe). Other symbols resolve on
  round 1.
- **Result:** PASS (user-verified)

### 3. Underivable entry → null (margin account, GPRO)

- **Steps:** In the same `/batch` payload, find the `symbol: "GPRO"`
  fills call(s).
- **Expected:** Its response orders carry no `executions` for GPRO
  (transferred position — zero fills anywhere), so derivation emits
  `entryDate: null` → the #1414 column will render `—`. No retry loop,
  no console error.
- **Result:** PASS (user-verified)

### 4. Refresh during in-flight derive still lands peaks

- **Steps:** Reload → immediately click the dashboard refresh action
  (before the historicals call completes — the margin account's
  2-page walk is the slow path; watch for `get_equity_historicals`
  still pending).
- **Expected:** After refresh completes, a *second* fills-walk +
  historicals sequence runs (the `peaksAgain` trailing rerun) — peaks
  populate for the refreshed positions. Not stuck at loading.
- **Result:** PASS (user-verified)

### 5. No regression

- **Steps:** Positions, Open Orders, Order History tabs; switch
  account tabs back and forth.
- **Expected:** Everything renders as before; revisiting the selected
  account issues zero new fills/historicals calls; no new console
  errors.
- **Result:** PASS (user-verified)
