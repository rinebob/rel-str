**Topic:** Savant Trader — order execution layer, persistence fixes, and rh-agent → savant-trader rename  
**Issue:** #180  
**Topic Parent:** #176  
**Domain:** SAVANT-TRADER  
**Type:** Test Plan  
**Area:** SHARED  
**Status:** Draft  
**Created:** 2026-08-24  
**Last Updated:** 2026-08-24  

---

# Test Plan: SHARED — rename + type model + collection paths

## E2E User Journeys

- Not applicable for SHARED. The rename is mechanical — no user-facing behavior changes. The existing test suite is the E2E gate.

## Integration Tests

- **Build verification:** FE build (`npm run build`) succeeds after rename with no TypeScript errors. All import paths resolve.
- **BE build verification:** BE build (`npm run build` in `functions/`) succeeds after rename with no TypeScript errors.
- **Jest config:** test runner resolves the new `@robinhood-mcp/*` aliases correctly. All existing tests run.

## Unit Tests

- **Collection path helpers:** test the new path helper functions return correct string values:
  - `stOccurrenceDecisionsPath()` → `savant-trader/data/occurrence-decisions`
  - `stOrderIntentsPath()` → `savant-trader/data/order-intents`
  - `stSymbolListsPath()` → `savant-trader/data/symbol-lists`
  - `stSymbolMetaPath()` → `savant-trader/data/symbol-meta`
  - `stRunsPath()` → `savant-trader/data/runs`
  - `stReviewListDocPath()` → `savant-trader/data/review-list`
  - `stTradingConfigDocPath()` → `savant-trader/data/trading-config`
- **OrderIntent type model:** test the discriminated union type narrowing:
  - An `EquityOrderIntent` with `instrumentType: EQUITY` has `symbol` and no `legs`
  - An `OptionOrderIntent` with `instrumentType: OPTION` has `legs` and no `symbol`
  - TypeScript compile-time enforcement (no runtime test needed — the type system enforces this)

## Test Seams

- Highest seam: existing test suite (all specs must pass unchanged after rename)
- Lower seams: pure function tests for path helpers

## Existing Test Coverage

- The existing test suite (~20 spec files in the feature area) covers all current functionality. If any test fails after the rename, it means logic was accidentally changed.
- `backtest-aggregate.utils.spec.ts`, `signal-list.component.spec.ts`, `signal-review-ui.store.spec.ts`, `options-strategy-dashboard.store.spec.ts`, `spread-viewer.store.spec.ts`, `strategy-builder.store.spec.ts`, `strategy-builder-form.component.spec.ts`, `options-strategy-dashboard.component.spec.ts`, `observation-dashboard.model.spec.ts`, `ohlc-datum.utils.spec.ts`, `rh-agent.utils.spec.ts` — all must pass.

## Edge Cases

- **Missed import:** a renamed file that's still imported by its old path somewhere. TypeScript build will fail — this is the safety net.
- **Missed class rename:** a reference to `RhAgentTriageService` that wasn't updated. TypeScript build will fail.
- **Route redirect:** old bookmarks/links to `/rh-agent` etc. will 404. Consider adding redirect routes from old paths to new paths during the transition period (optional, not required).
