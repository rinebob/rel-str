**Topic:** Option chain percent change grid  
**Topic Slug:** option-chain-pct-change-grid  
**Thread:** Save param configuration  
**Thread Slug:** save-param-config  
**Issue:** #364  
**Thread Parent:** #361  
**Topic Parent:** #326  
**Domain:** OPTIONS  
**Type:** Implementation Plan  
**Area:** SHARED  
**Status:** Draft  
**Created:** 2026-09-17  
**Last Updated:** 2026-09-17  

---

# Implementation Plan — SHARED: Save param configuration

## Scope

Shared TypeScript types and enums for the pct change config feature, consumed by both FE and BE (rules reference the path structure).

## Components

### 1. Config contracts file

**File:** `shared/pct-change-config-contracts.ts`

New file containing:

```typescript
/** How target dates are determined. */
export type TargetType = 'pct-change' | 'swing-extremes' | 'user-dates';

/** Sub-mode for pct-change target type. */
export type PctMode = 'list' | 'gradation';

/** Sub-mode for user-dates target type. */
export type UserDatesMode = 'manual' | 'interval';

/** Direction for gradation pct-change mode. */
export type PctDirection = 'up' | 'down';

/**
 * Persisted pct change config document.
 * Stored at: configs/option-chain-pct-change/configs/{configId}
 * Doc ID: {symbol}-{startDate}-{numberOfTargets}-{targetType}-{uid}
 */
export interface PctChangeConfigDoc {
  symbol: string;
  startDate: string;          // YYYY-MM-DD
  type: OptionType;          // CALL or PUT
  targetType: TargetType;
  targetDates: string[];     // resolved dates (YYYY-MM-DD)

  // pct-change mode
  pctMode?: PctMode;
  pctValues?: number[];      // list mode: [-3, 5, 10]
  pctStep?: number;          // gradation mode: 5
  pctCount?: number;         // gradation mode: 4
  pctDirection?: PctDirection;

  // swing-extremes mode
  zigzagDeviation?: number;
  zigzagDepth?: number;
  zigzagBackstep?: number;
  swingCount?: number;

  // user-dates mode
  userDatesMode?: UserDatesMode;
  intervalCount?: number;
  intervalDays?: number;

  // filters
  filter: PctChangeFilter;
}
```

Re-export `OptionType` from `options-common` and `PctChangeFilter` from the FE utils (or move `PctChangeFilter` to shared if needed — check current location).

## Dependencies

- `OptionType` from `shared/options-common.ts`
- `PctChangeFilter` — currently in FE `pct-change.utils.ts`; if BE needs it, move to shared. For this feature BE only writes Firestore rules, so FE-only consumption is fine.

## Risks

- `PctChangeFilter` lives in FE utils. If BE ever needs to validate filter shape, it would need to move to shared. Not needed now.

## Test plan

See `326-361-364-TEST-OPTIONS-shared-option-chain-pct-change-grid-save-param-config.md`.
