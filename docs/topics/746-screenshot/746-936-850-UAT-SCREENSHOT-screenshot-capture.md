# UAT — Order exec: order-placed/immediate-fill capture hook (#850)

**Topic:** On-demand Screenshot Capture  
**Topic Slug:** screenshot-capture  
**Thread:** Order Lifecycle Capture  
**Issue:** #936  
**Blueprint:** #843  
**Task:** #850  
**Topic Parent:** #746  
**Domain:** SCREENSHOT  
**Type:** UAT  
**Status:** Complete  
**Created:** 2026-10-09  
**Last Updated:** 2026-10-12  

## Scope

Caller-driven chart capture from the live equity order seam
(`OrderExecutionService.submitEquityOrder`). On a confirmed-live or
synchronously-filled placement the app fires
`captureChartSnapshot` fire-and-forget: `order-placed` for a resting
order, `order-filled` for a synchronous fill; `refId`/`groupId` =
`ticket.refId`; `renderOnly: false` writes SVG+PNG to the bucket.
Capture failures must never affect the order result.

## Prerequisites

- Dev app running (`npm start`) and signed in — the hook lives in the
  Angular app, not functions.
- The working tree must contain the hook (uncommitted at QA time —
  confirm `captureOrderSnapshot` exists in
  `src/app/features/savant-trader/services/order-execution.service.ts`).
- A real, funded RH account for the live scenarios — these place and
  cancel real orders. Use a cheap symbol and a far-below-market limit
  so the order cannot fill.
- Bucket browse: Firebase console → Storage, or `gcloud storage ls`
  against `st-trade-screenshots/`.

## Scenarios

### 1. Unit contract (automated)

`npx jest src/app/features/savant-trader/services/order-execution.service.spec.ts --coverage=false`

Expect 59/59, including the `screenshot capture (#746)` describe:
resting `confirmed` → `order-placed` payload asserted in full; sync
`filled` → `order-filled`; placement failure → no call; capture error →
order result still successful.

### 2. Compile gate (automated)

`npx tsc -p tsconfig.app.json --noEmit` — clean.

### 3. Regression — shared seam (automated)

`npx jest src/app/features/savant-trader/stores/order-ticket.store.spec.ts --coverage=false`

The store's submit/revert logic sits on the same seam — confirms no
behavioral drift.

### 4. Live: resting limit order → `order-placed` artifacts + index docs

- Place a small far-below-market limit buy on a cheap symbol (e.g. 1
  share SCHB at ~10% under market) from any order surface (order
  ticket or portfolio flow).
- Expected: order lands `confirmed`/`queued`; within seconds,
  `st-trade-screenshots/{SYMBOL}/{ticket-refId}/…` contains SVG + PNG
  artifacts for **daily and weekly**, filenames in
  `{SYMBOL}-{PT-date}-{PT-time}-order-placed-stock-{refId6}-{interval}.{svg,png}`
  format — symbol in the basename, timestamp in **Pacific Time**
  (DST-aware `America/Los_Angeles`).
- Expected: `st-screenshots` collection gains one doc **per artifact**
  (daily + weekly), doc id `{SYMBOL}-{PT-date}-{PT-time}-order-placed-{refId6}-{interval}`
  — the same segments as the filename minus extension. Doc fields:
  symbol/event/positionType/interval/refId/groupId/capturedAt/svgPath/pngPath.
- The ticket's `refId` is in the staged intent doc (or the dialog
  ticket builder) — record it from the network call or Firestore.
- **Requires functions deploy** — PT timestamps, symbol-prefixed
  filenames, and per-artifact index docs are new server-side behavior;
  the previously verified run used UTC/symbol-less paths and wrote no
  index docs.
- Cleanup: cancel the order; delete the test artifact prefix in the
  console (or leave — paths are isolated per refId).

### 5. Live: synchronous fill → `order-filled` (optional)

Only if a market order is acceptable: a market buy that fills
synchronously fires `order-filled` instead. Skip if no fill is wanted
— the event-selection logic is covered by unit tests.

### 6. Live: failed placement → no capture

- Attempt an order guaranteed to fail review/place (e.g. quantity
  exceeding buying power, or market closed + regular-hours order).
- Expected: error surfaces to the user as today; **no** new prefix in
  the bucket; the order path reports failure normally.

## Traceability

| Acceptance (rescoped #850) | Scenario |
|---|---|
| resting order → `order-placed` | 1, 4 |
| sync `filled` → `order-filled` | 1, 5 |
| no capture on failure | 1, 6 |
| capture failure swallowed | 1 |
| filenames carry symbol + PT time | 4 (+ screenshot suite) |
| `st-screenshots` index doc per artifact, human-readable id | 4 (+ screenshot suite) |
| spec coverage | 1 |

## Results

| # | Scenario | Result | Evidence |
|---|---|---|---|
| 1 | Unit contract | PASS | jest 59/59 (2026-10-09) |
| 2 | Compile gate | PASS | `tsc` exit 0 |
| 3 | Store regression | PASS | jest 100/100 across order-execution + order-ticket.store (2026-10-09) |
| 4 | Live resting limit → artifacts + index | PASS | user-confirmed (2026-10-12): multiple real resting limit orders produced daily+weekly svg/png under `st-trade-screenshots/{SYMBOL}/{refId}/` with `{SYMBOL}-{PTdate}-{PTtime}-order-placed-stock-{refId}-{interval}` filenames, and per-artifact `st-screenshots` index docs with the matching human-readable ids — verified after the scoped `functions:captureChartSnapshot` deploy |
| 5 | Live sync fill → order-filled | (optional) | |
| 6 | Live failed placement → no capture | | |

## Refinement pass

Not applicable — no user-facing surface (service hook only).
