**Topic:** Options Position Strategy Engine  
**Issue:** #108  
**Domain:** OPTIONS  
**Area:** BE  
**Type:** Implementation Plan  
**Status:** WIP. Criteria #6-#7 (settlement + held-shares + stats rollup) complete. Criteria #8-#9 remain.  
**Created:** 2026-08-13  
**Last Updated:** 2026-08-16

# Implementation Plan: Options Position Strategy Engine (BE)

## Module Layout

New module: `functions/src/options-strategy-engine/`

```
functions/src/options-strategy-engine/
  types.ts                        # StrategyInstanceConfig, Position, PositionStatus, Leg, DailyUpdate, RawQuote
  strategy-instance-registry.ts   # config-driven instance definitions (parallel to strategy-registry.ts, but for
                                   # position-lifecycle configs rather than StrategyAdapter signal strategies)
  sa-quote-client.ts              # wraps two SA endpoints (both backed by Alpha Vantage REALTIME_OPTIONS):
                                   # (1) full chain query with require_greeks=true, used by open-pass for
                                   #     contract selection; (2) per-contract quote lookup, used by nightly-pass
                                   # to mark an already-selected contract without re-fetching the whole chain.
  open-pass.ts                    # onSchedule per configured instance open time — selects + opens a new position
  nightly-pass.ts                 # onSchedule, runs after symbol-data-sync completion — EOD mark updates +
                                   # expiration settlement + assignment/held-shares transition
  position-repository.ts          # Firestore read/write helpers for positions, legs, daily-updates, raw-quotes
```

## Firestore Schema

```
options-strategy-instances/{instanceId}
  # id = "{SYMBOL}-{STRATEGY_CODE}", e.g. "QQQM-WHEEL" — named WHEEL from the start even though phase 1 only
  # implements the CSP leg. Covered-call leg is added to this SAME instance in a later phase; no rename or
  # instance migration needed when that ships.
  - symbol: string
  - spreadType: PositionSpreadType  # enum, phase 1 value: CASH_SECURED_PUT. COVERED_CALL added in a later
                                     # phase (same instance keeps writing this field per active leg type);
                                     # future multi-leg strategies (iron condor, vertical, calendar) reuse the
                                     # existing `SpreadType` enum from shared/spread-contracts.ts instead of
                                     # duplicating it.
  - targetDelta: number
  - dteMin: number
  - dteMax: number
  - frequency: StrategyFrequency     # enum: DAILY, WEEKLY
  - openTimePT: string               # e.g. "12:00"
  - exitCriteria: null            # placeholder field for future phase (percent max profit / return / hold time)
  - createdAt: Timestamp

options-strategy-positions/{positionId}
  # id = "{instanceId}-{openDate}", e.g. "QQQM-WHEEL-2026-08-13". The position id and document persist for
  # the position's ENTIRE lifecycle, including through assignment and any future covered-call legs sold
  # against the resulting shares — new legs are added to /legs, the position id never changes, and since the
  # instance is named WHEEL from the start there's no reconciliation/rename needed when the covered-call
  # phase ships.
  - instanceId: string
  - symbol: string
  - status: PositionStatus        # enum: OPEN, EXPIRED_WORTHLESS, ASSIGNED_HOLDING_SHARES,
                                   #       COVERED_CALL_OPEN (future), CLOSED (future)
  - premiumCollected: number      # set once at open, immutable thereafter
  - capitalRequired: number       # strike * 100 * quantity, informational only (no gating)
  - openDate: string
  - currentValue: number          # option mark while OPEN; share market value while holding shares
  - currentValueAsOf: string      # date of last nightly update
  - unrealizedPnl: number
  - assignment?: { strikePrice: number; underlyingCloseAtExpiration: number; assignedAt: string }
  - shares?: { quantity: number; costBasis: number }
  /legs/{legId}
    # id = "{TYPE}-{strike}-{expiration}", e.g. "PUT-20.00-2026-09-10"
    - type: 'PUT' | 'CALL'
    - side: 'SHORT' | 'LONG'
    - strike: number
    - expiration: string
    - openDate: string
    - closeDate?: string
    - premium: number
    - outcome?: LegOutcome           # enum: EXPIRED_WORTHLESS, ASSIGNED
  /daily-updates/{date}
    - markPrice?: number           # while OPEN
    - underlyingClose: number
  /raw-quotes/{date}
    - raw SA response for the contract touched that day (open selection or nightly mark)

options-strategy-stats/{scope}
  # scope = instanceId (per-strategy/per-symbol stats) or the literal "ALL" (combined across every instance)
  - totalPremiumCollected: number
  - totalRealizedPnl: number
  - totalUnrealizedPnl: number
  - openPositionCount: number
  - closedPositionCount: number
  - assignedCount: number
  - expiredWorthlessCount: number
  - maxDrawdown: number
  - lastUpdated: string
  /equity-curve/{date}
    - cumulativePnl: number          # one point per day, source for the dashboard equity curve chart
```

