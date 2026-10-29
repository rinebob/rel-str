**Topic:** RH Scanner  
**Topic Slug:** rh-scanner  
**Thread:** Scanner Row Actions  
**Thread Slug:** scanner-row-actions  
**Issue:** #1297  
**Thread Parent:** #1295  
**Topic Parent:** #1098  
**Domain:** SAVANT-TRADER  
**Area:** SHARED  
**Type:** TEST  
**Status:** Complete  
**Created:** 2026-10-27  
**Last Updated:** 2026-10-28  

# TEST (SHARED) — Scanner Row Actions

Coverage for the `get_equity_historicals` wire contract
(`shared/robinhood-mcp-contracts.ts`).

## Unit targets

- **Compile-level contract use** — the FE `historicalsToBars` fixture
  (FE TEST §2) imports `EquityHistoricalsResult`/`EquityHistoricalBar`
  through `@robinhood-mcp/contracts`; a wrong field name fails at
  compile time. No runtime code ships in the contract file itself.
- **Live-capture parity check** — during implementation, diff the
  declared field names against the real `get_equity_historicals`
  capture in `docs/topics/657-rh-mcp/captures/` (the #657 sweep). Any
  mismatch is fixed in the contract before the FE mapper lands — the
  capture is the wire source of truth.

## Live verification

Two scripts (guide: `scripts/verify/savant-trader-scanner-row-actions-1304.md`):

- `savant-trader-scanner-row-actions-1304-contracts.ts` — offline
  capture parity: bidirectional key diff (wire ↔ declared) across
  request args, response top-level, `data` level, result entries, and
  bars. Registered in `run-all.ts`; no services needed.
- `savant-trader-scanner-row-actions-1304-live.ts` — live
  `get_equity_historicals` call through the RH MCP executor at
  127.0.0.1:3456. Deliberately NOT in `run-all.ts` (same convention as
  `run-drift-check.ts` for #682) — run directly.

## Edge cases pinned downstream

- String-typed prices (`open_price` etc.) — the FE mapper spec covers
  non-numeric/missing strings → dropped bar, never `NaN`.
- `data.results` absent/empty (or a symbol's `bars` empty) → empty bar
  array (unavailable chart, not a crash).
