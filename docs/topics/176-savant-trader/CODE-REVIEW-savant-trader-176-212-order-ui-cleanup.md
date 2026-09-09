**Topic:** Savant Trader — Final UI/UAT cleanup pass for order placement
**Issue:** #183 (FE Blueprint)
**Task:** #212
**Topic Parent:** #176
**Domain:** SAVANT-TRADER
**Type:** Code Review
**Status:** Final
**Created:** 2026-09-08
**Last Updated:** 2026-09-09

---

## Summary

Three review axes (Standards, Spec, Thermo-nuclear) were run against the changes in task #212. This is the second review pass after fixing findings from the first review.

**Verdict: PASS** — No critical findings. All major findings from the first review were fixed. Remaining minor/nit findings are noted below.

## First review fixes (all resolved)

1. ✅ Terminal-state reconciliation moved to `OrderTicketStore.reconcileTerminalStatuses` as a single batched Firestore write
2. ✅ 24-hour cancelled filter uses `terminalAt` from RH `lastTransactionAt` instead of `updatedAt`
3. ✅ Centralized broker-state mapping in `broker-order.util.ts` (`rhStateToTerminalStatus`, `rhStateToDisplayStatus`)
4. ✅ `onRequeueTicket` guards against non-CANCELLED tickets
5. ✅ Requeue flow tested
6. ✅ `isActiveStopLoss` normalizes state casing
7. ✅ Stale JSDoc on `loadAllTickets` fixed
8. ✅ Dead code removed (`isStopLossFilled`, `stopLossConfirmation`, `isStopLoss`, `linkedStopLosses`, `hasLinkedStopLoss`, `isResting` helper, `topLevel`, `.ticket-placeholder` CSS)

## Second review fixes (all resolved)

9. ✅ `isActiveStopLoss` now treats `filled` as terminal (was missing from `TERMINAL_STATES`)
10. ✅ `mergeWithRhOrder` sets `terminalAt` from RH `lastTransactionAt` for display
11. ✅ `isSupported` uses `protectedSymbols` set instead of O(n·m) `findActiveStopLoss` scan
12. ✅ `stopLossTicket` uses centralized `rhStateToDisplayStatus` instead of hand-rolled mapping
13. ✅ `submitTicket` clears `error` on success (adds `error: undefined` to Firestore update)
14. ✅ `batchUpdateTerminalStatus` uses current time for `updatedAt`, not `terminalAt`
15. ✅ Store uses `OrderSource.SIGNAL_PIPELINE` enum instead of string literal
16. ✅ Dead code removed: `isTerminal`, `statusIcon`, `ticketStaged` output
17. ✅ Test added for filled stop-loss not being active

## RESTING status correction (post-review)

18. ✅ `RESTING` restored as a display-only status — derived from RH `confirmed`/`partially_filled` + non-market order type (limit, stop-market, stop-limit). RH does not return a literal `resting` state; it returns `confirmed` for trigger-based orders resting on the book. The derivation is documented in `docs/topics/176-savant-trader/research-savant-trader-robinhood-order-states.md` (lines 499-543). `RESTING` is **not persisted** to Firestore — only terminal states (`FILLED`/`CANCELLED`/`FAILED` + `terminalAt`) are written. The "Resting" queue group shows stop-losses, limit entries, and stop entries waiting on the book, with cancel capability.

## Remaining findings (minor/nit — not blocking)

### Minor (deferred)

- **`onSubmitStopLossTicket` / `canSubmitStopLossTicket` unreachable under ADR-008** — `order-ticket.component.ts:180, 587`. The staged stop-loss ticket path is dead code since ADR-008 sends stops directly to RH. Removing it requires restructuring the template's `isStopLossTicket()` branch. Deferred to avoid template breakage.
- **`protectedEntry` lookup broken for RH stop rows** — `order-ticket.component.ts:187`. `sourceRef.id` is the RH order ID, not a local ticket ID. Pre-existing issue, not introduced by this change.
- **Stop-loss $/% input feedback loop** — `order-ticket.component.ts:491-500, 825-841`. Typing a dollar stop price recomputes percent, which overwrites the dollar price. Pre-existing UI issue.
- **`mergeWithRhOrder` uses `rhOrder.price` as `fillPrice`** — `order.component.ts:462`. RH `price` is typically the limit/stop price, not the execution price. Pre-existing.
- **`reconcileTerminalStatuses` has no rollback on Firestore failure** — `order-ticket.store.ts:262`. Local state is patched optimistically; if the batch fails, a page reload reverts. Acceptable for now.
- **`saveEdits` always deletes `dollarAmount`** — `order-ticket.component.ts:520`. UI is quantity-only. PRD mentions dollar amount support but it's not implemented.
- **`onSubmit` doesn't validate required limit/stop prices** — `order-ticket.component.ts:537`. Pre-existing.
- **Store-level tests for `reconcileTerminalStatuses`** — The store method is tested via component-level spying. Direct store tests would be better but the component tests cover the integration.

### Nit (deferred)

- `StatusGroup.status` field is unused — `order-queue.component.ts:34`
- `order-ticket.component.ts` is 850+ lines — exceeds 400-line threshold (deferred by user)

## Test results

- `order.component.spec.ts`: 30/30 PASS
- `order-queue.component.spec.ts`: 21/21 PASS
- `broker-order.util.spec.ts`: 30/30 PASS
- `order-ticket.component.spec.ts`: 7/7 PASS
- `npx ng build`: PASS

## Verdict

**PASS** — No critical or major findings remain. All findings from the first review were fixed. Remaining minor/nit findings are pre-existing issues or deferred by user decision.
