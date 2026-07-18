o# RH Agent Direct MCP Execution Workflow

**Status:** Phase 0 legacy retirement complete; direct MCP implementation not started
**Updated:** 2026-07-17
**Related:** `RH-AGENT-LATEST-ACTION-WORKFLOW-2607-01.md`, `RH-AGENT-BROKER-SYNC-SPIKE-2607-01.md`, `RH-AGENT-AUTOMATION-PROGRESSION-2607-01.md`

## Purpose

Define the smallest direct Robinhood MCP workflow that removes manual order transcription while keeping Robinhood as the operational source of truth. This is a trading bridge and monitor, not a replacement brokerage platform.

Phase A supports rapid human-initiated placement and monitoring. Uncommon broker exceptions remain visible and are resolved directly in Robinhood rather than through a comprehensive automatic recovery engine.

## Product boundary

RH Agent owns:

- Converting an accepted current signal into one editable order draft.
- Preflight, exact authorization, direct typed MCP submission, and durable order identity.
- Capacity display and enforcement before increasing exposure.
- Broker order, fill, and position synchronization for the complete configured Agentic account.
- Broker-held protective stops and a simple synthetic target policy.
- Historical typed records sufficient to show what Robinhood reported.

Robinhood owns:

- Authoritative order states, fills, positions, and realized activity.
- Emergency manual intervention through the Robinhood app or site.
- Resolution of unusual conditions that Phase A flags but does not automate.

## Phase A constraints

- One configured Agentic account.
- One configured owner UID.
- One order at a time; no batch placement.
- Accepted current `LONG` signal occurrences are the only entry source.
- Whole-share equity entries only.
- Market entries during regular market hours only.
- No direct `SHORT` to `SELL` mapping and no short-position opening.
- Full and partial manual exits are allowed only against broker-confirmed owned quantity.
- Limit entries, ad-hoc manual entries, multi-account routing, and multi-user roles are deferred.
- The legacy Claude bridge source is removed from the active tree and preserved in archive documents. Robinhood is the emergency fallback.

## Human entry workflow

```text
ACCEPT signal occurrence
→ create editable order draft
→ choose target allocation, stop %, and target %
→ derive whole-share quantity
→ run preflight
→ inspect broker review and current quote
→ authorize exact reviewed terms
→ reserve allocation capacity and persist intent/ref_id
→ place one direct MCP market order
→ persist broker acknowledgement
→ reconcile order and position
```

`ACCEPT` approves a candidate only. It neither reserves capacity nor authorizes an order.

## Order sizing and capacity

The user selects a target dollar allocation. RH Agent converts it to the next higher whole-share quantity because Phase A requires a broker-held stop and the discovered MCP schema does not establish fractional stop-order support.

An Allocation Unit is the configured base dollar exposure. Capacity enforcement uses exact fractional units:

```text
base allocation unit = $100
projected exposure = $108
reserved capacity = 1.08 units
```

Capacity is reserved atomically at authorization, before MCP dispatch. Drafts, accepted signals, and preflight results consume no capacity.

Committed units are based on broker-confirmed entry notional and remain stable until shares exit. Partial exits release allocation proportionally. Active buy orders and every position in the configured account count toward the same limit regardless of origin.

```text
configured limit
− committed positions
− active buy-order reservations
= available capacity
```

`Capacity Full` is a derived UI and authorization condition. It blocks new exposure but does not cancel existing orders or mutate positions.

## Preflight and authorization

Preflight is side-effect free:

1. Validate exact account, symbol, side, quantity, order type, and session constraints.
2. Confirm the signal is an eligible current accepted occurrence.
3. Check available allocation capacity.
4. Call `review_equity_order` with exact typed arguments.
5. Display the signal reference price, current executable quote, drift, calculated quantity, projected exposure, and Robinhood alerts.
6. Fingerprint the reviewed terms and expire the result after 60 seconds.

Phase A displays price drift but does not enforce a drift threshold; the user decides whether the market has moved too far.

Any material edit or expiry requires a new preflight. Authorization applies only to the exact reviewed fingerprint. The backend requires the configured owner UID and checks capacity again before reserving it.

## Durable identity and submission

Before placement:

- Create a unique order-intent/attempt ID.
- Generate and persist one UUID `ref_id` for the logical order.
- Persist exact decimal-string terms, source occurrence, account reference, authorization evidence, and capacity reservation.

After placement:

- Persist the Robinhood broker order ID and returned broker state.
- Never represent submission as a fill or open position.
- On an ambiguous response, do not create a new intent or `ref_id`; reconcile before any retry.
- Use the same `ref_id` if a retry is proven safe.

## Broker synchronization

The authenticated backend synchronizes the complete configured Agentic account, not only RH Agent-originated orders:

- Orders and their broker states.
- Broker-confirmed fills when exposed by the sampled response.
- Every open equity position, including externally initiated positions.
- Closed and realizing activity needed for historical monitoring.

Origin remains provenance only. It never removes a position from capacity or management scope.

