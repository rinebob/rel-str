**Topic:** Option chain percent change grid  
**Topic Slug:** option-chain-pct-change-grid  
**Thread:** Save param configuration  
**Thread Slug:** save-param-config  
**Issue:** #364  
**Thread Parent:** #361  
**Topic Parent:** #326  
**Domain:** OPTIONS  
**Type:** Implementation Plan  
**Area:** FE  
**Status:** Draft  
**Created:** 2026-09-17  
**Last Updated:** 2026-09-17  

---

# Implementation Plan — FE: Save param configuration

## Scope

FE implementation: pure utility functions, Firestore config service, target type selector component, store changes, and page UI integration.

## Components

### 1. Pure utility functions

**File:** `src/app/features/savant-trader/pages/option-chain-pct-change/utils/pct-change-config.utils.ts`

Three pure functions:

```typescript
/** Resolve target dates from daily bars by scanning for first close
 *  that reaches or exceeds each percentage from the start close. */
export function resolvePctChangeTargets(
  bars: { d: string; c: number }[],
  startDate: string,
  startPrice: number,
  percentages: number[],
): string[]

/** Generate N dates at a fixed interval from the start date. */
export function generateIntervalDates(
  startDate: string,
  count: number,
  intervalDays: number,
): string[]

/** Build a config doc ID: {symbol}-{startDate}-{numberOfTargets}-{targetType}-{uid} */
export function buildConfigId(
  symbol: string,
  startDate: string,
  numberOfTargets: number,
  targetType: TargetType,
  uid: string,
): string
```

### 2. Config service

**File:** `src/app/features/savant-trader/pages/option-chain-pct-change/pct-change-config.service.ts`

Firestore CRUD following the swing-analysis service pattern:

```typescript
@Injectable({ providedIn: 'root' })
export class PctChangeConfigService {
  private readonly firestore = inject(Firestore);

  /** Load all saved configs (one-shot). */
  loadConfigs(): Observable<PctChangeConfigDoc[]>

  /** Save (or overwrite) a config. */
  saveConfig(config: PctChangeConfigDoc): Observable<void>

  /** Delete a config by doc ID. */
  deleteConfig(configId: string): Observable<void>
}
```

Path: `configs/option-chain-pct-change/configs/{configId}`

No user-scoping (single user). No `userId` stamping.

### 3. Target type selector component

**File:** `src/app/features/savant-trader/pages/option-chain-pct-change/components/target-type-selector.component.ts`

Single standalone component with:
- Segmented button group: "Pct Change", "Swing Extremes", "User Dates"
- Sub-mode UI swaps below based on selection:
  - **Pct Change:** toggle List/Gradation
    - List: comma-separated percentage input
    - Gradation: step, count, direction inputs
    - "Resolve" button → calls `resolvePctChangeTargets` with bars from `LocalBarReadService`
    - Resolved dates populate an editable date list
  - **Swing Extremes:** count, deviation, depth, backstep inputs + "Coming soon" message
  - **User Dates:** toggle Manual/Interval
    - Manual: current date entry (existing behavior)
    - Interval: count + interval days inputs → "Generate" → editable date list
- Emits `targetDatesChange` event when dates change
- Emits `targetTypeChange` event when target type changes

### 4. Store changes

**File:** `src/app/features/savant-trader/pages/option-chain-pct-change/option-chain-pct-change.store.ts`

Add to state:
```typescript
targetType: TargetType;
pctMode?: PctMode;
pctValues?: number[];
pctStep?: number;
pctCount?: number;
pctDirection?: PctDirection;
userDatesMode?: UserDatesMode;
intervalCount?: number;
intervalDays?: number;
savedConfigs: PctChangeConfigDoc[];
selectedConfigId: string | null;
```

Add methods:
```typescript
setTargetType(type: TargetType): void
setPctMode(mode: PctMode): void
setPctValues(values: number[]): void
setPctGradation(step: number, count: number, direction: PctDirection): void
setUserDatesMode(mode: UserDatesMode): void
setIntervalParams(count: number, intervalDays: number): void
loadSavedConfigs(): void
selectConfig(configId: string): void  // populates all inputs from saved config
saveCurrentConfig(): void  // builds doc, calls service.saveConfig
deleteConfig(configId: string): void
```

### 5. Page UI changes

**File:** `src/app/features/savant-trader/pages/option-chain-pct-change/option-chain-pct-change.component.html`

Add to the page template:
- Config dropdown (select from `savedConfigs()`)
- "Save" button (calls `saveCurrentConfig()`)
- "Delete" button (calls `deleteConfig()` with confirm)
- Target type selector component (replaces current target dates input section)
- Target dates remain editable after resolution/generation

## Dependencies

- `PctChangeConfigDoc`, `TargetType`, `PctMode`, `UserDatesMode`, `PctDirection` from `shared/pct-change-config-contracts.ts`
- `LocalBarReadService` for daily bars (already injected in store)
- `PctChangeFilter` from existing `pct-change.utils.ts`
- AngularFire Firestore

## Risks

- Store is getting larger. May need to split config state into a separate signal store if it becomes unwieldy. For now, keeping in one store is simpler.
- Target type selector component will need bars data to resolve pct-change targets. Either inject `LocalBarReadService` directly or receive bars as input.

## Test plan

See `326-361-364-TEST-OPTIONS-fe-option-chain-pct-change-grid-save-param-config.md`.
