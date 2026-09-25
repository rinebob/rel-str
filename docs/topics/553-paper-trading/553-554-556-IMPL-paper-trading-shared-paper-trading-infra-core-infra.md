**Topic:** Paper Trading Infra  
**Topic Slug:** paper-trading-infra  
**Thread:** Core Infra  
**Thread Slug:** core-infra  
**Issue:** #556  
**Thread Parent:** #554  
**Topic Parent:** #553  
**Domain:** PAPER-TRADING  
**Type:** IMPL  
**Status:** Complete  
**Created:** 2026-09-24  
**Last Updated:** 2026-09-25  

# Implementation Plan: Paper Trading Infra — SHARED (contracts)

## Scope

Shared TypeScript contracts for the paper-trading engine, consumed by both the Cloud Functions backend and the Angular frontend. Extends the conventions in `shared/options-strategy-engine-contracts.ts` and `shared/options-common.ts` (OCC IDs, `OptionType`, `TradeSide`, `OptionQuote`).

## Firestore layout

Single root collection `paper-trading` containing kind anchor docs; each anchor owns one `items` subcollection:

```
paper-trading/accounts/items/{acctId}
paper-trading/instances/items/{instId}
paper-trading/cohorts/items/{cohortId}
paper-trading/trades/items/{tradeId}
paper-trading/stats/items/{scope}
paper-trading/raw-quotes/items/{rqId}
```

Anchor docs are near-empty markers (may carry `count`, `lastPassAt`). The single anchor-per-kind structure keeps the console navigable (root → anchor → `items` → records) without scattering types across root collections.

`options-rh-instrument-map` stays its own root collection — shared lookup cache, not paper state.

## Record kinds & ID formats

| Kind | Doc ID format | Example |
|---|---|---|
| Account | `acct-{userId}` | `acct-a1b2c3` |
| Instance | `YYMMDD-{SYM}-{STRAT}-{DELTA}-{DTE}-{FREQ}-{TIME}` (existing `generateInstanceId`) | `260924-QQQM-CSP-020-30-D-1200` |
| Trade | `YYMMDD-{origin}-{SYMBOL}-{desc}`; origin ∈ `st`,`sig`,`man`; desc = `EQ` or `{SPREAD}-{DELTA}-{DTE}`; `-HHMM` suffix on same-day collisions | `260924-sig-QQQ-EQ` · `260924-st-QQQM-CSP-020-30` |
| Cohort | `cohort-YYMMDD-{SYMBOL}-{seq}` | `cohort-260924-QQQ-01` |
| Stats | `stats-{scope}` | `stats-all` · `stats-inst-{instId}` · `stats-var-{variantKey}` |
| Raw quote | `rq-{tradeId}-{YYMMDD}` | `rq-260924-st-QQQM-CSP-020-30-260925` |

## Types

### `PaperAccount` (`acct-{userId}`)

`{ kind: 'account', userId, cash, equity, realizedPnl, openTradeCount, createdAt, updatedAt }` — one per user (RH parity). Cash is tracked but never enforced; negative balances are permitted and visible.

### `PaperTrade` (`trades/items/{tradeId}`) — the lifecycle aggregate

One doc carries the whole trade life — no cross-collection lookups:

