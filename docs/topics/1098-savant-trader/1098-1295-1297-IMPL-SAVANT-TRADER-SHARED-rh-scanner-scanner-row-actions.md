**Topic:** RH Scanner  
**Topic Slug:** rh-scanner  
**Thread:** Scanner Row Actions  
**Thread Slug:** scanner-row-actions  
**Issue:** #1297  
**Thread Parent:** #1295  
**Topic Parent:** #1098  
**Domain:** SAVANT-TRADER  
**Area:** SHARED  
**Type:** IMPL  
**Status:** Complete  
**Created:** 2026-10-27  
**Last Updated:** 2026-10-28  

# IMPL (SHARED) — Scanner Row Actions

## Scope

One wire contract: the `get_equity_historicals` response shape consumed by
the scanner's hover chart for untracked symbols (ADR-011). Everything else
in this thread is FE.

## §1 Wire contract (`shared/robinhood-mcp-contracts.ts`)

`@robinhood-mcp/contracts` is a single hand-maintained file
(`shared/robinhood-mcp-contracts.ts`, ~170 lines today) carrying the
scanner `preview_scan` types. Add the historicals contract alongside:

```ts
/** Fixed interval set the server accepts (8 intraday + 10 interday). */
export type EquityHistoricalInterval =
  | '15second' | '30second' | 'minute' | '5minute' | '10minute' | '30minute'
  | 'hour' | '4hour'
  | 'day' | 'week' | 'month' | '3month' | '6month' | 'year'
  | '5year' | '10year' | '20year' | '50year';

/** Request — `symbols` array + RFC3339 `start_time` required (≤10 symbols).
 *  NOT the classic RH `symbol`/`span` args. */
export interface EquityHistoricalsRequest {
  symbols: string[];
  start_time: string;
  end_time?: string;
  /** 'day' for the popup. Explicit intervals capped at ~5,000 upstream
   *  bars — rejected pre-upstream (cap doesn't apply when auto-selected). */
  interval?: EquityHistoricalInterval;
  bounds?: 'regular' | 'extended' | 'trading' | '24_5' | '24_7' | 'hyper_trading';
  /** 'split' default; 'all' requires interval >= day (capture ro-eq-hist-11). */
  adjustment_type?: 'none' | 'split' | 'all';
}

/** One OHLCV bar — prices are strings; FE owns numeric coercion.
 *  All fields except `interpolated` are present on every capture. */
export interface EquityHistoricalBar {
  /** ISO-8601 timestamp — day bars carry 'YYYY-MM-DDT00:00:00Z'. */
  begins_at: string;
  open_price: string;
  close_price: string;
  high_price: string;
  low_price: string;
  volume: number;
  /** 'reg' | 'pre' | 'post' | 'overnight' observed. */
  session: string;
  /** Server-synthesized gap-fill bar — no new information. */
  interpolated?: boolean;
}

/** All four fields present on every success capture; `interval` is the
 *  server's echo (request or auto-selection) — stays `string`. */
export interface EquityHistoricalsSymbolResult {
  symbol: string;
  interval: string;
  bounds: string;
  bars: EquityHistoricalBar[];
}

/** Top-level parsed payload: { data: { results[] }, guide } — per-symbol
 *  keyed, NOT a flat `historicals` array. */
export interface EquityHistoricalsResult {
  data: { results: EquityHistoricalsSymbolResult[] };
  guide?: string;
}
```

Exact rules:

- Field names are the RH wire names (`begins_at`, `*_price` strings) —
  the live capture from the #657 sweep (`captures/` under
  `docs/topics/657-rh-mcp/`) is the source of truth; confirm at write time
  and comment any deviation.
- Prices arrive as **strings** — the FE owns numeric coercion (same
  convention as `parseScanRows` stringified wire values).
- The contract is exported through the existing
  `@robinhood-mcp/contracts` path alias — no new barrel.
- `interval: 'minute'` and `adjustment_type` interactions noted in the
  field guide (5000-bar cap; `all` needs ≥ day) are documented in the
  comment but not modeled — the FE only sends `interval:'day'`.

## §2 Verification

`scanner.service.spec.ts`-style contract coverage is unnecessary for a
type-only change; the FE task's `historicals → PriceBar` mapper gets a
`@robinhood-mcp/contracts` fixture row proving the shape compiles and
parses. The SHARED TEST doc covers that seam.
