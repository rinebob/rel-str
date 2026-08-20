**Topic:** Strategy Builder UI  
**Issue:** #137  
**Task:** #148 — FE: Strategy Builder list component and route  
**Domain:** STRAT-BUILD-UI  
**Area:** FE  
**Type:** CODE-REVIEW  
**Status:** Complete  
**Created:** 2026-08-18  
**Last Updated:** 2026-08-18

## Summary

Review of Task #148 (Strategy Builder list component and route) against the project coding standards, the PRD/implementation/test plans, and a thermo-nuclear quality pass. This review covers the list component, route registration, and "Manage Strategies" navigation link from the Options Strategy Dashboard.

## Standards

- **PASS:** All new files have `@topic #137` tags (Topic anchor — correct usage).
- **PASS:** Files are small and single-purpose (component: 66 lines, template: 64 lines, SCSS: 95 lines, spec: 250 lines).
- **PASS:** Component follows standalone OnPush pattern consistent with `ObservationDashboardComponent`, `OptionsStrategyDashboardComponent`.
- **PASS:** Component delegates all state to `StrategyBuilderStore` — no business logic in component.
- **PASS:** Template uses Angular control flow (`@if`/`@for`) consistently.
- **PASS:** Routes are protected with `authGuard`, lazy-loaded via `loadComponent`.
- **PASS:** No duplicated types — uses `StrategyInstanceConfig` from `@options-strategy-engine/contracts`.
- **PASS:** No dead code in production files (demo data fully removed before review).
- **MINOR:** `core-routes.ts` has `@topic #108` tag from original creation; modified for #148 but tag not updated. Acceptable — the file predates the topic system and carries its original tag.
- **NIT:** Test mock factory uses `Record<string, any>` for overrides parameter (line 48). This is test-only code and matches the pattern in `options-strategy-dashboard.component.spec.ts`.

## Spec

All 14 acceptance criteria from issue #148 are MET:

| # | Criterion | Status | Reference |
|---|-----------|--------|-----------|
| 1 | Standalone OnPush with external template/styles | MET | strategy-builder.component.ts:18-24 |
| 2 | List table: Instance ID, Symbol, Spread Type, Frequency, Lifecycle State, Exit Policies | MET | strategy-builder.component.html:26-52 |
| 3 | Lifecycle badge: green=ACTIVE, yellow=PAUSED, red=STOPPED | MET | strategy-builder.component.scss:74-89 |
| 4 | Action buttons per row: Edit, Toggle Lifecycle, Delete, View in Dashboard | MET | strategy-builder.component.html:54-57 |
| 5 | "Create New Strategy" button at top | MET | strategy-builder.component.html:5-7 |
| 6 | Empty state when no instances | MET | strategy-builder.component.html:18-21 |
| 7 | Loading spinner while loading | MET | strategy-builder.component.html:14-17 |
| 8 | Error banner on error | MET | strategy-builder.component.html:10-12 |
| 9 | STRATEGY_BUILDER added to AppRoutes enum | MET | interfaces.ts:50 |
| 10 | Route registered with authGuard, lazy-loaded | MET | core-routes.ts:151-165 |
| 11 | "Manage Strategies" button on Options Strategy Dashboard | MET | options-strategy-dashboard.component.html:25-27 |
| 12 | "View in Dashboard" navigates with instance filter | MET | strategy-builder.component.ts:61-65 |
| 13 | Component tests: list rendering, empty, loading, error, badges, actions | MET | strategy-builder.component.spec.ts (15 tests) |
| 14 | FE build passes | MET | `ng build` clean |

### Test plan gaps (deferred)
- E2E journeys (Cypress) not covered — deferred to integration test phase.
- Dialog form tests — deferred to Task #149 (form component not yet built).

## Thermo-nuclear

- **PASS:** Component is thin (66 lines) — only handles navigation, user interactions, and simple display formatting.
- **PASS:** No code judo or spaghetti detected.
- **PASS:** Architectural risk is low — follows established NgRx SignalStore pattern.
- **PASS:** Helper methods (`exitPolicyNames`, `spreadType`) are consistent with `OptionsStrategyDashboardComponent` pattern (lines 93-123).
- **MINOR:** `/new` and `/edit/:id` routes point to the list component as placeholder until Task #149 builds the form. This is a deliberate placeholder — the buttons navigate correctly without hitting the fallback route. Task #149 will swap these to the form component.
- **PASS:** Test quality — tests external behavior (rendering, navigation, store calls), not implementation details. Edge cases for empty `phases` and `exitPolicies` arrays added during review.

## Test results

- `npx jest --testPathPatterns=strategy-builder|options-strategy-dashboard` → 68/68 passing (15 component + 11 dashboard + 42 service/store)
- `ng build --configuration development` → clean
- Full suite: 36 pre-existing failures (environmental — `@angular/core/testing` import errors, parse errors), none in modified files.

## Fixes applied during review

### 1. Removed leftover demo data code
Demo data constants, `demoMode` signal, `displayInstances` computed, and `loadDemoData()` method were removed from the component. The template was updated to use `store.instances()` directly.

- File: strategy-builder.component.ts, strategy-builder.component.html, strategy-builder.component.scss

### 2. Removed dead `.demo-btn` CSS class
Leftover from demo data feature.

- File: strategy-builder.component.scss

### 3. Removed unused `dirname` import
Imported from `path` but never used.

- File: strategy-builder.component.spec.ts

### 4. Added edge case tests for helper methods
Tests for `spreadType()` with empty `phases` array (returns '—') and `exitPolicyNames()` with empty `exitPolicies` array (returns empty string).

- File: strategy-builder.component.spec.ts

## Verdict

**PASS** — all review findings have been addressed.

- Standards: no blocking issues
- Spec: all 14 acceptance criteria met
- Thermo-nuclear: no remaining structural concerns
- Tests: 68/68 passing in affected areas, build clean