`options-strategy-stats` is written by the nightly pass (and updated incrementally by the open pass for
premium/position counts) — this is the portfolio-level rollup the dashboard reads for equity curve and
max-drawdown display, separate from the per-position detail in `options-strategy-positions`.

## Scheduling

- **Open pass** (`open-pass.ts`): `onSchedule`, one function iterating all `DAILY`/`WEEKLY` instances due today, per-instance `openTimePT`. Phase 1 has a single instance (`QQQM-WHEEL`, daily, 12:00 PT) — the loop structure supports more without changes.
- **Nightly pass** (`nightly-pass.ts`): triggered after `symbol-data-sync` completion (reuse the `checkSyncRunCompletion` callback pattern from `@c:\aa\projects\rel-str\functions\src\symbol-data-sync\symbol-data-sync.ts:196-226`, or a separate `onSchedule` timed safely after the nightly sync window — to be confirmed once nightly sync's completion signal is inspected during implementation). Performs, per open position: EOD mark update (per-contract quote from SA), and for positions expiring that day, the settlement check against `symbol-data/{symbol}/daily`'s closing bar.

## Data Source Notes

- The `sa-quote-client.ts` stub wraps Alpha Vantage's `REALTIME_OPTIONS` endpoint (https://www.alphavantage.co/documentation/#realtime-options) and is **kept for a future paid AV upgrade**. It is not the planned go-live path.
- **Pivot (2026-08-14):** Go-live data strategy is now **hybrid** — AV EOD historical options (existing $50/mo plan) for contract selection, Robinhood MCP (free) for real-time marks on open positions. This is a separate follow-up topic; this plan is being left in WIP state.
- Underlying closing price for settlement comes from the existing `symbol-data/{symbol}/daily` sync — no new dependency.
- Contract selection reuses the existing `selectOptionContract`/`selectOptionSpread` helpers in `@c:\aa\projects\rel-str\functions\src\common\option-contract-selection.ts`. This module is pure/stateless (operates only on `HistoricalOptionContract[]`, no RH-Agent-specific state) and has been relocated to a neutral shared location so the new engine does not reach into `rh-agent-cloud-function/strategies/`. Existing RH Agent `strategies/` and `backtest/` code now import from the new location (`@c:\aa\projects\rel-str\functions\src\rh-agent-cloud-function\backtest\backtest-simulator.ts:14-15`, `@c:\aa\projects\rel-str\functions\src\rh-agent-cloud-function\strategies\base-strategy.ts:9`).

## Key Risks

- AV `REALTIME_OPTIONS` requires a subscription upgrade ~4x current cost; `sa-quote-client.ts` is a future path only.
- Robinhood MCP real-time option-quote shapes are still being discovered and will be addressed in the follow-up hybrid topic.
- Firestore write costs: subcollections (`legs`, `daily-updates`, `raw-quotes`) per position are per-day-per-position — acceptable at planned scale (1 position/day, one symbol initially).

## Out of Scope (BE, this phase)

- Real broker order submission (no Robinhood MCP calls).
- Capital gating logic.
- Exit-criteria evaluation logic (config field exists, unused).
- Covered-call leg creation logic (schema supports it via `/legs`, but no code writes a CALL leg yet).
