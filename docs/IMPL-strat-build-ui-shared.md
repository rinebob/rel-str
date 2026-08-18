**Topic:** Strategy Builder UI  
**Issue:** #137  
**Domain:** STRAT-BUILD-UI  
**Type:** IMPL  
**Area:** SHARED  
**Status:** Complete  
**Created:** 2026-08-16  
**Last Updated:** 2026-08-17  

## Overview

Unify the two existing `StrategyInstanceConfig` types into a single canonical type shared between BE and FE. Add the `ExitPolicy` enum, `LifecycleState` enum, and instance ID naming convention generator.

## Modules to build/modify

### 1. Unified StrategyInstanceConfig type

Replace the `StrategyInstanceConfig` in `shared/options-strategy-engine-contracts.ts` with the unified shape. The BE registry type in `functions/src/options-strategy-engine/types.ts` is also replaced — it imports from shared.

Unified shape:
```
interface StrategyInstanceConfig {
  id: string;
  symbol: string;
  phases: StrategyInstancePhase[];
  frequency: StrategyFrequency;
  openTimePT: string;
  exitPolicies: ExitPolicyConfig[];
  lifecycleState: LifecycleState;
  marketRegime?: MarketRegime;
  userId: string;
  // Pass-level fields (consumed by BE passes directly)
  deltaTolerance?: number;
  overnightGridRangePct?: number;
  overnightGridStepPct?: number;
  maxOvernightMovePct?: number | null;
  createdAt: string;
  updatedAt: string;
}

interface StrategyInstancePhase {
  spreadType: PositionSpreadType;
  targetDelta: number;
  dteMin: number;
  dteMax: number;
}

interface ExitPolicyConfig {
  policy: ExitPolicy;
  targetGainPct?: number;
  dteExitThreshold?: number;
  stopLossPct?: number;
  trailingStopPct?: number;
  rollDteThreshold?: number;
  rollTargetDelta?: number;
}
```

### 2. ExitPolicy enum

```
enum ExitPolicy {
  HOLD_TO_EXPIRATION = 'HOLD_TO_EXPIRATION',
  WHEEL_IF_ASSIGNED = 'WHEEL_IF_ASSIGNED',
  CLOSE_AT_TARGET_GAIN = 'CLOSE_AT_TARGET_GAIN',
  CLOSE_AT_DTE_THRESHOLD = 'CLOSE_AT_DTE_THRESHOLD',
  TRAILING_STOP = 'TRAILING_STOP',
  STOP_LOSS = 'STOP_LOSS',
  HOLD_SHARES_IF_ASSIGNED = 'HOLD_SHARES_IF_ASSIGNED',
  ROLL = 'ROLL',
  EXIT_AND_REPLACE = 'EXIT_AND_REPLACE',
}
```

### 3. LifecycleState enum

```
enum LifecycleState {
  ACTIVE = 'ACTIVE',
  PAUSED = 'PAUSED',
  STOPPED = 'STOPPED',
}
```

### 4. MarketRegime enum

```
enum MarketRegime {
  BULL = 'BULL',
  BEAR = 'BEAR',
  NEUTRAL = 'NEUTRAL',
}
```

Trend-only for v1. Volatility regime (volatile/calm) is deferred until a volatility source is identified. The values are uppercase to match the `LifecycleState` and `ExitPolicy` enum convention. Note: `base-strategy.ts` uses lowercase `bull | bear | neutral | volatile` — those are a separate concept in the RH Agent signal framework and not reused here.

### 5. Instance ID generator

Pure function that generates the ID from config:
`YYMMDD-{SYMBOL}-{STRATEGY}-{DELTA}-{DTE}-{FREQ}`

Strategy code mapping from `PositionSpreadType`:
- CASH_SECURED_PUT → CSP
- COVERED_CALL → CC
- (future: WHEEL, IC, STRANGLE, etc.)

Delta: 3 digits, decimal removed (0.20 → 020). DTE: max DTE from first phase. Freq: D (daily) or W (weekly).

### 6. PositionSpreadType enum extension

No changes in v1. The enum stays as `CASH_SECURED_PUT` and `COVERED_CALL`. Topic #139 will add new values.

## Cross-area boundaries

- **BE** imports the unified type from `shared/options-strategy-engine-contracts.ts`. The passes read the flat fields (`optionType`, `side`, `targetDelta`, `dteMin`, `dteMax`) directly — no bridge function needed.
- **FE** imports the unified type, `ExitPolicy`, `LifecycleState`, and the ID generator from shared.
- The BE registry type in `functions/src/options-strategy-engine/types.ts` re-exports from shared — all imports point to shared.

## Technical risks

- **Breaking change:** Replacing the shared `StrategyInstanceConfig` changes the shape the BE passes consume. The flat fields remain on the unified type so passes read them directly — no bridge needed.
- **Two type sources:** The BE `types.ts` re-exports `StrategyInstanceConfig` from shared. All BE imports point to shared.

## Testing

- Unit tests for the ID generator covering all spread types, delta formats, DTE values, and frequencies.
- Type-level tests: the unified type must be assignable to both the old BE and old FE usages.
