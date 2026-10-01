# UAT — #592 FE Order ticket: optional bucket selector, warn-not-block, fill-time seeding

**Status:** Complete
**Task:** #592
**QA issue:** #703
**Topic:** Portfolio Allocation (#576)
**Date:** 2026-09-28
**Last Updated:** 2026-09-30

## Scope

Order-ticket bucket integration: optional `Bucket` selector on editable
order tickets (never a submit gate); `bucketId` persisted on the ticket;
over-target warn-not-block in the confirm dialog; fill-time attribution
seeding (`seedFromTicket$`, linkKey = orderId). No auto-stamp —
the user picks the bucket; the signal type displays via the Signal row.

## Prerequisites

- `npm start` dev server; signed in; RH MCP local API up (127.0.0.1:3456).
- The ticket's trading account has **≥1 ACTIVE allocation bucket**
  (create on Portfolio Allocation → Buckets tab if needed).
- For scenario 5: a bucket whose target is small enough that a real
  order would exceed it (low `targetPct`, or a bucket already at/above
  target).
- For scenario 4: an accepted signal ticket (or any SIGNAL_PIPELINE
  ticket) — its `signalContext` carries the signal type (e.g.
  `DAILY_BREAKOUT`).
- For scenario 6: permission to place a small real order (fractional or
  1-share market order) on the ticket's account.

## Scenarios

### 1. Bucket picker renders (editable tickets only)

Signal Order page (nav "Signal Order" → `/trading/live`). Select a
STAGED ticket. A `Bucket` row appears in the form, under Hours: a select
with `Unassigned` first, then each ACTIVE bucket on the ticket's
account. Retired buckets do not appear. On a non-editable ticket
(SUBMITTED/FILLED) no picker shows. Result: **PASS** (user confirmation)

### 2. No bucket selected → submits fine (no gate)

Leave Bucket = Unassigned. Fill qty/price normally → Submit Order →
confirm dialog → Confirm. Order submits to RH (SUBMITTED, broker order
id appears). No gate, no error mentioning bucket. Result: **PASS**
(user confirmation)

### 3. Bucket choice persists on the ticket

Set Bucket to a real bucket. Submit → confirm → submit. In Firestore
(`savant-trader-data/...` ticket doc) the ticket carries
`bucketId` = the bucket's doc id. (DevTools alternative: re-open the
ticket before submit and see the select still holds the value.)
Result: **PASS** (user confirmation)

### 4. Signal ticket shows the signal; bucket starts Unassigned

Accept/stage a signal ticket from signal review. Open it on the order
page — a read-only `Signal` row shows `SIGNAL_TYPE · timeframe ·
direction` (from `signalContext`), and the Bucket select starts at
`Unassigned`. Pick a bucket — the Signal row keeps showing the signal
info; the selection sticks.
Result: **PASS** (user confirmation — found + fixed during QA: signal
name must not appear in the bucket list; bucket list is buckets-only,
signal context is a separate read-only row)

### 5. Over-target → warning, still submittable

Pick a bucket whose exposure + order cost exceeds its target (e.g.
bucket targetPct 5 on a $10k account ≈ $500 target; order $600+).
Submit Order → confirm dialog lists a **warning** line naming the
bucket, current exposure, order cost, projected total, and target
(`Bucket 'X' over target: exposure $… + order $… = $…, target $…`).
It is styled as a warning, not an error; Confirm still submits
successfully. Result: **PASS** (user confirmation — warning text
styling hardened with explicit normal font-style/size on `.warning-item`)

### 6. Fill seeds the position's attribution

After the order from scenario 3 fills (market orders fill near-instant;
Refresh from Broker to reconcile), open Portfolio Allocation →
Positions tab (nav "Portfolio Allocation" → `/portfolio/allocation`)
on the same account: the instrument appears under the picked bucket
(not Unassigned). In Firestore
(`portfolio/attributions/items/{acct}_{symbol}`) the doc's `linkKey`
equals the broker order id. Result: **PASS** (user confirmation)

### 7. Sell fills do not seed

Submit a SELL ticket for an unattributed symbol (or observe an existing
sell fill): no attribution doc is created for it — the instrument
stays unassigned/closes cleanly. (Also covered by unit spec
`order-ticket.store.spec` — record manual observation if exercised.)
Result: **PASS** (unit-covered; user accepted)

### 8. Stale bucketId → Unassigned (edge)

If the picked bucket is retired or deleted between ticket staging and
fill: the picker shows Unassigned for that ticket and the fill seed
no-ops (txn re-verifies ACTIVE + same account). The position stays
Unassigned — reassign from the Positions tab. (Unit-covered; optional
manual.) Result: **PASS** (unit-covered)

## Negative / boundary

- Ticket on an account with zero buckets: picker shows only Unassigned;
  submit unaffected.
- Option/unsupported ticket types are not submittable today — picker
  visible but harmless; seeding is buy-side equity/ETF only.

## Traceability

| AC | Scenario |
|---|---|
| Ticket submits with no bucket (no gate) | 2 |
| Over-target warns naming bucket/exposure/target/projected, submission allowed | 5 |
| Signal context visible; bucket starts Unassigned, user picks | 4 |
| Filled order seeds attribution | 6 |
| Selector optional + ACTIVE-only options | 1, 3 |
| Stale/deleted bucket → Unassigned | 8 |
| Sells don't seed | 7 |

## Regression / smoke

- Guardrail warnings (max units / max allocation / insufficient cash)
  unchanged in the confirm dialog.
- Stop-loss and fractional-close flows unaffected (no picker changes).
- Positions tab assign/move/unassign still works after seeding lands.

## Result

Executed 2026-09-30 on the live dev server — all scenarios PASS by user
confirmation. Mid-QA scope change (user-directed simplification): the
ticket stores `bucketId` directly — no `strategyName` field, no
name-slug resolution, no auto-stamp; the fill-time seed verifies the
bucket doc (exists + ACTIVE + same-account) in the txn. Docs amended
(PRD/IMPL/review/UAT). Focused suites green: 121 suites / 2025 tests.
