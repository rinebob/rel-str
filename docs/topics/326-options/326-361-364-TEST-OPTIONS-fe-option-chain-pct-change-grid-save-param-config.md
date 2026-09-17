**Topic:** Option chain percent change grid  
**Topic Slug:** option-chain-pct-change-grid  
**Thread:** Save param configuration  
**Thread Slug:** save-param-config  
**Issue:** #364  
**Thread Parent:** #361  
**Topic Parent:** #326  
**Domain:** OPTIONS  
**Type:** Test Plan  
**Area:** FE  
**Status:** Draft  
**Created:** 2026-09-17  
**Last Updated:** 2026-09-17  

---

# Test Plan — FE: Save param configuration

## Unit tests — pure functions

**File:** `src/app/features/savant-trader/pages/option-chain-pct-change/utils/pct-change-config.utils.spec.ts`

### resolvePctChangeTargets
- Returns correct dates for percentages that are reached
- Skips percentages never reached in the bar data
- Returns dates in chronological order
- Handles negative percentages (price drops)
- Handles start date not in bars (uses first bar after start)
- Empty bars array returns empty array
- Single bar reaching multiple percentages returns first date for each

### generateIntervalDates
- Generates correct dates for count=5, interval=5
- Handles count=1 (just start date)
- Handles interval=1 (consecutive days)
- Skips weekends or not (verify intended behavior)
- Start date at end of month crosses correctly

### buildConfigId
- Builds correct ID format: `QQQ-2025-04-07-3-pct-change-abc123`
- Uppercases symbol
- Handles single target
- Handles all three target types

## Unit tests — config service

**File:** `src/app/features/savant-trader/pages/option-chain-pct-change/pct-change-config.service.spec.ts`

- `loadConfigs` returns array of configs from Firestore
- `loadConfigs` returns empty array when no configs exist
- `saveConfig` writes to correct path
- `deleteConfig` removes from correct path
- Error handling for Firestore failures

## Unit tests — target type selector component

**File:** `src/app/features/savant-trader/pages/option-chain-pct-change/components/target-type-selector.component.spec.ts`

- Renders three buttons: Pct Change, Swing Extremes, User Dates
- Clicking a button emits targetTypeChange
- Pct Change mode shows List/Gradation toggle
- List mode shows comma-separated input
- Gradation mode shows step/count/direction inputs
- Resolve button emits resolved dates
- Swing Extremes shows "Coming soon" message
- User Dates shows Manual/Interval toggle
- Interval mode shows count/interval inputs
- Generate button emits generated dates
- Dates are editable after resolution/generation

## Unit tests — store

**File:** `src/app/features/savant-trader/pages/option-chain-pct-change/option-chain-pct-change.store.spec.ts`

- `setTargetType` updates state
- `setPctMode` updates state
- `setPctValues` updates state
- `setPctGradation` updates state
- `setUserDatesMode` updates state
- `setIntervalParams` updates state
- `loadSavedConfigs` populates savedConfigs from service
- `selectConfig` populates all inputs from saved config
- `saveCurrentConfig` calls service with correct doc
- `deleteConfig` calls service and removes from savedConfigs

## E2E journeys

- Save a config → reload page → config appears in dropdown
- Select config from dropdown → inputs populate → modify → run
- Delete config → confirm → config removed from dropdown
- Pct Change list mode → enter percentages → resolve → dates appear → edit → run
- Pct Change gradation mode → enter step/count/direction → resolve → dates appear → run
- User Dates interval mode → enter count/interval → generate → dates appear → edit → run
- Swing Extremes → "Coming soon" displayed

## Edge cases

- Save config with same params (uid prevents collision)
- Delete currently selected config (deselects)
- Resolve pct-change with unreachable percentage (skipped)
- Generate interval dates crossing month boundary
- Load config with missing optional fields (graceful handling)
