**Topic:** Signal Pipeline Maintenance  
**Topic Slug:** signal-pipeline-maint  
**Thread:** Misc fixes  
**Thread Slug:** misc-fixes  
**Issue:** #714  
**Thread Parent:** #434  
**Topic Parent:** #433  
**Task:** #706  
**Domain:** SIGNAL-REVIEW  
**Type:** UAT  
**Status:** Complete — PASS  
**Created:** 2026-09-30  
**Last Updated:** 2026-09-30  

# UAT — #706 Anchor + %Δ columns on order-queue rows

## Scope

Queue rows on the signal-order page show three price columns: **anchor** (price at
signal generation / avg cost / order price), **current** live quote, and **%Δ** since
the anchor. Anchor precedence: `signalContext.signalPrice` → `result.fillPrice`
(FILLED rows only) → `stopPrice` → `limitPrice`. `signalPrice` is captured at staging
from the firing bar's `closePrice`. Badges/actions moved to a second row line.

## Prerequisites

- Dev server running: `npm start` → http://localhost:4200 (already running; use it)
- Signed-in session with the agentic account configured
- At least one signal-accepted ticket (stage one via signal-review Accept if empty)
- DevTools for viewport resize (F12 → device toolbar)

## Start

Navigate to the signal-order page (`/trading/live` or Order button from signal-review).

## Scenarios

| # | Scenario | Steps | Expected |
|---|----------|-------|----------|
| 1 | Signal anchor | Stage a signal ticket via signal-review Accept; open signal-order | Row shows anchor = signal bar close (tooltip "At signal"), current live price, signed %Δ |
| 2 | Legacy ticket degrade | A ticket staged before this task (no signalPrice) | Anchor shows its limit price ("Limit") or nothing if no price fields — never "Avg cost", no NaN |
| 3 | Position anchor | Any open-position (FILLED) row | Anchor = RH avg cost (tooltip "Avg cost"), %Δ = gain/loss since entry |
| 4 | Resting stop | Any RH resting stop row | Anchor = stop price (tooltip "Stop"), %Δ = distance from trigger |
| 5 | Missing live price | Before quotes load / symbol with no quote | Anchor still renders, %Δ cell empty — no NaN or "0.0%" junk |
| 6 | Direction coloring | Compare a row whose price rose vs fell since anchor | Up = green, down = red — for buys AND sells |
| 7 | Options row | Any option ticket in queue | No anchor/pct content |
| 8 | Narrow viewport | Resize to <1200px width | Date column hides; row fits 420px column; no horizontal scroll/clip |
| 9 | Line-2 badges | PROTECTED position row; CANCELLED row | PROTECTED badge / Requeue button render on second line under the symbol; Requeue still works |
| 10 | Big prices | Any row with a ≥$1000 price (if present) | Whole-dollar format ($1,235), alignment holds |
| 11 | Regression smoke | Click rows, check/uncheck, select-all, remove, staged aggregates in header | All behave as before; no console errors |

## Automated evidence

- `npx jest src/app/features/savant-trader/components/order-queue src/app/features/savant-trader/pages/signal-order src/app/features/savant-trader/stores/signal-review.facade.spec.ts --coverage=false` — 102 tests green
- Full suite: `npx jest --coverage=false` — 161 suites / 2254 tests green

## Traceability

| AC | Scenarios |
|----|-----------|
| signalPrice captured at staging (graceful omit) | 1, 2 |
| Anchor + current + %Δ with precedence | 1, 3, 4 |
| Direction-colored % | 6 |
| Graceful missing data | 2, 5 |
| Options excluded | 7 |
| Spec coverage | Automated |

## Execution log

| Scenario | Result | Evidence |
|---|---|---|
| 1–11 (manual pass) | PASS | User-approved on live app 2026-09-30 ("uat is approved") |

**Note on scenario 1:** only tickets staged after #706 carry `signalPrice` — pre-existing staged tickets degrade to the limit-price anchor (scenario 2) by design. A backfill/wider staged-group display question was captured as an open item in the inventory.

**QA verdict: PASS** — #706 ready to ship.
