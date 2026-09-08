**Topic:** Robinhood Trading UI — Order Ticket write-once model  
**Issue:** #241  
**Topic Parent:** #176  
**Domain:** SAVANT-TRADER  
**Type:** Code Review (Round 3 — re-review after fixes)  
**Status:** Complete  
**Created:** 2026-09-07  
**Last Updated:** 2026-09-08  

---

## Summary

Round 2 found one critical bug: `onModify` passes `result: undefined` to `updateTicket`, but `stripUndefined` dropped `undefined` instead of deleting the Firestore field, leaving a stale `result.orderId` that caused reverted tickets to re-appear as CANCELLED on reload.

Round 3 fixes:

1. **Critical fix:** `OrderTicketService.updateTicket` now generically converts any `undefined` field to `deleteField()` before sending to Firestore, not just `error`. This fixes the `onModify` stale `result.orderId` bug.
2. **Local store fix:** `OrderTicketStore.updateTicket` now explicitly deletes keys with `undefined` values from the local optimistic update (object spread doesn't overwrite with `undefined`).
3. **Removed `deleteField()` cast hack:** `saveEdits()` now passes `undefined` instead of `deleteField() as unknown as string`. Removed the `deleteField` import from the component.
4. **Full `intent` → `ticket` nomenclature rename:** All methods, state fields, variables, comments renamed across 19 files. File `stop-loss-intent.util.ts` → `stop-loss-ticket.util.ts`. Renamed `intentError` → `ticketError`.
5. **Fixed camelCase issues from regex rename:** `isstopLossTicket` → `isStopLossTicket`, `onremoveTickets` → `onRemoveTickets`, etc.
6. **Fixed service docstring:** Corrected `order-tickets` → `order-intents` to match the actual Firestore collection path.

Three review axes ran: Standards, Spec, and Thermo-nuclear. All tests pass. The critical bug is resolved. Remaining findings are deferred major items (file size, view model) and minor/nit cleanup.

## Verdict: PASS

The critical bug is fixed. Remaining findings are deferred architectural items (file size decomposition, view model separation) that should be planned as follow-up tasks, and minor/nit cleanup items.

---

## Findings by severity

### Critical

None. The round 2 critical bug (stale `result.orderId` in Firestore) is resolved.

### Major (deferred — plan as follow-up tasks)

1. **File size violation — `order-ticket.component.ts` (893 lines)**  
   `order-ticket.component.ts:1-893` — far past the 400-line smell threshold.  
   **Deferred:** Split into `StopLossPanelComponent`, `FractionalClosePanelComponent`, `OrderPreviewComponent`, etc.

2. **File size violation — `order.component.ts` (446 lines)**  
   `order.component.ts:1-446` — past the 400-line smell threshold.  
   **Deferred:** Extract `mergeWithRhOrder`/`positionToTicket`/RH-merge logic into a dedicated service.

3. **`OrderTicket` overloaded as UI view model**  
   `order.component.ts:368-405,421-445`, `order-ticket.component.ts:256-291` — `mergeWithRhOrder`, `positionToTicket`, and `stopLossTicket` fabricate `OrderTicket` objects from RH data for display.  
   **Deferred:** Introduce a dedicated `SignalOrderRow` view model.

4. **Duplicate broker-order parsing**  
   `order-execution.service.ts:186-216` — `parseBrokerOrder` still duplicates `normalizeToBrokerOrderSnapshot` in `broker-order.util.ts`.  
   **Deferred:** Refactor `parseBrokerOrder` to reuse the shared helper.

### Minor

5. **`ticketStaged` output declared but never emitted**  
   `order-ticket.component.ts:98` — `readonly ticketStaged = output<string>()` is wired in the parent template but never emitted.  
   **Fix:** Remove the dead output or implement the emission.

6. **`saveEdits` can silently delete `quantity` when zero**  
   `order-ticket.component.ts:536-553` — for non-fractional tickets, `partial.quantity = q > 0 ? String(q) : undefined` deletes the field when quantity is zero. `onRetry` calls `saveEdits()` without the quantity guard.  
   **Fix:** Validate quantity in `onRetry` or avoid passing `undefined` for `quantity`.

7. **`undefined` → `deleteField()` conversion is over-broad**  
   `order-ticket.service.ts:83-106` — any top-level `undefined` in any partial means "delete this field." The `Partial<Omit<OrderTicket, 'instrumentType'>>` signature cannot express this contract.  
   **Fix:** Consider a dedicated `UpdateTicket` type that explicitly marks deletable fields.

8. **Residual staged stop-loss submit path**  
   `order-ticket.component.ts:608-623` — `onSubmitStopLossTicket` still updates and submits an existing staged `stop_loss` doc. ADR-008 invariant 5 says no local child docs.  
   **Fix:** Remove or guard once legacy docs are gone.

### Nit

9. **Store comments still say "Signal Entry Records"**  
   `order-ticket.store.ts:2-16` — inconsistent with `ticket` nomenclature.

10. **Redundant `as` casts remain**  
    `order-ticket.component.ts:290,721,761`, `order.component.ts:444` — `as EquityOrderTicket` / `as OrderTicket` casts.

11. **Test mocks typed as `any`**  
    `order-ticket.store.spec.ts:19-21`, `order-execution.service.spec.ts:15`.

---

## Spec axis — acceptance criteria

| # | Criterion | Verdict |
|---|-----------|---------|
| 1 | Trading Case repository, broker order mirror, reconciliation module, projection adapter removed | MET |
| 2 | `hydrateBrokerPositions` removed from staging store | MET |
| 3 | Order Tickets created when signal accepted and order submitted | MET |
| 4 | Order Tickets preserve signal context, refId, and RH order ID | MET |
| 5 | RH authoritative for fill results — fill data read from RH at display time | MET (per ADR-008) |
| 6 | Stop order state read from RH orders, not persisted as local child doc | MET (per ADR-008) |
| 7 | Entry graduates when filled + stop placed (using RH state) | MET |
| 8 | RH positions and open orders read directly for queue | MET |
| 9 | No duplicate rows from competing position hydration | MET |
| 10 | `OrderIntent` nomenclature replaced with `OrderTicket` | MET |
| 11 | Typecheck, build, and tests pass | MET |

---

## Test results

| Suite | Result |
|-------|--------|
| Typecheck | PASS |
| Angular build (development) | PASS |
| Functions build | PASS |
| Order ticket store spec | 16/16 PASS |
| Order ticket component spec | 7/7 PASS |
| Order component spec | 16/16 PASS |
| Order queue component spec | 17/17 PASS |
| Signal review facade spec | 12/12 PASS |
| Order execution service spec | 15/15 PASS |
| Broker order util spec | 18/18 PASS |

---

## Deferred follow-up tasks

1. Component decomposition: split `order-ticket.component.ts` (893 lines) and `order.component.ts` (446 lines).
2. View model separation: introduce `SignalOrderRow` instead of overloading `OrderTicket`.
3. Deduplicate `parseBrokerOrder` with `normalizeToBrokerOrderSnapshot`.
4. Remove dead `ticketStaged` output.
5. Guard `saveEdits` quantity deletion edge case.
6. Remove or guard `onSubmitStopLossTicket` staged path.
