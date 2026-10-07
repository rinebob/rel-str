**Topic:** On-demand Screenshot Capture  
**Topic Slug:** screenshot-capture  
**Thread:** Screenshot Auto-capture with Orders  
**Thread Slug:** order-lifecycle-capture  
**Issue:** #834  
**Thread Parent:** #826  
**Topic Parent:** #746  
**Domain:** SCREENSHOT  
**Type:** TEST (FE)  
**Status:** Draft  
**Created:** 2026-10-06  
**Last Updated:** 2026-10-06  

# TEST (FE) — Order Lifecycle Auto-Capture

## Unit targets (jest, existing specs extended)

**`order-execution.service.spec.ts`:**
- Successful `type=limit` place → `captureChartSnapshot` invoked once, unawaited, with `event:'order-placed'`, `renderOnly:false`, `refId:{intentRefId}-placed`, `groupId` = intent refId.
- Place response `state='filled'` → `order-filled` fires; `order-placed` does NOT.
- Failed place (review error, place error) → no capture call.
- Capture call rejects → `ExecutionResult` still `success:true` (failure swallowed, order flow unaffected).
- Market order returning `queued` (not yet filled) → `order-placed`? — resolved: no (placed is limit-only); assert only `order-filled`-on-fill or nothing.

**`order-ticket.service.spec.ts`:**
- Ticket creation writes `role:'open'` by default.
- Closing ticket creation writes `role:'close'` + `linkedPositionId` pointing at the opening intent `refId`.
- `signalId` on signal-staged tickets persists to the intent doc.

## Edge cases

- Missing `linkedPositionId` on a `role:'close'` ticket → warn, still allow the order (capture falls back to the close intent's own refId as group root).
- Callable undefined/failure → swallowed; the result object is unchanged.
