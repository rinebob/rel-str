**Topic:** Portfolio Allocation  
**Topic Slug:** `portfolio-allocation`  
**Thread:** Allocation Manager Page  
**Thread Slug:** `alloc-manager-page`  
**Issue:** #578  
**Thread Parent:** #577  
**Topic Parent:** #576  
**Domain:** PORTFOLIO  
**Type:** PRD  
**Status:** Approved  
**Created:** 2026-09-26  
**Last Updated:** 2026-09-26  

---

## Problem Statement

The trader runs (and plans to run) multiple trading strategies against the live Robinhood account — signal-driven strategies that accumulate trades as signals occur, and scheduled strategies that kick off on a daily or weekly basis. Today there is no way to earmark capital per strategy, see how much of the account each strategy actually holds, or answer the basic question "is this strategy profitable?"

Positions and orders exist only as a flat broker account view. The Order Ticket carries signal provenance but no strategy-group attribution, so once an order fills there is no durable record of which strategy owns the resulting position. Profitability per strategy cannot be computed, allocation targets cannot be expressed, and there is no place to correct a mis-tagged trade.

## Solution

Add a **Portfolio Allocation Manager** page centered on a new first-class entity: the **Allocation Bucket** — a named strategy group that owns a funding target and aggregates every live trade attributed to it.

**Buckets.** The user creates named buckets, one per strategy group (e.g., "CSP Wheel — megacaps", "LEAP drops"). Each bucket carries a `targetPct` expressed as a percentage of the **current live account value** — targets float with account size, consistent with the existing `maxAllocationPercent` model. A system-managed **Cash bucket** always exists and holds the uninvested remainder; the user moves money into or out of allocations by adjusting bucket targets relative to Cash. Buckets partition the live account; paper trading is entirely out of scope — buckets contain live trades only, never mixed with paper.

**Per-account.** Buckets are scoped to a single Robinhood account — the brokerage login holds several accounts, and each has its own independent allocation structure (its own bucket set, its own Cash bucket, its own Unassigned view). Cash can move between accounts on the RH side; the page reacts to per-account funding changes automatically because targets and drift always derive from the **current** per-account value — there is no local cash ledger to reconcile. Not all accounts are agentic-enabled: `get_accounts` exposes every account with an `agentic_allowed` flag, and the page must **read all accounts**. On non-agentic accounts the full allocation structure works — bucket CRUD and manual assignment are local — but only manual attribution applies, since no order-ticket flow exists there.

**Attribution.** Buckets are strategy groups — the strategy name determines the bucket. Strategy-driven flows (signal accepts, scheduled strategy runs) stamp the strategy name on the Order Ticket automatically; the order ticket also gains an **optional** bucket picker for discretionary trades. Order placement is never gated on picking a bucket — getting trades placed takes priority over attribution. Anything placed untagged lands in an **Unassigned** pseudo-bucket rather than disappearing.

**Post-hoc assignment.** The page lists open positions; from that list (or the Unassigned bucket) the user can assign a bucket to any position after the fact. Assigning retroactively attributes the position's full history to the bucket — it is a normal workflow, not just error correction.

**Correction.** Trades can also be moved between buckets to fix a mis-tag. Every attribution change — initial post-hoc assignment or a move — records the from/to bucket and timestamp so bucket P&L history stays honest.

**Enforcement.** Bucket targets are policy, not walls: an order that would push a bucket past its target produces a **warning on the ticket and a drift indicator on the page** — it does not block submission. Consistent with the existing `maxAllocationPercent` convention.

**Analytics (v1).** Per bucket: realized + unrealized P&L, current exposure vs. target % and target dollars, open/closed position counts, and a per-bucket equity curve. Deeper analytics (win rate, per-instance breakdown, drawdown, cross-bucket comparison) are deferred to a later Thread.

## Page Layout

A dedicated page in the **portfolio-dashboard** feature area that **reuses the dashboard's account-tab pattern** — account tabs on top (one per RH account, including non-agentic ones marked as such), with subtabs inside each account:

