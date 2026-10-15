**Topic:** ST Firestore Reorg  
**Topic Slug:** st-firestore-reorg  
**Thread:** Data Plane Consolidation  
**Thread Slug:** data-plane-consolidation  
**Issue:** #988  
**Thread Parent:** #985  
**Topic Parent:** #984  
**Domain:** DATA-PIPELINE  
**Type:** TEST  
**Area:** FE  
**Status:** Draft  
**Created:** 2026-10-14  
**Last Updated:** 2026-10-14  

# TEST — FE (Angular)

## Unit test targets

- `order-ticket.service`: hydration filters (`filled` excluded, `cancelled` requeue preserved), `cancel_pending` handling, migrated-doc reads (`status:'paper'`→mode mapping doesn't break old docs).
- Path constants used by every service — no remaining `savant-trader/` references post-cutover (grep-based spec or lint check).
- Signal gallery reads `st-signals` — INTERIM signals visible.

## Integration boundaries

- Service specs with stubbed Firestore providers (repo convention) per renamed collection.
- Ticket state rendering — `cancel_pending` shows pending UX, `lastError` surfaces.

## E2E journeys (manual/UAT)

1. Gallery → accept → ticket created; no `occurrence-decisions` doc written.
2. Order page: staged/submitted tickets display with new fields; cancel shows pending then cancelled.
3. No "needs review" UI elements remain functional or visible.
4. Portfolio/allocation pages read `st-portfolio` correctly post-rename.

## Edge cases

- Migrated ticket docs (old `source`/`status` fields) render alongside new-schema tickets.
- Symbol-list reads during transition — no flash of empty lists if cut mid-session.