```typescript
interface PaperTrade {
  kind: 'trade';
  id: string;                       // human-readable id above
  status: 'PENDING' | 'OPEN' | 'CLOSED' | 'EXPIRED' | 'ASSIGNED';
  // provenance / dimensions (rollup axes)
  source: 'strategy' | 'signal' | 'manual';
  strategyInstanceId?: string;
  cohortId?: string;
  signalId?: string;
  symbol: string;
  expression: string;               // 'EQ' | 'LONG_CALL' | 'CSP' | 'BCS' | ...
  governingVariant: string;         // exit-variant key that governs the real lifecycle
  // lifecycle payloads
  ticket?: { signalId: string; refId: string; acceptedAt: string };   // signal provenance
  order: { side: TradeSide; type: string; quantity: number; limitPrice?: number; stopPrice?: number };
  fills: PaperFill[];               // entry fill(s) + exit fill(s)
  legs: PaperTradeLeg[];            // option legs and/or share leg
  marks: Record<string, { mark: number; underlyingClose: number }>;   // date → mark
  variantRuns: VariantRun[];        // one per configured exit variant (incl. governing)
  realizedPnl: number;
  unrealizedPnl: number;
  capitalRequired?: number;
  createdAt: string;                // ISO
  updatedAt: string;
}

interface PaperFill {
  fillId: string;
  role: 'entry' | 'exit';
  date: string;                     // market date or ISO timestamp
  price: number;
  quantity: number;
  quoteSource: 'RH_MCP' | 'AV_EOD'; // provenance
  rawQuoteRef?: string;             // rq- id
}

interface PaperTradeLeg {
  kind: 'option' | 'share';
  contractID?: string;              // OCC id for option legs
  type?: OptionType; strike?: number; expiration?: string;
  side: TradeSide; quantity: number; multiplier: number;
  entryMark: number; lastMark: number;
}

interface VariantRun {
  variantKey: string;               // 'initial-stop' | 'trailing-stop' | 'time-stop' | 'limit-stddev' | ...
  governing: boolean;
  state: 'ACTIVE' | 'EXITED';
  /** variant-specific working state, e.g. trailing high-water mark, entry-day counter */
  workingState: Record<string, number>;
  exitEvent?: { date: string; price: number; pnl: number; daysHeld: number };
}
```

### `PaperCohort` (`cohorts/items/{cohortId}`)

`{ kind: 'cohort', id, signalId, symbol, direction, acceptedAt, tradeIds: string[], expressionTemplates: string[] }` — groups the trades spawned by one accepted signal (underlying + each expression template).

### `PaperStrategyInstance` (`instances/items/{instId}`)

Reuses `StrategyInstanceConfig` from `options-strategy-engine-contracts` plus `kind: 'instance'`, `paperAccountId`, and `governingVariant` (the exit variant this instance's trades run under test). Migrated from `options-strategy-instances`.

### `ExitVariantConfig`

`{ key, label, params }` registry entries — every variant is evaluated independently on its own timeline; exactly one per trade is `governing` (the variant under test — RH allows one exit type per trade, so variants are candidates for selection, not parallel trades). Variant rule params live in a typed union per variant kind:

```typescript
type ExitVariantParams =
  | { type: 'initial-stop'; pct: number }
  | { type: 'trailing-stop'; pct: number }
  | { type: 'time-stop'; days: number }
  | { type: 'limit-stddev'; sdMultiplier: number };
```

### `PaperStats` (`stats/items/{scope}`)

Extends the existing `StrategyStats`/`EquityCurvePoint` shapes (`totalRealizedPnl`, `totalUnrealizedPnl`, counts, `maxDrawdown`, `equityCurve[]`) scoped by rollup key (`all`, `inst-{id}`, `var-{key}`, `cohort-{id}`, `sig-{signalId}`, `sym-{symbol}`).

### `RawQuoteDoc` (`raw-quotes/items/{rqId}`)

`{ kind: 'raw-quote', id, tradeId, date, rawResponse }` — unchanged purpose from #108's `RawQuote`.

## Callable contracts (FE↔BE)

- `paperSignalOrder({ signalId, symbol, direction, quantity, refId })` → creates cohort + equity trade filled at acceptance quote; queues expression orders for the next noon-PT pass.
- `listPaperTrades({ status?, source?, strategyInstanceId?, cohortId?, symbol? })` → dashboard queries.
- `getPaperStats({ scope? })` → stats docs for dashboard.
- `listExitVariants()` / instance CRUD — reuse the existing strategy-instance read/write shape.

## Boundaries

- FE never writes trade/ledger docs directly — all mutations go through callables (server-side fills, marks, exits are engine-owned).
- FE reads: `trades`, `cohorts`, `instances`, `accounts`, `stats` subcollections are read-only to clients; `raw-quotes` read-only.
- `StrategyInstanceConfig`, `OptionQuote`, OCC helpers imported from existing shared modules — no duplication.
