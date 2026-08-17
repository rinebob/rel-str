**Topic:** Strategy Builder UI  
**Issue:** #137  
**Domain:** STRAT-BUILD-UI  
**Type:** IMPL  
**Area:** BE  
**Status:** Draft  
**Created:** 2026-08-16  
**Last Updated:** 2026-08-16  

## Overview

Migrate the BE strategy instance registry from a hardcoded `STRATEGY_INSTANCES` array to a Firestore repository. The nightly passes query Firestore for active instances instead of iterating the hardcoded array.

## Modules to build/modify

### 1. Strategy instance repository

Replace `functions/src/options-strategy-engine/strategy-instance-registry.ts` with a Firestore repository:

- `listActiveInstances()`: queries `options-strategy-instances` collection `where('lifecycleState', '==', 'ACTIVE')`, returns `StrategyInstanceConfig[]`
- `listAllInstances()`: queries all instances (for admin/debugging)
- `getInstance(id)`: fetches a single instance by doc ID

The hardcoded `STRATEGY_INSTANCES` array and `getStrategyInstance()` function are removed. The `toSharedConfig` bridge stays — it transforms the unified config into the narrow shape the passes consume.

### 2. Pass orchestrator migration

In `options-strategy-passes.ts`, each scheduled pass (`optionsOpenPass`, `optionsMarkPass`, `optionsSettlementPass`, `optionsSelectionPass`) currently iterates `STRATEGY_INSTANCES`. Change to:

```
const instances = await listActiveInstances();
for (const instance of instances) {
  // ... existing pass logic
}
```

Each pass queries independently (Approach 1 from grilling). The query is cheap (single-digit docs). No pass function signature changes needed.

### 3. Firestore rules

Add rule for `options-strategy-instances/{instanceId}`:

```
allow read: if request.auth != null;
allow create, update: if request.auth != null && request.auth.uid == request.resource.data.userId;
allow delete: if request.auth != null && request.auth.uid == resource.data.userId;
```

Follows the established pattern for user-scoped CRUD collections (spread-lists, rh-agent-triage-decisions, etc.).

### 4. Seed existing instance

Migrate the current `QQQM-WHEEL` hardcoded instance to a Firestore doc. The instance is a CSP with WHEEL_IF_ASSIGNED exit policy (not a separate "WHEEL" spread type). The doc ID follows the naming convention generated from the first phase's spread type: `250816-QQQM-CSP-020-28-D`. Phase 1 = CASH_SECURED_PUT (delta 0.2, DTE 21-30), Phase 2 = COVERED_CALL (delta 0.3, DTE 21-30) for the post-assignment covered call leg.

## Cross-area boundaries

- Depends on **SHARED** unified type (`StrategyInstanceConfig`, `LifecycleState`).
- The `toSharedConfig` bridge reads `phases[0].spreadType` to derive `optionType`/`side` — unchanged from current behavior.
- FE writes instances to the same Firestore collection — BE reads them.

## Technical risks

- **Pass failure on empty Firestore:** If the collection is empty (no instances), passes should log "no active instances" and exit gracefully, not error. Add a guard.
- **Cold start latency:** Each pass now does a Firestore query before iterating. Add 1-2 seconds to pass runtime. Acceptable for nightly scheduled functions.
- **Migration cutover:** The hardcoded `QQQM-WHEEL` instance must be seeded to Firestore before deploying the BE changes, or the nightly passes will find no instances.

## Testing

- Unit tests for `listActiveInstances()` with mock Firestore (empty, one instance, multiple instances, mixed lifecycle states).
- Unit tests for the pass orchestrator verifying it queries Firestore and iterates results.
- Integration test: seed an instance, run the open pass, verify it processes the instance.
