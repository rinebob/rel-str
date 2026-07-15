# Thermo-Nuclear Code Review — Phase 3 Occurrence-Level Decisions

**Date:** 2026-07-15  
**Scope:** Phase 3 changes that make durable ACR decisions source-specific and occurrence-level  
**Status:** Approved — build passes

## Files reviewed

- `src/app/core/common/constants.ts`
- `src/app/features/rh-agent/services/rh-agent.types.ts`
- `src/app/features/rh-agent/services/rh-agent-occurrence-decision.service.ts`
- `src/app/features/rh-agent/stores/rh-agent-occurrence-decision.store.ts`
- `src/app/features/rh-agent/stores/rh-agent-triage.store.ts`
- `src/app/features/rh-agent/stores/rh-agent-group.store.ts`
- `src/app/features/rh-agent/stores/signal-review.facade.ts`
- `src/app/features/rh-agent/pages/chart-review/chart-review.component.ts`
- `src/app/features/rh-agent/pages/agent-order/rh-agent-order.component.ts`
- `firestore.rules`
- `firestore.indexes.json`
- `docs/implementations/RH-AGENT-LATEST-ACTION-WORKFLOW-2607-01.md`

## Findings

### 1. `markRunNotCurrent` does not roll back local state on failure

`RhAgentOccurrenceDecisionStore.markRunNotCurrent` optimistically flips `isCurrentInLatestRun` to `false`, then calls the service. If the service update fails, only `decisionsError` is set; the local cache remains incorrect, so accepted symbols would incorrectly disappear from Order.

**Fix:** Snapshot the previous decisions map and restore it in the error handler.

```ts
const previousDecisions = state.occurrenceDecisions();
const next = { ...previousDecisions };
// ... update next ...
patchState(state, { occurrenceDecisions: next });
occurrenceService.markRunDecisionsNotCurrent(runId).subscribe({
  error: (err) => {
    patchState(state, { occurrenceDecisions: previousDecisions, decisionsError: ... });
  }
});
```

---

### 2. `RhAgentOccurrenceDecisionService.deleteDecisionsForSymbol` is unused and unindexed

The method queries `runId == && symbol ==` without a matching composite index. The store now deletes by known doc IDs via `deleteDecisionIds`, so this method is dead code and a latent runtime risk.

**Fix:** Remove `deleteDecisionsForSymbol` from the service.

---

### 3. Empty `withHooks` block in occurrence-decision store

The store has an `onInit` hook with only a comment. It adds no value and can be removed.

**Fix:** Delete the `withHooks(() => ({ onInit() { /* ... */ } }))` block.

---

### 4. `acceptedSymbols` and `acceptedCount` duplicate the same filter

Both computed values scan all decisions and dedupe by symbol. `acceptedCount` can be derived from `acceptedSymbols`.

**Fix:**

```ts
acceptedCount: computed(() => this.acceptedSymbols().length)
```

---

### 5. Optimistic `userId` lookup in `persistSignalDecisions` is fragile

The store guesses the `userId` from the first cached decision, falling back to an empty string. The real user ID is stamped by the service; the local object should not need a fake value.

**Fix:** Make `userId` optional on the `RhAgentOccurrenceDecision` interface (or use a placeholder constant) so the optimistic local object can omit it.

---

### 6. Order page initializes trade rows before decisions finish loading

`RhAgentOrderComponent.ngOnInit` calls `occurrenceStore.loadDecisionsForRun(latestRun.id)` and immediately calls `initializeTradeRows()`, which reads `occurrenceStore.acceptedSymbols()`. Because the load is async, `acceptedSymbols` is empty on first render.

**Fix:** React to `occurrenceStore.occurrenceDecisions()` in an `effect` and rebuild `tradeRows` whenever accepted symbols change after loading completes.

---

### 7. `currentRunSignals` helper is duplicated

Both `SignalReviewFacade` and `ChartReviewComponent` contain an identical private helper that resolves current-run signals for a symbol using the history-store cache or the signal service.

**Fix:** Extract a shared helper (e.g., a small utility function or a signal-selection helper in `rh-agent-signal.service.ts`) and reuse it.

---

### 8. Legacy `persistedStatuses` / `loadPersistedDecisions` still exists in `RhAgentTriageStore`

