**Topic:** Strategy Builder UI  
**Issue:** #137  
**Domain:** STRAT-BUILD-UI  
**Type:** TEST  
**Area:** SHARED  
**Status:** Complete  
**Created:** 2026-08-16  
**Last Updated:** 2026-08-17  

## E2E journeys

N/A — SHARED layer has no UI. Tested via BE and FE E2E.

## Integration boundaries

- The unified `StrategyInstanceConfig` type must be importable by both `functions/src/` and `src/app/` without errors.
- The BE passes read the flat fields (`optionType`, `side`, `targetDelta`, `dteMin`, `dteMax`) directly from the unified type — no bridge function.

## Unit test targets

### Instance ID generator
- CSP strategy: `250816-QQQM-CSP-020-28-D`
- Covered call: `250816-QQQM-CC-030-21-D`
- Wheel (multi-phase): uses first phase for delta/DTE → `250816-QQQM-CSP-020-28-D`
- Weekly frequency: `250816-SPY-CSP-018-7-W`
- Delta formatting: 0.20 → 020, 0.05 → 005, 0.30 → 030
- DTE from max of first phase's dteMax

### spreadTypeToOptionSide helper
- CSP phase → optionType: PUT, side: SHORT
- Covered call phase → optionType: CALL, side: SHORT
- Unsupported spread type → throws

## Test seams

- ID generator: pure function, test directly
- `spreadTypeToOptionSide`: pure function, test directly

## Edge cases

- Delta = 0 → should format as 000
- Delta > 1 → should be rejected by form validation, but generator should handle gracefully
- DTE min = DTE max → valid (single DTE target)
- No phases → generator throws or returns empty string
- Symbol with special characters → sanitize or reject
