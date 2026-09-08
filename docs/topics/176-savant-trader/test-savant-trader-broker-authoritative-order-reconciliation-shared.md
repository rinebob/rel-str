**topic:** savant trader — broker-authoritative order reconciliation  
**issue:** #225  
**topic parent:** #176  
**domain:** savant-trader  
**type:** test plan  
**area:** shared  
**status:** superseded by ADR-008 (Signal Entry Record model)  
**created:** 2026-09-05  
**last updated:** 2026-09-07

---

> **⚠ SUPERSEDED by [ADR-008](../../adr/ADR-008_signal-entry-record.md)**
>
> The Trading Case and Broker Order Mirror contract tests described in this plan were superseded on 2026-09-07. The replacement test surface covers:
>
> - BE normalization of RH order and position responses (already LIVE, task #240).
> - Signal Entry Record creation and field preservation.
> - RH order state display (raw state shown directly, no derived lifecycle mapping).
>
> The detailed sections below remain as historical context.

---

## unit tests

- Trading Case and Case Summary serialization.
- Broker Order identity and role rules.
- Position identity versus Broker Order identity.
- Broker lifecycle state mapping.
- Queued versus Resting versus Submitted semantics.
- Partial-fill quantity calculations.
- Case closure rules.
- Protection coverage and drift calculations.
- Target-exit stub remains non-executable.

## contract tests

- Broker Order normalization accepts instrument-neutral output.
- Equity/ETF fields remain stable for future options adapters.
- Raw broker response can be retained without changing normalized fields.
- Reconciliation snapshot contains order rows, position rows, unmatched rows, and source health.

## acceptance criteria

- Shared types compile without frontend or backend-specific dependencies.
- Same broker order ID is idempotent.
- Same symbol may have multiple Trading Cases without merging them.
- One aggregate Symbol Position can reference multiple Trading Cases.