- **Buckets subtab** — one row per bucket combining config and analytics: name, target %, target $, exposure $, drift vs. target, realized + unrealized P&L, open/closed counts, status. The Cash bucket is a pinned, non-editable computed row. Row actions: edit target %, rename, retire. A create-bucket affordance lives on this tab (dialog-based; exact controls at blueprint).
- **Positions subtab** — open positions with a bucket column and a per-row **assign bucket** action; Unassigned is this list filtered to unattributed positions. This is the post-hoc assignment surface — the only attribution path on non-agentic accounts.
- **Account header** (inside each account tab, above the subtabs) — current account value, total allocated, cash remainder for that account — the completeness check.

**Bucket detail dialog.** Clicking a bucket row opens a large dialog with a **position carousel**: open it once, then click through every position in the bucket without closing. A dropdown in the dialog switches which bucket's data is shown (view switcher only — assignment happens on the Positions tab, not in this dialog). Header: bucket metadata (name, target, exposure, P&L, counts). Detail section per position: stats/info plus a **"trade chart"** (per-position chart — specification TBD, tracked as a dependency, not defined here). Attribution changes made elsewhere must propagate to this dialog and the tab tables — no stale rows after reassignment.

## User Stories

1. As a trader, I want to create a named Allocation Bucket for a strategy group, so that I can earmark capital for that strategy.
2. As a trader, I want to set a target allocation percent on each bucket, so that each strategy has a defined share of my account value.
3. As a trader, I want the target percent to be a share of my **current** live account value, so that targets stay meaningful as the account grows or shrinks.
4. As a trader, I want a Cash bucket that always exists and holds the uninvested remainder, so that I can move money into or out of strategy allocations explicitly.
5. As a trader, I want to see every bucket's target %, target dollars, current exposure, and drift at a glance, so that I can spot over- and under-allocated strategies.
6. As a trader, I want to rename a bucket without losing its history, so that I can fix naming mistakes.
7. As a trader, I want to retire a bucket so it stops accepting new attributions but keeps its history, so that dead strategies don't clutter the active list but remain auditable.
8. As a trader, I want an optional strategy name / bucket selector on the order ticket, so that orders I choose to tag land in the right bucket — without the ticket ever forcing me to pick one before submitting.
9. As a trader, I want strategy-driven orders (signal accepts, scheduled strategy runs) to be tagged with the strategy name automatically, so that automated flow needs no manual attribution.
10. As a trader, I want positions that can't be attributed to land in an Unassigned bucket, so that nothing silently vanishes from the allocation view.
11. As a trader, I want a list of open positions where I can assign a bucket after the fact, so that trades placed without a tag can be attributed later.
12. As a trader, I want to move a trade between buckets to correct a mis-tag, so that one tagging mistake doesn't permanently corrupt a strategy's P&L.
13. As a trader, I want every attribution change — post-hoc assignment or move — recorded (from bucket, to bucket, timestamp), so that bucket history remains auditable.
14. As a trader, I want a warning when an order would push a bucket above its target, so that I notice drift before submitting — without being blocked.
15. As a trader, I want per-bucket realized P&L, so that I can see whether each strategy is actually making money.
16. As a trader, I want per-bucket unrealized P&L on open positions, so that I can see current exposure quality.
17. As a trader, I want open and closed position counts per bucket, so that I can see how active each strategy is.
18. As a trader, I want a per-bucket equity curve, so that I can see each strategy's trajectory over time.
19. As a trader, I want to drill into a bucket to see its positions and orders, so that I can verify attribution.
20. As a trader, I want buckets plus the Cash bucket to account for the full account value, so that the page is a complete allocation picture.
21. As a trader, I want the page organized as tabs (Buckets, Positions) under an account header, so that I don't scroll through a single long page.
22. As a trader, I want a bucket detail dialog with a position carousel — opened once, click through all the bucket's positions — so that reviewing a strategy's trades doesn't mean reopening dialogs.
23. As a trader, I want a bucket dropdown inside that dialog to switch which bucket I'm viewing, so that I can compare strategies without returning to the table.
24. As a trader, I want account tabs listing all my Robinhood accounts — including non-agentic ones — so that each account has its own allocation structure.
25. As a trader, I want each account's buckets to partition only that account's value, so that allocations never blur across accounts.
26. As a trader, I want the page to reflect funding changes between accounts automatically (via the current account value), so that a cash transfer on the RH side needs no manual reconciliation.
27. As a trader, I want full bucket management and manual assignment on non-agentic accounts, so that strategies I run manually on the RH site are still tracked.

## Acceptance Criteria

