# SHARED IMPL — Trade Exits contracts

**Topic:** Paper Trading Infra  
**Topic Slug:** paper-trading-infra  
**Thread:** Trade Exits  
**Thread Slug:** trade-exits  
**Issue:** #656  
**Thread Parent:** #652  
**Topic Parent:** #553  
**Domain:** PAPER-TRADING  
**Type:** Implementation Plan  
**Status:** Draft  
**Created:** 2026-09-28  
**Last Updated:** 2026-09-28  

Shared contract changes in `shared/paper-trading-contracts.ts` + the FE
variant-key parse mirror. No BE/FE logic here.

## 1. `PaperTradeStatus` — add `CANCELLED`

```ts
CANCELLED = 'CANCELLED',   // PENDING trade cancelled before fill
```

Downstream sweep points (known consumers):
- `listPaperTrades` status filter accepts it for free (enum-driven).
- Stats pass: cancelled trades must be excluded from rollups — check the
  trade→position adapter and stats folds for a status whitelist; add an
  explicit exclusion if the fold iterates all statuses.
- FE dashboard: add a status display chip/style + filter option.

## 2. Callable contracts — `closePaperTrade` / `cancelPaperTrade`

```ts
export interface ClosePaperTradeRequest { tradeId: string; }
export interface ClosePaperTradeResponse {
  tradeId: string;
  exitPrice: number;      // net order-level exit price
  realizedPnl: number;
  closedAt: string;       // ISO
}
export interface CancelPaperTradeRequest { tradeId: string; }
export interface CancelPaperTradeResponse { tradeId: string; }
```

Add `CallableName` entries: `'closePaperTrade'`, `'cancelPaperTrade'` in
the FE callable registry (wherever `listPaperTrades` etc. are registered).

## 3. Variant defaults — trailing-stop-only seeding

```ts
export const DEFAULT_TRAILING_STOP_KEY = 'trailing-8';
export const SIGNAL_GOVERNING_VARIANT = DEFAULT_TRAILING_STOP_KEY; // was 'none'
export const SIGNAL_SHADOW_VARIANT_KEYS: string[] = [];            // was 3 keys
```

Notes:
- `none` stays a valid `governingVariant` string on existing docs —
  it never parses, so its run is inert by construction (no compat code).
- Signal cohorts now seed `[trailing-8]` — one run, governing. Every
  cohort member (EQ + options) carries the stop.

## 4. FE variant-key parse — terminal-family metadata

The FE mirror of `parseVariantKey` (used by strategy-builder
`governingVariantKey()`/prefill) gains family classification so the
governing select can restrict to terminal families:

```ts
export type VariantFamily = 'initial-stop' | 'trailing-stop' | 'time-stop' | 'limit-stddev';
export const TERMINAL_VARIANT_FAMILIES: readonly VariantFamily[] = ['trailing-stop'];
```

'none' also parses to a `none` family for round-trip display of existing
docs (it is not in `TERMINAL_VARIANT_FAMILIES`, so it's unselectable for
new configs).
