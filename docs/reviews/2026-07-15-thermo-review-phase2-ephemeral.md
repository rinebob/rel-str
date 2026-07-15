# Thermo-Nuclear Code Review — Phase 2 Ephemeral Screening

**Date:** 2026-07-15
**Scope:** Phase 2 changes that make review flags and non-decision PACR state ephemeral
**Status:** Approved — blockers addressed

## Findings

### 1. `setStatus` leaves stale durable decisions when downgrading ACCEPT/REJECT to a screening state

`setStatus` only persists when the *new* status is `ACCEPT` or `REJECT`. If a symbol currently has a durable decision and the user sets it to `CONSIDER`, `WATCH`, or `PENDING`, the Firestore decision doc is not deleted. The next `loadPersistedDecisions` will resurrect the stale `ACCEPT`/`REJECT`.

**File:** `src/app/features/rh-agent/stores/rh-agent-triage.store.ts`
**Fix:** In `setStatus`, if the previous status was durable and the new status is not, call `triageService.deleteDecision`. Use the same for `setGroupStatus`.

```ts
const previous = state.statuses()[symbol];
const isDecision = isDurableDecision(status);
const wasDecision = !!previous && isDurableDecision(previous);
// ... patch state ...
if (isDecision) {
  triageService.setDecision(...)
} else if (wasDecision) {
  triageService.deleteDecision(symbol, marketDate)
}
```

---

### 2. `loadPersistedDecisions` leaks previous-run durable statuses into the target run

`setActiveRun` calls `clearEphemeralScreeningState()` (which keeps durable statuses) and then `loadPersistedDecisions(..., marketDate)`. `loadPersistedDecisions` merges decisions for the new date into the existing `statuses` object. Any durable status from the previous run date that is absent in the new date stays visible.

**Files:**
- `src/app/features/rh-agent/stores/rh-agent-triage.store.ts`
- `src/app/features/rh-agent/stores/rh-agent-group.store.ts`
**Fix:** When `currentDate` is provided, reset `statuses` to an empty object before applying the loaded decisions for that date. Run switches should own the target date state; normal navigation should not call `loadPersistedDecisions` with `currentDate`.

---

### 3. `clearEphemeralScreeningState` is the wrong primitive for run switches

The helper keeps durable statuses, which is correct when the user stays on the same run (new-run transition hook) but wrong when the active run changes. `setActiveRun` uses it before loading a different date, creating the leak described in #2.

**File:** `src/app/features/rh-agent/stores/rh-agent-group.store.ts`
**Fix:** Either make `setActiveRun` reset `triageStore.statuses` to `{}` before loading, or add a dedicated `prepareForRun(marketDate)` method that clears statuses and review flags and then loads durable decisions for the target date.

---

### 4. Durable-decision predicate is duplicated

`status === ReviewStatus.ACCEPT || status === ReviewStatus.REJECT` appears in `setStatus`, `setGroupStatus`, `resetSymbol`, and the helper `isDurableDecision`. The helper exists but is not used everywhere.

**File:** `src/app/features/rh-agent/stores/rh-agent-triage.store.ts`
**Fix:** Replace inline checks with `isDurableDecision(...)` everywhere.

---

### 5. `loadPersistedDecisions` scans the loaded decision list twice

It builds the persisted cache in one loop and applies current-date statuses in a second loop. Both loops apply the same filter.

**File:** `src/app/features/rh-agent/stores/rh-agent-triage.store.ts`
**Fix:** Combine into one pass: accumulate persisted and, when `currentDate` matches, populate `currentStatuses`.

---

### 6. `resetSymbol` has a non-atomic optimistic update

It removes the status from local `persistedStatuses` and sets `PENDING` immediately, while the `deleteDecision` call is in flight. If the delete fails, the local state no longer matches Firestore. A reload would re-create the mismatch.

**File:** `src/app/features/rh-agent/stores/rh-agent-triage.store.ts`
**Fix:** Document the optimistic-update policy or move the local removal into the delete success path. At minimum, include a rollback in the error handler so the store reverts to the pre-reset state when persistence fails.

---

### 7. Service still loads non-durable screening docs

`loadDecisionsForDateRange` fetches every decision for the user/date range, even though the store now discards anything that is not `ACCEPT`/`REJECT`. This wastes Firestore reads and bandwidth.

**File:** `src/app/features/rh-agent/services/rh-agent-triage.service.ts`
**Fix:** Add a query filter for `status in [ACCEPT, REJECT]` (requires a composite index) or introduce a dedicated `loadDurableDecisionsForDateRange` method. The Firestore boundary for this feature should live in the service, not in the store filter.

---

## Approval Bar

Address #1, #2, and #3 before merging; they are behavioral bugs. #4–#7 are recommended cleanup.

- [x] 1. Delete durable decision when downgrading to a non-durable status
- [x] 2. Reset statuses when loading decisions for a specific `currentDate`
- [x] 3. Fix run-switch state cleanup so old durable statuses do not leak
- [x] 4. Use `isDurableDecision` everywhere
- [x] 5. Combine the two decision-list scans
- [x] 6. Decide and document the reset optimistic-update policy
- [ ] 7. Filter durable decisions at the service/Firestore boundary

## Notes

- `setStatus` now tracks the previous status, deletes durable docs when downgrading to a non-durable status, and rolls back on persistence failure.
- `setGroupStatus` mirrors the same behavior and uses a new `deleteDecisionsBatch` service helper.
- `loadPersistedDecisions` resets `statuses` to `{}` when a `currentDate` is provided, so old-run durable decisions cannot leak into the target run.
- `setActiveRun` now calls `triageStore.resetForRun()` before loading decisions for the target date, preventing any flash of stale state.
- `resetSymbol` is now a thin wrapper around `setStatus(PENDING)`.
- Item #7 is intentionally deferred: adding a `status in [ACCEPT, REJECT]` query filter requires a new Firestore composite index and is not a Phase 2 behavioral blocker.
