**Topic:** ST Firestore Reorg  
**Topic Slug:** st-firestore-reorg  
**Thread:** Data Plane Consolidation  
**Thread Slug:** data-plane-consolidation  
**Issue:** #988  
**Thread Parent:** #985  
**Topic Parent:** #984  
**Domain:** DATA-PIPELINE  
**Type:** TEST  
**Area:** SHARED  
**Status:** Draft  
**Created:** 2026-10-14  
**Last Updated:** 2026-10-14  

# TEST — SHARED (contracts, paths, ID builders)

## Unit test targets

- **ID builders** (`st-ids.ts`):
  - `signalOccurrenceId('AAPL','2026-10-14','D_ST_TREND_RIDER_V2_LONG')` → `AAPL_2026-10-14_D_ST_TREND_RIDER_V2_LONG`.
  - `tradeId` — option: `ADPT-260927-sig-CSP-030-45-20261120-P155.00-01`; equity omits contract segments; `{NN}` sequences don't collide same-day.
  - `groupId('ADPT','2026-09-27',1)` → `ADPT-260927-grp-01`.
  - `ticketId` — `liv_`/`pap_` prefix by mode.
- **Mapping helpers**: `signal_pipeline`→`origin:signal`, `position_management`→`origin:management`, `status:'paper'`→`mode:'paper'`, barStatus→INTERIM/CONFIRMED boundary values.
- **Path constants**: all paths have even segment counts (Firestore-valid); anchored paths `{domain}/{kind}/items` well-formed.

## Integration boundaries

- BE `StSignal`/`StOrderTicket` shapes vs FE mirrors — compile-time + shape test (or contract test comparing serialized fixture docs).

## Edge cases

- Doc ID length limits (Firestore 1500 bytes — long signalType + long symbol OK).
- `{NN}` rollover past 99 same-day occurrences.
- `dollarAmount` vs `quantity` mutual exclusivity in terms validation.
