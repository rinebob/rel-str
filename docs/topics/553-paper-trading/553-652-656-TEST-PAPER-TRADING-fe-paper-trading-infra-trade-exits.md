# FE TEST — Trade Exits

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

Jest 30 + jest-preset-angular; async tests flush with a macrotask boundary
(`await new Promise(r => setTimeout(r, 0))`), `jest.fn()` mocks of
`PaperTradingService`.

## Service

- `closePaperTrade$('t1')` calls `httpsCallable` with the right name +
  `{tradeId:'t1'}`; same for `cancelPaperTrade$`.

## Store

- `closeTrade` success → service called, trades reloaded (or row updated),
  closing flag clears.
- Failure → error surfaces on the error signal; flag clears; trade row
  unchanged.
- `cancelTrade` parallel coverage.
- Concurrent close on the same tradeId → second call ignored while
  in-flight (or queued — match whatever the store's write conventions are).

## Dashboard component

- OPEN row renders the Close action; PENDING row renders Cancel;
  CLOSED/EXPIRED/ASSIGNED/CANCELLED render neither.
- Confirm → calls store action; spinner during flight.
- Callable error (e.g. `unavailable`) → visible message, row unchanged.
- Cohort drill-down rows expose the same actions.
- `CANCELLED` status chip renders + appears in the status filter.

## Strategy builder

- Governing family select offers only `trailing-stop`; `'none'` is not an
  option.
- Param default 8 → key `trailing-8`; param 15 → `trailing-15`; decimal
  `8.5` → `trailing-8.5`.
- `initial-stop`/`time-stop`/`limit-stddev`/`none` not selectable for new
  configs.
- Out-of-range params (`0`, `150`) fail validation with a `range` error;
  the input binds `[min]`/`[max]` from `VARIANT_PARAM_META`.
- Editing an instance whose stored key is non-terminal, unparseable, or
  degenerate (`time-30d`, `custom-legacy-key`, `none`, `trailing-150`)
  prefills the `trailing-stop`/8 default — BE resolver parity.