Now that occurrence decisions own durable state, the old `rh-agent-triage-decisions` cache in `RhAgentTriageStore` is dead weight. It still performs a Firestore load in `setActiveRun` and has its own rollback logic, which is no longer the source of truth.

**Fix:** Remove `persistedStatuses`, `mergePersistedStatus`, `removePersistedStatus`, and `loadPersistedDecisions` from `RhAgentTriageStore`. Keep `statuses` purely as ephemeral in-memory UI state.

---

### 9. `firestore.indexes.json` includes indexes that no longer match queries

The added occurrence-decision indexes include `timeframe`/`signalType` ordering and `decidedAt` that are no longer used in the service queries (sorting is done in memory). Extra indexes are harmless but create drift.

**Fix:** Replace the occurrence-decision indexes with the minimal set actually required:

- `userId` + `runId`
- `userId` + `symbol` + `isCurrentInLatestRun`
- `userId` + `runId` + `isCurrentInLatestRun` (for `markRunDecisionsNotCurrent`)

---

### 10. `rh-agent-order.component.ts` imports `RhAgentSignalItem` from the wrong module

The component imports `RhAgentSignalItem` from `../../services/rh-agent.service` instead of `../../services/rh-agent.types`. It currently works only if the service re-exports the type, but the dependency is misleading.

**Fix:** Import `RhAgentSignalItem` from `rh-agent.types`.

---

### 11. `resetSignals` / `resetSignalDecisions` method pair is redundant

`resetSignals` merely forwards to `resetSignalDecisions`. The extra layer adds noise.

**Fix:** Rename `resetSignalDecisions` to `resetSignals` and remove the wrapper.

---

## Already fixed during review

- Removed service calls from `RhAgentTriageStore.setStatus` / `setGroupStatus` so the old `rh-agent-triage-decisions` collection is no longer written by the new flow.
- Removed legacy `persistedStatuses`, `loadPersistedDecisions`, `syncStatusesForDate`, and related helper functions from `RhAgentTriageStore`; statuses are now purely ephemeral UI state.
- Fixed `RhAgentOccurrenceDecisionService` query orderBy/index mismatches by sorting results in memory.
- Removed unused `deleteDecisionsForSymbol`, `orderBy`, `Timestamp`, and `chunkArray` from the occurrence-decision service.
- Wired `SignalReviewFacade` accept/reject/reset to update both the occurrence store and the ephemeral triage status.
- Moved Chart Review accept/reject local status updates inside the signal-loaded guard so the UI never updates when there is no signal occurrence.
- Added an `effect` in `RhAgentGroupStore` that keeps `RhAgentTriageStore.statuses` in sync with durable occurrence decisions for the active run.
- Wired the Order page to reactively rebuild trade rows when `occurrenceStore.acceptedSymbols` changes.
- Extracted `getCurrentRunSignalsForSymbol` into `RhAgentSignalService` and removed duplicate helpers from `SignalReviewFacade` and `ChartReviewComponent`.
- Cleaned up `RhAgentOccurrenceDecisionStore`: derived `acceptedCount`, removed empty `withHooks`, collapsed `resetSignals`/`resetSignalDecisions`, fixed optimistic `userId` fallback, and added rollback for `markRunNotCurrent`.
- Fixed `RhAgentSignalItem` import source in `rh-agent-order.component.ts`.
- Aligned `firestore.indexes.json` with the actual occurrence-decision queries.

## Approval Bar

All items addressed; build passes.

- [x] 1. Roll back `markRunNotCurrent` local state on service error
- [x] 2. Remove unused `deleteDecisionsForSymbol`
- [x] 3. Remove empty `withHooks` block
- [x] 4. Derive `acceptedCount` from `acceptedSymbols`
- [x] 5. Avoid fake optimistic `userId`
- [x] 6. Wait for decisions load before building Order rows
- [x] 7. Extract shared `currentRunSignals` helper
- [x] 8. Remove legacy `persistedStatuses` from triage store
- [x] 9. Align Firestore indexes with actual queries
- [x] 10. Fix `RhAgentSignalItem` import in Order component
- [x] 11. Collapse `resetSignals`/`resetSignalDecisions`
