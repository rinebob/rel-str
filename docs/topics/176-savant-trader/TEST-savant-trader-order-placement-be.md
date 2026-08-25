**Topic:** Savant Trader — order execution layer, persistence fixes, and rh-agent → savant-trader rename  
**Issue:** #180  
**Topic Parent:** #176  
**Domain:** SAVANT-TRADER  
**Type:** Test Plan  
**Area:** BE  
**Status:** Draft  
**Created:** 2026-08-24  
**Last Updated:** 2026-08-24  

---

# Test Plan: BE — directory rename + collection constants

## E2E User Journeys

- Not applicable for BE rename. The rename is mechanical — no user-facing behavior changes. The BE build + existing BE tests are the gate.

## Integration Tests

- **BE build verification:** `npm run build` in `functions/` succeeds after rename with no TypeScript errors. All import paths resolve.
- **Cloud Function deployment:** after rename, `firebase deploy --only functions` succeeds. Function names in GCP may or may not change (depends on whether deployed names reference the directory). Verify deployment doesn't break Cloud Scheduler targets.
- **Firestore rules validation:** `firebase deploy --only firestore:rules` succeeds with the new collection paths.

## Unit Tests

- **Collection constant values:** verify the renamed constants produce correct path strings:
  - `ST_RUNS_COLLECTION` → `savant-trader/data/runs`
  - `ST_SYMBOLS_COLLECTION` → `savant-trader/data/symbols`
  - `ST_SYMBOL_LISTS_COLLECTION` → `savant-trader/data/symbol-lists`
  - `ST_STATUS_COLLECTION` → `savant-trader/data/status`
- **Subcollection path construction:** verify paths like `savant-trader/data/symbols/{SYMBOL}/run-ids` and `savant-trader/data/runs/{RUN_ID}/jobs` are constructed correctly with the new parent paths.

## Test Seams

- Highest seam: BE build + deploy (catches all import path issues)
- Lower seam: pure constant value assertions

## Existing Test Coverage

- The BE has existing tests in `functions/` — these must pass after the rename. If any BE test references old collection names or old import paths, it will fail and need updating (mechanical).
- The BE test suite is the primary verification that the rename is purely mechanical.

## Edge Cases

- **Cloud Function deployed names:** if GCP function names contain `rhAgent` (e.g., `rhAgentNightlyRun`), renaming the source directory doesn't automatically rename the deployed function. The function export name in `index.ts` determines the deployed name. If export names stay the same, the deployed function name stays the same — only the source location changes. This is the safe path: move the source, keep the export names.
- **Cloud Scheduler targets:** if Cloud Scheduler jobs target function names that don't change, no update needed. If they target URLs that include the directory name, they need updating. Verify during implementation.
- **Firestore rules for new collections:** `savant-trader/data/order-intents` and `savant-trader/data/trading-config` need rules. Without rules, reads/writes will be denied.
