**Topic:** Strategy Builder UI  
**Issue:** #137  
**Domain:** STRAT-BUILD-UI  
**Type:** TEST  
**Area:** BE  
**Status:** Complete  
**Created:** 2026-08-16  
**Last Updated:** 2026-08-17  

## E2E journeys

- Seed an ACTIVE instance to Firestore → run open pass → verify it processes the instance
- No instances in Firestore → run open pass → verify it logs "no active instances" and exits gracefully
- Instance with PAUSED state → run open pass → verify it is skipped
- Instance with STOPPED state → run open pass → verify it is skipped

## Integration boundaries

- `listActiveInstances()` queries Firestore `options-strategy-instances` collection
- Pass orchestrator calls `listActiveInstances()` and iterates results
- Passes read flat fields (`optionType`, `side`, `targetDelta`, `dteMin`, `dteMax`) directly from the unified config

## Unit test targets

### Strategy instance repository
- `listActiveInstances()` with empty collection → returns []
- `listActiveInstances()` with one ACTIVE instance → returns [instance]
- `listActiveInstances()` with mixed states → returns only ACTIVE
- `listAllInstances()` returns all regardless of state
- `getInstance(id)` with valid ID → returns instance
- `getInstance(id)` with unknown ID → returns null

### Pass orchestrator migration
- Open pass with no active instances → logs warning, exits
- Open pass with one active instance → calls runOpenPass with correct config
- Open pass with PAUSED instance → skips it
- Mark pass queries only ACTIVE instances (existing positions still marked regardless)

## Test seams

- Repository: mock Firestore with fake collection data
- Pass orchestrator: mock `listActiveInstances()` return value, assert pass function calls

## Edge cases

- Firestore collection doesn't exist → returns empty array, not an error
- Instance doc missing required fields → repository should filter or throw
- Multiple instances with same symbol → all processed independently
- Instance with no phases → pass logs warning and skips (phases required for wheel strategies)
