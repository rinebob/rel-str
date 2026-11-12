**Topic:** Portfolio Dashboard  
**Topic Slug:** portfolio  
**Thread:** Load Architecture & Order Surfacing  
**Thread Slug:** load-architecture-order-surfacing  
**Issue:** #1461  
**Thread Parent:** #1403  
**Topic Parent:** #219  
**Task:** #1411  
**Domain:** PORTFOLIO  
**Type:** UAT  
**Status:** Draft  
**Created:** 2026-11-10  
**Last Updated:** 2026-11-10  

# UAT — #1411 Open Orders completeness audit

## Results log

| Date | Result |
|---|---|
| 2026-11-10 | **PASS** — S1 verified by user (OPTION ORDERS group, contract labels, collapsible headers accepted). Remaining scenarios regression-checked by automated suites; no UI anomalies reported. QA cycle added: instrument-grouped tables + contract labels + collapsible groups. |

## Scope

Forensic audit + fixes for silent order-drops in the Portfolio Dashboard:

1. Order lists paginate — fetches now walk `data.next` to exhaustion
   (client `walkPages` + store `runOrdersBatch` round-batched walk).
2. Option orders carry no top-level `side` — side now derived from
   `direction` (`debit`→buy / `credit`→sell) or `legs[].side`; leg
   executions flattened. Previously **every** option order was silently
   dropped — option orders now appear in Order History for the first time.
3. Malformed orders and unrecognized state/type strings now `console.warn`.
4. Open Orders keeps its opening-orders-only scope (intent), now declared
   by an in-UI scope note.
5. **NEW (QA finding):** Orders and History tables group rows by
   instrument — `EQUITY ORDERS` / `OPTION ORDERS` section rows inside the
   table — and option rows show a contract label (`NFLX $15.00 C
   2026-11-20` — chain + strike + C/P + expiry from `legs[]`), not the
   bare underlying ticker that made option rows indistinguishable from
   equity rows.

## Prerequisites

- Dev environment per AGENTS.md (`npm start` / `ng serve`, port 4200).
- A logged-in session whose Robinhood account has order history — the QA
  account used in the captures: 148 equity + 9 option orders, 3 resting
  equity stops (SCHB, RS, MSFT) at capture time.
- Browser devtools open on the Console tab for warn checks.

## Getting to the feature

- **Route:** `/portfolio-dashboard` (Portfolio nav link).
- **Surfaces:** account tabs → **Orders** tab (Open Orders table +
  Order History) and **Equities**/**Options** positions tabs.

## Automated verification (run once, record output)

```bash
npx jest src/app/core/robinhood-mcp/robinhood-mcp-client.service.spec.ts \
  src/app/features/portfolio-dashboard --coverage=false
npx tsc --noEmit -p tsconfig.app.json
```

## Scenarios

### S1 — Option orders appear in Order History, visually separated

**Confirms:** the option-`side` normalization fix + the QA-cycled
instrument-separation UX.
**Start:** logged in, on `/portfolio-dashboard`, select the account.
**Steps:**
1. Open the **History** tab (separate tab — section 3, not a toggle
   inside Orders).
2. Look for an `OPTION ORDERS` group row inside the table, beneath the
   `EQUITY ORDERS` group.
3. Check option rows: the Symbol cell should show a contract label like
   `NFLX $15.00 C 2026-11-20` — NOT the bare `NFLX` ticker, and NOT an
   OCC symbol (RH's API doesn't emit OCC symbols on this endpoint).
**Expected:** up to 9 option rows under `OPTION ORDERS` (all terminal at
capture: 7 cancelled + 2 filled — they appear ONLY in History, never in
Open Orders or Options positions). Side shows buy/sell correctly (debit =
buy, credit = sell). Mark/Dist shows '—' on option rows (known residual —
option legs don't feed the quote fetch yet). An NFLX option row and an
NFLX equity row (if present) are unambiguous. Group headers are
collapsible (chevron toggle; added as the closing QA-cycle request —
spec-covered).
**Result:** PASS — user verified 2026-11-10: option group present with
contract labels; collapsible groups accepted.

### S2 — No "Unrecognized order side" warn storm (pre-fix signature)

**Confirms:** the pre-fix silent-drop signature is gone.
**Steps:** on dashboard load + tab switches, watch the console.
**Expected:** no repeated `Skipped malformed option order ... Unrecognized
order side: undefined` warnings. (Incidental one-off warns for genuinely
malformed records are acceptable but should not repeat per-order.)
**Result:**

### S3 — Open Orders scope note + resting orders

**Confirms:** scope note renders; opening orders visible; stops excluded
by declared design.
**Steps:**
1. Open the **Orders** tab (Open Orders table).
2. Read the muted note above the table.
3. Check whether any resting (live-state) orders appear.
**Expected:** note reads "Opening orders only — closing orders live with
their positions (equity stops on the Equities tab)". Any resting buy
orders appear; the 3 protective stops do NOT appear here. On this
account, expect NO option rows in Open Orders — all 9 option orders are
terminal (S1). An empty Open Orders list with the scope note visible is
correct behavior.
**Result:**

### S4 — Equity stops still live on the Equities tab

**Confirms:** stop surfacing unchanged; UNPROTECTED marker intact.
**Steps:**
1. Open the **Equities** tab.
2. For SCHB / RS / MSFT positions, check the stop columns; check an
   unprotected position shows `UNPROTECTED`.
**Expected:** resting stops render with price/qty; unprotected positions
flagged. (This is the #1414 surface — regression check only.)
**Result:**

### S5 — Multi-account orders via the batched walk

**Confirms:** prefetch waterfall feeds all accounts through
`runOrdersBatch`.
**Steps:** reload the dashboard; switch account tabs (if a second account
exists); check each account's Orders tab populates without errors.
**Expected:** each account shows its own orders; no cross-account bleed;
no console errors.
**Result:**

### S6 — Entry dates / Peak Since Entry intact

**Confirms:** `computeEntryDates` + peaks derivation consume the
now-complete order list without regression.
**Steps:** check a position's Entry date and Peak Since Entry on the
Equities tab for a position held > a few days.
**Expected:** dates/values present and plausible (not blank/NaN).
**Result:**

### S7 — Error path: section failure is visible, not silent

**Confirms:** a failed orders fetch surfaces a section error + retry.
**Steps:** (optional, if throttle/offline simulation is practical) force a
network failure, retry, restore.
**Expected:** the Orders section shows an error + retry affordance rather
than an empty-looking table. Skip if not practical in-session.
**Result:**

## Traceability

| Acceptance criterion | Scenario |
|---|---|
| AC1 — wire contract documented | Audit doc (not a UI scenario) — verified in review |
| AC2 — every state → LIVE/TERMINAL/logged | S2 (no warn storm), S1 (states render) |
| AC3 — NVDA-class root-caused, defect fixed + tested | S1, S3 + automated suites |
| AC4 — findings in audit doc; entry-history flagged | S6 + audit doc |
| Opening-orders scope made visible | S3 |
| Option rows identifiable vs equity (QA finding) | S1 |

## Regression / smoke

- [ ] Equities/Options positions tabs render normally (columns, sorting)
- [ ] Update Stop dialog flow unchanged (dialog dismiss → silent orders
  reconcile — watch for a single orders refetch, not a full reload)
- [ ] Quotes/PnL columns unaffected
- [ ] Account switcher: no stale orders from the previous account