The UI shows Robinhood-reported state and supports explicit refresh. One-minute cloud evaluation is used for active target policies after unattended MCP authentication is proven. The browser and laptop are not policy runtimes.

## Stop and target policy

At entry authorization, the user authorizes stop and target percentages. Both are anchored to the broker-confirmed average entry fill price, never to the signal close or preflight quote.

Normal filled-entry path:

```text
entry filled
→ refresh broker quantity and average fill
→ calculate stop and target prices
→ place one GTC stop-market order for the whole-share position
→ confirm broker stop state
→ monitor target once per minute
```

Robinhood does not currently support equity bracket orders, and the discovered MCP schema exposes no OCO relationship. The broker-held stop therefore has priority.

For a long position, the synthetic target triggers when the current executable bid is at or above the configured target:

```text
target bid observed
→ cancel protective stop
→ confirm broker cancellation
→ refresh quote and remaining position
→ if bid remains at/above target, market-sell remaining quantity
→ otherwise restore protection and surface status
```

The target policy prioritizes closing the position over small differences between the target and actual market fill.

## External positions

Every position detected in the configured Agentic account is automatically managed, regardless of source.

An Account Default Position Policy supplies pre-authorized stop and target percentages when no position-specific policy exists:

```text
detect position
→ import broker quantity and average cost
→ count capacity
→ inspect existing sell orders
→ avoid duplicate protection
→ apply account-default policy when needed
→ monitor with all other positions
```

If an externally initiated fractional position cannot receive a stop through the discovered MCP order constraints, it remains visible, capacity-counted, and urgently flagged for direct Robinhood intervention; it is never silently orphaned. If broker state is otherwise ambiguous, RH Agent shows an urgent warning and does not guess.

## Simple exception policy

Phase A automates the normal path only. For persistent partial fills, unexpected order states, failed cancellation, or mismatched quantities:

- Preserve and display the actual broker state.
- Stop additional automated action for that affected order or position when continuing could increase risk.
- Show a clear warning and broker identity.
- Direct the owner to Robinhood for manual intervention.
- Continue read-only reconciliation so the UI can observe the corrected broker state.

Phase A does not add fill-by-fill stop groups, automatic replacement, repricing, or a general recovery state engine.

## Cloud boundary

The browser calls narrow authenticated backend operations. It never receives OAuth tokens, account numbers, or arbitrary MCP tool access.

Cloud requirements:

- Prove unattended Robinhood OAuth token storage and refresh.
- Keep account identity and credentials backend-only.
- Persist policies and broker projections durably.
- Run one-minute policy evaluation independently of browser and laptop state.
- Use narrow allowlisted typed MCP calls and strict response parsers.

The broker-held stop remains effective if RH Agent is offline. Synthetic targets are necessarily best effort and depend on the cloud evaluator.

## Deferred

- Batch placement.
- Limit entries and limit-entry replacement.
- Ad-hoc manual entry UI; retain provenance support as an extension point only.
- Short entries.
- Automated partial-fill recovery.
- Complex order graphs or a local brokerage ledger.
- Global pause and automatic pending-order cancellation.
- Multi-account and multi-user permissions.
- Automatic tax-lot selection.

## Implementation sequence

1. Capture redacted read-only order, quote, and position response shapes; prove unattended cloud authentication.
2. Add strict direct-MCP contracts and fake response fixtures.
3. Add owner/account authorization and minimal order-intent, broker-order, and broker-position persistence.
4. Implement one-order preflight with 60-second fingerprint expiry.
5. Implement whole-share regular-hours market entry with persisted `ref_id`.
6. Implement account-wide order and position refresh plus capacity display.
7. Implement one broker-held stop after confirmed fill.
8. Implement manual full/partial market exits.
9. Implement one-minute synthetic target evaluation.
10. Apply the account-default policy to externally detected positions.
11. **Completed in Phase 0:** remove the legacy `EXECUTED` transition and archive/delete the Claude bridge execution path.

Automated tests use fake MCP transports only. No test may place, review, or cancel a live order.

## Acceptance bar

- [x] `ACCEPT` remains a signal decision and never becomes `EXECUTED`.
- [ ] Only the configured owner and account can mutate trading state.
- [ ] One exact preflighted market entry can be authorized and placed directly through MCP.
- [ ] Intent and `ref_id` exist before dispatch.
- [ ] Broker submission, fill, and position remain distinct.
- [ ] Capacity includes active buys and all account positions regardless of origin.
- [ ] A filled long position receives a broker-confirmed protective stop.
- [ ] Manual exits cannot exceed broker-confirmed quantity.
- [ ] Synthetic targets run in the cloud and use the safe stop-cancel/confirm/market-exit sequence.
- [ ] Externally initiated positions inherit the account-default management policy.
- [ ] Exceptional states are visible and direct the owner to Robinhood without speculative automatic recovery.
- [x] The legacy Claude implementation and operating detail are archived, and executable source is removed from the active tree.
