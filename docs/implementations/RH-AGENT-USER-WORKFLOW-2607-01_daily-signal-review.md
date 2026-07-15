# RH Agent Daily Signal Review and Order Workflow

## Status Note

The active review/order behavior in this document is superseded by `RH-AGENT-LATEST-ACTION-WORKFLOW-2607-01.md`.

The approved model is latest-run-only, with ephemeral review/skip screening: only the latest completed run is actionable and older runs are historical/read-only. Explicit source-specific `ACCEPTED` and `REJECTED` decisions persist immediately; other screening state does not. `EXECUTED` is a future, separate trade-lifecycle state.

## Context

This document records the earlier daily workflow discussion. It covers how signals arrive, how they were proposed to be reviewed, how orders were proposed to be created and sent, and how stale state was proposed to be cleared. It remains useful for unresolved order/execution questions, but it is not the source of truth for active review eligibility or ACR persistence.

## Related Documents

- `RH-AGENT-TIMEZONE-2607-01_pt-timezone-standardization.md` — PT date handling for run IDs, market dates, and chart labels.
- `RH-AGENT-SIGNAL-LIFECYCLE-2607-01_signal-bardate-lifecycle.md` — how interim and historical signals are generated and persisted.

## Goals

1. Ensure the user never acts on stale signals from a previous trading day.
2. Provide a clear review/confirmation step before orders are sent to the market.
3. Manage the volume of signals generated across multiple symbols and timeframes.
4. Make the daily startup state predictable.

## Definitions

| Term | Meaning |
|---|---|
| **Signal** | A strategy output for a symbol/timeframe (daily, weekly, monthly). |
| **Review queue** | Signals awaiting user confirmation before an order is created. |
| **Sent orders** | Orders that have been approved and submitted to the broker/partner. |
| **Unsent orders** | Approved but not yet submitted orders (e.g., held for market open). |
| **Stale signals** | Signals from a previous trading day or superseded by a newer run. |

## Daily Startup

### Trigger

The first run of the new trading day (usually the 8am PRE / PDR run) triggers daily startup cleanup.

### Cleanup actions

1. **Clear review queue.** Remove any signals still pending review from the previous day.
2. **Cancel unsent orders.** Any orders not yet sent to the broker are cancelled or marked obsolete.
3. **Archive sent orders.** Move previous-day sent orders to an archive/history view so they remain visible but are no longer active.
4. **Reset dashboard counters.** Reset any per-day counters (signals generated, orders pending, etc.).
5. **Log the reset.** Record what was cleared so the user can audit.

> **Open decision:** Should cleanup happen automatically on the first PRE run, or should it require a manual "start day" action from the user?

## Signal Arrival and Review

### Sources

Signals arrive from the RH Agent runs:

- **Intraday PRE runs** (8am, 10am, 12pm ET) — daily bars only, all interim.
- **Nightly POST run** — daily bars finalized; weekly/monthly bars finalized only on period-end days.

### Review queue behavior

1. New signals land in the **review queue**.
2. The queue shows the latest signal for each symbol/timeframe.
3. Older signals for the same symbol/timeframe are replaced by newer runs — unreviewed signals simply fall under the bridge.
4. The user can approve, reject, or snooze each signal.
5. Decisions are attached to the symbol/timeframe/signal pattern, not to a specific run. If a PRE run signal is approved and the same signal appears again in a subsequent run, the prior decision is adopted automatically.

### Approval modes

1. **One-by-one.** User explicitly approves each signal. This is the only way orders are created.
2. **Bulk reject.** User selects multiple signals and rejects them as a batch. Rejected signals disappear from the queue.
3. **Auto-adopt prior decision.** If the same symbol/timeframe/signal pattern already has an approved decision from a previous run, the new signal inherits that decision without requiring re-review.

> **Decision:** One-by-one approval is the only path to order creation. Bulk actions are reject-only.

## Order Flow

### After approval

1. Create an order draft from the approved signal.
2. Add the draft to the **unsent orders** list.
3. Allow the user to edit quantity, limit price, or cancel before sending.

### Sending to market

1. User confirms the unsent orders batch.
2. System sends orders to the broker/partner.
3. Sent orders move to the **sent orders** list.
4. Sent orders are logged and archived at the next daily startup.

> **Open decision:** Should orders be sent immediately on approval, or batched and sent on a manual "send" action?

## Dashboard / Run Explorer Actions

The dashboard (run explorer) should provide:

- **Clear review list** button — removes all unreviewed signals from the current queue. Does not affect approved/rejected decisions from prior runs.
- **Bulk reject** button — reject multiple unreviewed signals at once.
- **Show only latest** toggle — hide signals that have been superseded by a newer run.
- **Decision log** — view prior decisions per symbol/timeframe.

## Managing Signal Volume

### Grouping

The review queue can be grouped by:

- **Timeframe** (daily, weekly, monthly).
- **Action** (buy, sell, hold).
- **Confidence or signal strength** (if available).
- **Portfolio / watchlist**.

### Filtering

- Show only daily signals during market hours.
- Show weekly signals on Monday or at week start.
- Show monthly signals at month start.
- Hide rejected signals by default.
- Hide signals whose decision has already been adopted from a prior run.

### Prioritization

- Highlight symbols where the signal has changed since the previous run.
- Highlight end-of-period historical signals (`barStatus = 1`) differently from interim signals.
- Highlight signals that have an inherited decision (auto-adopted).

## State Machine

```
Signal arrives
    |
    v
Review queue
    |
    +-- Rejected --+--> Archived
    |
    +-- Approved --+--> Order draft
                            |
                            v
                    Unsent orders
                            |
                            +-- Cancelled --> Archived
                            |
                            +-- Sent --------> Sent orders
                                                    |
                                                    v
                                            Archived next day
```

## Dashboard Views

1. **Today’s signals.** Latest interim + finalized signals awaiting review.
2. **Unsent orders.** Approved but not yet submitted.
3. **Sent orders today.** Already submitted.
4. **History.** Archived signals and orders from prior days.

## Open Questions

1. Should daily startup cleanup be automatic or manual?
2. Should orders be sent immediately on approval or batched?
3. How do we represent weekly/monthly signals in the review queue when they remain interim for days?
4. Should the user be able to set rules for auto-adoption of prior decisions (e.g., by symbol, timeframe, or confidence)?
5. What happens to approved orders if the user does not send them before market close?
6. If a signal changes (e.g., buy → sell), should the prior decision still be adopted, or require re-review?

## Decisions Needed

1. Confirm the cleanup actions on daily startup.
2. Confirm one-by-one approval as the only path to order creation.
3. Confirm whether orders are sent immediately or batched.
4. Confirm how rejected signals are stored or discarded.
5. Confirm the decision adoption rule: same symbol/timeframe/signal pattern inherits the prior decision.
6. Confirm dashboard actions: clear review list, bulk reject, show only latest.

## Next Steps

1. Expand each section with wireframes or UI flow diagrams.
2. Define the exact data model for review queue, unsent orders, and sent orders.
3. Align with the signal lifecycle doc on when finalized vs. interim signals appear in the queue.
4. Schedule a dedicated workflow review session.
