**Topic:** On-demand Screenshot Capture  
**Topic Slug:** screenshot-capture  
**Thread:** Screenshot Auto-capture with Orders  
**Thread Slug:** order-lifecycle-capture  
**Issue:** #834  
**Thread Parent:** #826  
**Topic Parent:** #746  
**Domain:** SCREENSHOT  
**Type:** IMPL (FE)  
**Status:** Draft  
**Created:** 2026-10-06  
**Last Updated:** 2026-10-06  

# IMPL (FE) — Order Lifecycle Auto-Capture

Thin surface: ticket metadata for backend linkage + the `order-placed`/immediate-fill hook in the manual order path.

## Changes

**`order-ticket.service.ts` / `order-ticket.types.ts`** — intent docs gain:

- `role: 'open' | 'close'` — set at ticket creation; close tickets are created from a position context and carry `role: 'close'`.
- `linkedPositionId: string` — on `role: 'close'` tickets: the opening intent's `refId` (the group root until Position Groups land).
- `signalId` already flows on signal-staged tickets — confirm it lands on the intent doc (it feeds `groupId`).

**`OrderExecutionService.submitEquityOrder`** — after a successful place:

- `type === 'limit'` → unawaited `captureChartSnapshot` call: `{symbol, event: 'order-placed', positionType: 'stock', refId: '{intentRefId}-placed', groupId: '{intentRefId}', intervals: [DAILY, WEEKLY], renderOnly: false}`. Unawaited client call is safe — the request reaches the function and runs to completion server-side even if the tab closes.
- Place response `state === 'filled'` (market/instant) → same call with `event: 'order-filled'`, `refId: '{intentRefId}-filled'` — `order-placed` is skipped.
- Failures swallow: `.catch(() => {})` + console.warn — the ticket flow never sees capture errors.

## Boundaries

- No UI. No detector. `order-filled` for async limit fills and `position-closed` come from the backend intake (separate detector effort calls `captureLifecycleEvent`).
- `positionType: 'stock'` only — the live manual lane is equity-only today.
- The callable path writes the `capturedEvents` entry on the intent doc too — the manifest is backend-side regardless of which surface fired the capture.
