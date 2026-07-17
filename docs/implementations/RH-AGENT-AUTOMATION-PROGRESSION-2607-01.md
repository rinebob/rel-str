# RH Agent Trading Automation Progression

**Status:** Agreed direction; Phase A first
**Updated:** 2026-07-17
**Shared execution workflow:** `RH-AGENT-DIRECT-MCP-EXECUTION-WORKFLOW-2607-01.md`

## Purpose

Define how RH Agent progresses from human-initiated ST trades to unattended strategies without replacing the broker execution and monitoring foundation at each phase.

The destination is unattended automated trading. The safe path is Phase A, then B, then C.

## Shared foundation

All phases use the same direct-MCP execution substrate:

```text
order draft or strategy proposal
→ preflight
→ authorization policy
→ durable intent/ref_id
→ direct broker submission
→ broker synchronization
→ protective stop and exit management
```

The phases differ in who creates the order proposal and who authorizes dispatch. They do not use different broker adapters or persistence models.

## Phase A — Human-initiated trading

A human accepts a current ST signal, selects one candidate, edits order and exit-policy terms, runs preflight, and authorizes placement.

```text
ST signal occurrence
→ human ACCEPT
→ editable order draft
→ human preflight review
→ human order authorization
→ direct MCP placement
```

Phase A proves:

- One configured owner and Agentic account.
- Exact typed preflight and placement without an LLM.
- Durable `ref_id` and broker identity.
- Whole-share regular-hours market entries.
- Account-wide capacity, order, and position monitoring.
- Broker-held stops, manual exits, and a simple synthetic target.
- Management of externally initiated account positions under a default policy.

Phase A does not create orders automatically.

## Phase B — Supervised strategy automation

A deterministic strategy evaluates market data and creates a proposed order draft. The user reviews the proposal and explicitly authorizes each order.

```text
strategy evaluation
→ proposed order draft with evidence
→ deterministic preflight
→ human approval
→ direct MCP placement
```

Phase B adds:

- Strategy identity, version, parameters, and evaluation evidence.
- Scheduled strategy evaluation in the cloud.
- Strategy-specific entry eligibility and price-drift rules.
- Proposed allocation and exit-policy terms.
- Human approval queue and proposal expiry.
- Dry-run and shadow-mode comparison before live proposals.

A strategy proposal consumes no capacity until the human authorizes its exact preflighted intent.

## Phase C — Unattended strategy automation

A user grants a bounded standing authorization to a specific strategy version and configuration. The strategy may authorize eligible intents only within that policy.

```text
scheduled strategy evaluation
→ deterministic proposal
→ strategy and account risk gates
→ standing authorization check
→ direct MCP placement
→ broker monitoring and exits
```

A standing strategy authorization must bound at least:

- Strategy identity and immutable version.
- Eligible symbols or universe.
- Allowed side and order types.
- Allocation-unit limit per order.
- Total strategy and account capacity.
- Trading session and schedule.
- Entry-price or drift constraints.
- Required stop and target policy.
- Expiration and explicit enablement.

Changing the strategy version or material policy terms invalidates the standing authorization.

## Promotion gates

### A to B

Promote only after Phase A demonstrates:

- Reliable unattended MCP authentication for read and policy work.
- Correct order, fill, position, stop, and capacity display.
- Idempotent single-order placement.
- Safe owner-authorized exits.
- Fake-transport regression coverage.

### B to C

Promote one strategy at a time only after it demonstrates:

- Deterministic outputs from fixed inputs.
- Shadow-mode results over a representative period.
- Stable proposal and rejection telemetry.
- Strategy-specific capacity and entry rules.
- Correct behavior during stale data and unavailable dependencies.
- Explicit standing authorization for the exact version.

## Operational boundary

RH Agent is a bridge between indicators/strategies and Robinhood, not a general brokerage platform.

- Robinhood remains the operational source of truth.
- Broker-held stops remain the primary offline protection.
- Unusual broker states are surfaced for direct Robinhood intervention.
- Automation handles the normal, intentionally supported path.
- New recovery machinery is added only after observed recurring failures justify it.

## Deferred strategy capabilities

Add only when a concrete strategy requires them:

- Limit entries and replacement.
- Short equity positions.
- Options and wheel-strategy execution.
- Multiple accounts.
- Concurrent batch authorization.
- Strategy-specific complex order graphs.

## Documentation ownership

- The latest-action workflow owns signal screening and `ACCEPT`/`REJECT` decisions.
- The direct-MCP execution workflow owns order, capacity, broker synchronization, stop, and target behavior shared by all phases.
- This document owns the progression of proposal and authorization responsibility from human to strategy.
