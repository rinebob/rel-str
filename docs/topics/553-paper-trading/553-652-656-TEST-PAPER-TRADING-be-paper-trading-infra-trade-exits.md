# BE TEST — Trade Exits

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

Convention: `tsx --test` under `tests/functions/paper-trading/` —
deps-injected handlers, fake MCP `callTool`, in-memory `LedgerDeps` txn —
matching the #564/#563 test seams.

## `cancelPendingTrade` (ledger seam)

- PENDING → CANCELLED inside the txn; cash/openTradeCount unchanged.
- Non-PENDING (OPEN/CLOSED/CANCELLED/EXPIRED) → throws.
- Missing trade → throws.

## `cancelPaperTrade` callable

- unauthenticated → `unauthenticated`; missing tradeId → `invalid-argument`.
- Missing trade → `not-found`; non-PENDING → `failed-precondition`.
- Happy path → `CANCELLED`.

## `closePaperTrade` callable

- Guards: unauthenticated; missing trade; status CLOSED/PENDING/ASSIGNED/
  EXPIRED → `failed-precondition`.
- **Quote paths**: share leg reads `get_equity_quotes`; option leg reads
  the option-quote tool; multi-leg trades net the per-leg marks into one
  order-level price (signs: short legs negative).
- Quote missing/non-finite for *any* leg → `unavailable`, **no ledger
  write attempted** (assert `applyExitFill` dep not called).
- Happy path: `applyExitFill` called with exit fill at the netted price →
  trade CLOSED, account cash credited, realizedPnl booked.
- Governing run finalized: `updateVariantRun` writes `EXITED` + exitEvent
  (price = live quote, pnl = computeExitPnl, daysHeld).
- MCP session throws → `internal`; session manager `close()` still runs.

## Registry / seeding

- `isTerminalVariantKey`: `trailing-*` true; `initial-stop`, `time-*`,
  `limit-sd*`, `none`, garbage → false.
- `seedVariantRuns` rejects non-terminal AND unparseable/inert governing
  keys (`'none'` included — legacy docs bypass seeding via
  `positionToTrade`, so no caller legitimately passes it); accepts
  `trailing-8`. Non-governing `variantKeys` must all parse.

## Instance launch seeding

- `governingVariantForInstance` with stored `governingVariant:
  'trailing-15'` → `'trailing-15'` governing key.
- Missing / `'none'` / non-string stored key → silent `'trailing-8'`
  default; non-terminal / unparseable / degenerate string key →
  `'trailing-8'` + warn (a bad stored key must not crash the nightly open
  pass).
- `createPosition` seeds that key as the single governing run (no
  shadows); resolution uses the instance doc `getInstance` already reads
  inside `createPosition` (open-pass passes `instanceId`; the resolver
  does not add fetches beyond that read).

## Edge cases

- Double-close race: second call hits `not-open` → `failed-precondition`.
- Governing run already EXITED (eval fired, run update missed) — idempotent
  finalization, no crash.
- Cancel raced against the noon fill pass: PENDING→OPEN in the meantime →
  cancel throws `failed-precondition` (txn re-reads status).
