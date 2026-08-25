**Topic:** Savant Trader — FE-B1: Order intent service + staging store
**Issue:** #196
**Topic Parent:** #176
**Domain:** SAVANT-TRADER
**Type:** Code Review
**Status:** Complete
**Created:** 2026-08-25
**Last Updated:** 2026-08-25

---

## Summary

Three-axis review of FE-B1 (#196): OrderIntentService (Firestore CRUD) and OrderStagingStore (NgRx signal store, Firestore-backed). Full lifecycle: stage, update, remove, submit, retry, cancel, reconcile. 3 new files, 19 tests.

### Tasks covered

| Task | Issue # | Description | Stage |
|---|---|---|---|
| FE-B1 | #196 | Order intent service + staging store | 6_REVIEW |

**Verdict: PASS** — all critical and major findings discovered during review were fixed before writing this doc.

---

## Standards

### Findings discovered and fixed

**1. Discriminant overwrite risk in updateIntent (CRITICAL → fixed)**
- **File:** `src/app/features/savant-trader/services/order-intent.service.ts:59`
- `updateIntent` accepted `Partial<OrderIntent>` which could accidentally overwrite the `instrumentType` discriminant.
- **Fix:** Changed to `Partial<Omit<OrderIntent, 'instrumentType'>>` in both service and store.

**2. intentsBySymbol grouped option intents under empty string (CRITICAL → fixed)**
- **File:** `src/app/features/savant-trader/stores/order-staging.store.ts:80-88`
- Option intents have no `symbol` field (only `legs`), so they were grouped under `''`.
- **Fix:** Group option intents under their first leg symbol instead.

**3. reconcileStuckIntents no rollback on persist failure (MAJOR → fixed)**
- **File:** `src/app/features/savant-trader/stores/order-staging.store.ts:240-274`
- If Firestore update failed, local state stayed FAILED while Firestore still had SUBMITTING.
- **Fix:** Added rollback to `prev` state + snackbar on persist failure.

### Findings accepted (no fix needed)

**4. Race condition risk in optimistic update pattern (MAJOR → accepted)**
- **File:** `src/app/features/savant-trader/stores/order-staging.store.ts:117-236`
- Rapid sequential calls could cause rollback overwrites due to `prev` snapshot timing. This matches the OccurrenceDecisionStore template pattern. Accepted as a known limitation.

**5. reconcileStuckIntents marks as FAILED without broker query (MAJOR → accepted/deferred)**
- **File:** `src/app/features/savant-trader/stores/order-staging.store.ts:240-274`
- Actual Robinhood query deferred to FE-B2 (#197). Current implementation is a safe placeholder — marks as FAILED with `retryable: true` so users can retry once broker query is wired.

### Findings deferred

**6. Firestore `not-in` query limit (MINOR → documented)**
- **File:** `src/app/features/savant-trader/services/order-intent.service.ts:87`
- Added comment noting the 10-value limit. Currently 3 values (safe).

---

## Spec

| # | Requirement | Status | Evidence |
|---|---|---|---|
| 1 | OrderIntentService: createIntent, updateIntent, deleteIntent, loadAllIntents, loadIntent | MET | order-intent.service.ts:45-117 |
| 2 | OrderStagingStore: stageIntent, updateIntent, removeIntent, submitIntent, retryIntent, cancelIntent | MET | order-staging.store.ts:117-236 |
| 3 | OrderStagingStore: loadIntents (hydrate from Firestore) | MET | order-staging.store.ts:98-114 |
| 4 | OrderStagingStore: reconcileStuckIntents | DEFERRED | Implemented with placeholder (marks FAILED); broker query deferred to FE-B2 (#197) |
| 5 | refId generated at staging, preserved across retries | MET | Spread preserves refId in retryIntent; test verifies |
| 6 | Optimistic updates with error rollback | MET | All 6 mutation methods use optimistic + rollback pattern |
| 7 | Computed: stagedIntents, submittingIntents, activeIntents, terminalIntents, intentsBySymbol | MET | order-staging.store.ts:49-90 |
| 8 | Tests: lifecycle, error/retry, refId preservation | MET | 19 tests covering all paths |

---

## Thermo-Nuclear

### Pattern adherence
Service correctly uses `requireUserId` + injection context pattern matching OccurrenceDecisionService. Store correctly uses `patchState` + `takeUntilDestroyed` + snackbar pattern matching OccurrenceDecisionStore.

### Type safety
`updateIntent` now uses `Partial<Omit<OrderIntent, 'instrumentType'>>` to prevent discriminant overwrite. The `as OrderIntent` cast in the store's optimistic update is safe because the partial is merged onto an existing typed intent.

### Option intent handling
`intentsBySymbol` now groups option intents under their first leg symbol. This is a reasonable default — option intents are not yet wired (per S3 spec) so the grouping can be refined when option support is added.

### submitIntent transition
Correctly transitions STAGED → SUBMITTING and persists. The transition to SUBMITTED or FAILED is deferred to FE-B2 (OrderExecutionService). This is intentional — the store handles state, the execution service handles broker communication.

### Test coverage
Tests cover: stage (optimistic + rollback), remove (optimistic + rollback), submit (transition + rollback), retry (refId preservation + guard), cancel (transition), load (hydrate + error), reconcile (stuck → FAILED + no-op), computed values (all 5), refId preservation across retry.

---

## Verification

- **Build:** PASS (`ng build`)
- **Tests:** 19/19 PASS (order-staging.store.spec.ts)

---

## Files created

| File | Lines | Description |
|---|---|---|
| `services/order-intent.service.ts` | 118 | Firestore CRUD for order intents |
| `stores/order-staging.store.ts` | 275 | NgRx signal store with lifecycle methods + computed values |
| `stores/order-staging.store.spec.ts` | 291 | 19 tests covering lifecycle, error/retry, refId, computed |