### US1–US4 — Bucket CRUD and Cash
- The user can create a bucket with a name (strategy group) and target percent; the bucket persists in Firestore.
- Target percent is interpreted as a percent of the current live account value; the derived target dollars update when the account value changes.
- A Cash bucket always exists, cannot be deleted, and reports the uninvested remainder (account value minus all bucket exposures).
- Editing a bucket's target % shifts the implied allocation between that bucket and Cash; target percents are validated to warn (not block) if they sum above 100%.

### US5–US7 — Bucket list and lifecycle
- The bucket list shows per bucket: name, target %, target $, current exposure $, drift (exposure minus target), and status (active/retired).
- Renaming a bucket preserves all attributed trades and history.
- A retired bucket rejects new attributions (orders cannot select it) but remains visible with full history.

### US8–US10 — Attribution
- The order ticket exposes an **optional** bucket/strategy-name selector; when set, the value is stamped on the ticket. The ticket never requires a selection — submission works with no bucket chosen.
- Orders originating from a strategy flow (signal accept, scheduled strategy instance) carry that strategy's name automatically, mapping to its bucket without user input.
- Orders and positions with no resolvable bucket appear under Unassigned on the page.

### US11–US13 — Post-hoc assignment and correction
- The page lists open positions; any position can be assigned to a bucket from that list or from the Unassigned bucket.
- Post-hoc assignment attributes the position's history to the bucket — it is a normal workflow, not just error handling.
- A trade can also be moved between buckets to correct a mis-tag.
- Every attribution change writes an audit record (from bucket, to bucket, timestamp); the receiving bucket's analytics reflect the change.
- Attribution applies to live trades only — no paper trades appear anywhere on the page.

### US14 — Warn-not-block
- Submitting an order whose resulting exposure would exceed the bucket's target shows a warning naming the bucket, current exposure, target, and projected exposure — the user can still submit.

### US15–US19 — Analytics
- Each bucket shows realized P&L (derived from attributed order history), unrealized P&L on open positions, open and closed counts, and an equity curve.
- Drilling into a bucket lists its attributed positions and orders.

### US20 — Completeness
- Bucket exposures plus the Cash bucket reconcile to the selected account's current live value.

### US21–US23 — Layout and bucket detail
- The page presents a Buckets tab, a Positions tab, and an account header.
- Clicking a bucket row opens a dialog showing bucket metadata in a header and a position carousel in the detail section; the dropdown switches the viewed bucket without closing the dialog.
- Attribution changes are reflected in the dialog and both tabs without requiring a page reload.

### US24–US27 — Multi-account
- Account tabs list every account returned by `get_accounts`, flagging non-agentic ones.
- Buckets, Cash, Unassigned, targets, and all analytics are scoped to the selected account; nothing aggregates across accounts.
- A cash transfer between accounts shows up as changed account value and updated drift/targets on the next refresh — no manual cash entry.
- On non-agentic accounts, bucket CRUD and manual assignment work identically; ticket-side attribution simply has no path to feed.

## Technical Context

- **Live only.** All positions, orders, and fills come from the Robinhood broker via MCP — the broker is authoritative (per ADR-008). Paper trading is out of scope; no paper trades, no `PaperStrategyInstance` coupling, no environment field on buckets.
- **Realized P&L is derived, not served.** Broker positions carry only current unrealized values. Per-bucket realized P&L must be computed from attributed order history (matching buy/sell fills) — the order-attribution path is therefore a hard dependency of the analytics, not a nicety.
- **Local state.** Bucket config and position→bucket attribution records live in Firestore (`portfolio-buckets`, `portfolio-attributions` — see the AGENTS.md naming table). Flat collections with composite IDs preferred.
- **Data freshness.** Position/order data is as fresh as the last MCP fetch; there is no streaming feed. Bucket analytics should label their as-of timestamp.
- **Attribution timing.** Orders placed directly in Robinhood (outside the app) have no ticket and no strategy name — they surface under Unassigned until manually moved.
- **Multi-account.** The brokerage login holds multiple accounts; `get_accounts` returns all of them with an `agentic_allowed` flag. Bucket sets are strictly per-account — no cross-account buckets, no cross-account aggregation on this page. Inter-account cash transfers are observable only as changed per-account values; the page reacts on next refresh (no manual cash ledger).

## System Context

