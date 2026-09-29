# SHARED TEST — Trade Exits contracts

**Topic:** Paper Trading Infra  
**Topic Slug:** paper-trading-infra  
**Thread:** Trade Exits  
**Thread Slug:** trade-exits  
**Issue:** #656  
**Thread Parent:** #652  
**Topic Parent:** #553  
**Domain:** PAPER-TRADING  
**Type:** Test Plan  
**Status:** Draft  
**Created:** 2026-09-28  
**Last Updated:** 2026-09-28  

## Unit tests — `shared/paper-trading-contracts.spec.ts` (or existing home)

- `CANCELLED` enum member serializes as `'CANCELLED'`; status-filter
  unions accept it.
- `SIGNAL_GOVERNING_VARIANT === 'trailing-8'`; `SIGNAL_SHADOW_VARIANT_KEYS`
  is empty.
- `TERMINAL_VARIANT_FAMILIES` contains `trailing-stop` only; `none`,
  `initial-stop`, `time-stop`, `limit-stddev` absent.
- `ClosePaperTradeRequest`/`Response` and `Cancel*` shapes — compile-time
  contract (typecheck suffices; add a shape spec if the file has a
  precedent).
- FE `parseVariantKey` mirror: `trailing-8` → `{family:'trailing-stop',
  pct:8}`; `none` → `none` family (display fallback); `initial-stop-10` /
  `time-30d` → non-terminal families (unparseable-for-governing path).

## Edge cases

- `trailing-8.5` (decimal pct) still parses → `pct: 8.5`.
- `trailing-0` / negative — validation rejects at the builder level; the
  parser itself accepts the number shape (existing convention, document).
- Existing doc with `governingVariant: 'none'` round-trips for display.
