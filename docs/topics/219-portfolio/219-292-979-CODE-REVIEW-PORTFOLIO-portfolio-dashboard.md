**Topic:** Portfolio Dashboard  
**Topic Slug:** portfolio-dashboard  
**Thread:** Portfolio Dashboard — Order Placement  
**Thread Slug:** portfolio-dashboard-order-placement  
**Issue:** #292  
**Thread Parent:** #279  
**Topic Parent:** #219  
**Task:** #979  
**Domain:** PORTFOLIO  
**Type:** Code Review  
**Status:** Complete  
**Created:** 2026-10-13  
**Last Updated:** 2026-10-13  

# Code Review — #979 Open orders: Mark/Dist, select-all bulk cancel, modify

Scope: #979's committed slices (`e10c1fd8`, `4a595c0b` — shipped fused with
#780 and untracked in-flight work) plus the working-tree fix round on top.

## Round 1 — FAIL

Three parallel axes (Standards, Spec, Thermo-nuclear) converged:

**Critical**

- `onModifyOrder` hand-rolled cancel→place: `cancelEquityOrder` success is
  *accepted*, not terminal — placing immediately risks two live orders /
  double-fill, and a `PLACEMENT_UNCONFIRMED` outcome invited a manual
  duplicate. The hardened `updateEquityStopOrder` (await `awaitCancelled`,
  bounded place loop, fill-adjacent abort) had zero production callers.

**Major**

- `isOpeningOrder` hides all sell-side orders incl. live stop-losses —
  **overruled: buys-only is by design** (user, 2026-10-13). Stops live in
  the Equities tab. Documented here as intended behavior, not a defect.
- Sequential bulk cancel + refresh only on success — all-failures is
  exactly when UI/broker diverge.

**Minor / nit**

- `buildModifyOrderTicket` silent `''`/`'0'` fallbacks
- Same-price modify allowed (burns cancel + queue priority for a no-op)
- Dead `MatCheckboxModule` import
- Duplicated equity/option cancel ternary in two handlers
- `markPrice!` non-null assert in dialog template
- Missing specs: `modify-order-ticket.util`, `order-mark.util`
- `as unknown as` spec casts ×5 in the parent spec
- Third `ConfirmDialog` duplicating the option-chain one → hoist to
  `shared/`; deferred (touches a foreign file — follow-up)

## Round 2 — fixes (verified)

- `OrderExecutionService.replaceEquityOrder(accountNumber, orderId,
  ticket, noun)` extracted from `updateEquityStopOrder`; the stop method
  is now a thin delegate (`'stop'` noun). Same `awaitCancelled` gate,
  fill-adjacent abort, bounded 3-attempt place loop with refId reuse,
  `PLACEMENT_UNCONFIRMED`/`PLACEMENT_DEAD` classification, and
  `phase`/`unprotected` result contract.
- `onModifyOrder` → `replaceEquityOrder` with `phase`-mapped snackbars;
  `store.refresh()` on every attempted-mutation path.
- `cancelOne()` helper factored; `onCancelSelected` → `Promise.allSettled`
  + always refresh; `onCancelOrder` same contract.
- `buildModifyOrderTicket` fails fast (`null`) on missing symbol or
  non-positive remainder; caller aborts before cancelling.
- Dialog: same-price rejected in `valid()`; `@if (data.markPrice; as m)`
  replaces the `!` assert.
- `MatCheckboxModule` import removed; bulk bar gated on
  `agenticAllowed() && selectedCount() > 0`; per-cell selection
  affordances already gated.
- Specs added: `order-mark.util` (7 cases), `modify-order-ticket.util`
  (7 cases), `modify-order-dialog` (8 cases), `replaceEquityOrder`
  noun/generalized flow (3 cases). `as unknown as` casts removed — mocks
  hoisted to typed `useValue` variables, no casts at all.

## Verification

- Focused jest: 6 suites, **150/150 pass** (order-execution service,
  modify-order-ticket, order-mark, modify dialog, open-orders table,
  parent component).
- `npx ng build` — clean.

## Verdict — PASS

Critical and major findings resolved; minors addressed or deferred with
a stated reason. Buys-only order filtering is product intent (recorded
above). Deferred: shared `ConfirmDialog` hoist (foreign file ownership).

Next: `/proj qa 219 979`
