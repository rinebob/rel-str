**topic:** savant trader — broker-authoritative order reconciliation  
**issue:** #225  
**topic parent:** #176  
**domain:** savant-trader  
**type:** test plan  
**area:** fe  
**status:** superseded by ADR-008 (Signal Entry Record model)  
**created:** 2026-09-05  
**last updated:** 2026-09-07

---

> **⚠ SUPERSEDED by [ADR-008](../../adr/ADR-008_signal-entry-record.md)**
>
> The test plan below was written for the Trading Case / reconciliation module model. The replacement Signal Entry Record model has a simpler test surface:
>
> - Signal Entry Record creation on signal acceptance.
> - Order submission records the RH order ID on the entry record.
> - Fill results are copied from RH to the entry record.
> - Stop order placement records the RH stop order ID on the entry record.
> - An entry graduates from the signal-order page when filled + stop placed.
> - RH positions and orders are read directly for the Position Management page.
> - Signal success analysis queries entry records and cross-references RH order history.
>
> The detailed sections below remain as historical context.

---

## integration tests

- Firestore-first and Robinhood-first reconciliation produce the same queue projection.
- Delayed source completion does not remove rows from another source.
- Persisted Trading Cases merge with Broker Order mirrors by broker order ID.
- Multiple cases for one symbol produce one aggregate Symbol Position and separate case/order rows.
- Protective Stop appears once and protection metadata appears on the Symbol Position.
- Protection drift requires explicit update action.
- Unmatched Broker Order adoption creates a Trading Case without fabricated signal context.
- Fractional positions expose close capability but not unsupported stop-loss controls.
- Partial-fill quantities preserve requested, cumulative, and remaining values.

## component tests

- Queue groups Submitted, Queued, Resting, Filled, Failed, and Cancelled correctly.
- Broker Order rows are not duplicated by Position rows.
- Source-health warnings disable unsafe mutations when broker data is unavailable.
- Parent Case Summary displays active Broker Order IDs and progress.
- Adoption dialog keeps broker fields read-only and accepts local metadata.

## end-to-end journeys

- Accept signal → create Trading Case → configure → authorize → submit → reconcile Broker Order.
- Add-on entry → aggregate Symbol Position updates while individual Case remains separate.
- Protective Stop → Resting Broker Order → trigger/fill → Position closes and Case Summary updates.
- Cancel and modify → old Broker Order remains historical, replacement becomes active.
- Unmatched Broker Order → Create Trading Case → adopted root ticket and child Broker Order.