```mermaid
flowchart LR
    Trader([Trader])
    Page[Portfolio Allocation Manager page]
    Ticket[Order Ticket / strategy flows]
    RH[(Robinhood via MCP<br/>positions · orders · fills)]
    FS[(Firestore<br/>buckets (per-account) · position→bucket attributions · audit)]

    Trader --> Page
    Trader --> Ticket
    Ticket -->|strategy name seeds position attribution at fill| FS
    Ticket -->|submit order| RH
    RH -->|positions, order history| Page
    FS -->|bucket config + attribution| Page
    Page -->|drift warning| Ticket
    Page -->|reassign trade| FS
```

## Implementation Decisions

- **AllocationBucket entity** — new first-class Firestore doc: `{ id, accountNumber, name, targetPct, status: ACTIVE|RETIRED, createdAt, updatedAt }`. `accountNumber` scopes the bucket to one RH account — buckets never span accounts. `id` is frozen at creation (`{accountNumber}_{nameSlug}`); renaming updates `name` only so every attribution reference stays intact. `name` is the strategy group key; order tickets resolve bucket by case-insensitive strategy-name match (a stale name lands in Unassigned — post-hoc assignment is the recovery path).
- **Order Ticket gains `strategyName`** (and/or resolved `bucketId`) — optional; stamped automatically by strategy-driven flows, selectable manually otherwise. Never required for submission.
- **PositionAttribution record** — per-position attribution: `{accountNumber}_{instrumentId} → bucketId` + append-only audit history. A bucket owns the instrument's full activity including order history; a fill seeds the record from the ticket's `strategyName`, and post-hoc assignment/moves append `{fromBucketId, toBucketId, at}` events.
- **Unassigned pseudo-bucket** — not a stored doc; a derived view of the selected account's live positions/orders with no resolvable attribution.
- **Cash bucket** — system-managed, undeletable, per account; its exposure is computed (account value − sum of that account's bucket exposures), not stored.
- **Account scoping** — all reads are per-account: the selector drives which positions/orders/value are fetched. `get_accounts` returns every account with `agentic_allowed`; the existing agentic-only filter is bypassed on this page so all accounts are readable. Bucket CRUD and manual assignment work on every account; auto-attribution only flows where order tickets exist (agentic accounts).
- **Post-hoc assignment + reassignment audit** — positions can be assigned a bucket after the fact from an open-positions list, and trades can be moved between buckets; every change appends `{fromBucketId, toBucketId, at}` to the position's attribution record; analytics recompute from current attribution.
- **Warn-not-block** — drift warning computed at ticket time (projected post-order exposure vs. target) and on the page (current exposure vs. target). Extends the existing order-guardrails pattern rather than blocking submission.
- **Seam for testing:** bucket stats are computed behind a single service seam — inputs: bucket config, live positions, attributed order history; outputs: per-bucket exposure, P&L, counts, equity curve. Page and tests consume that seam.

## Testing Decisions

- Test external behavior at the stats/attribution seam — feed fixture positions and order histories, assert per-bucket rollups. Do not test internal grouping mechanics.
- Pure-function tests for drift/warning math and realized-P&L matching, following the `order-guardrails.util.spec.ts` precedent.
- Store/component specs follow the `portfolio-dashboard.store.spec.ts` pattern (SignalStore selectors, fixture data).
- No live MCP calls in unit tests — broker responses stubbed, per existing `RobinhoodMcpObservationService` test conventions.

## Out of Scope

- **Paper trading** — entirely. Buckets contain live trades only.
- Hard gating (blocking orders that exceed a bucket target).
- Heuristic/auto-guessed attribution.
- Automated rebalancing (generating orders to bring buckets to target).
- Extended analytics: win rate, per-instance breakdown, drawdown, cross-bucket comparisons — deferred to a later Thread.
- Cross-account aggregation or cross-account buckets — each account's structure is strictly independent.
- Strategy config CRUD (phases, delta, DTE, scheduling) — that remains the Strategy Builder's job; buckets only own funding attribution.

## Further Notes

- The domain term **Allocation Bucket** (a named strategy group owning a funding target) is new and distinct from the existing **Allocation Unit** (per-trade dollar sizing unit) — CONTEXT.md updated accordingly.
- Live attribution requires the order ticket to carry a strategy name — the ticket schema and strategy-flow stamping are the critical-path dependencies for everything downstream.
