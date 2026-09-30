# BE IMPL — Trade Exits

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

## Files

- `functions/src/paper-trading/callables.ts` — `closePaperTrade` + `cancelPaperTrade` onCall exports
- `functions/src/paper-trading/ledger.ts` — `cancelPendingTrade` txn seam
- `functions/src/paper-trading/exits/registry.ts` — terminal-family classification
- `functions/src/paper-trading/engine/position-repository.ts` (and/or `trade-adapter.ts`) — read `instance.governingVariant` at position creation
- `functions/src/index.ts` — re-exports
- `scripts/verify/` — prod verification script + guide + run-all entry

## 1. `cancelPendingTrade` (ledger)

Txn seam mirroring `applyPendingFill`'s guard shape:

- Read trade inside `deps.transact`; require `status === PENDING` else throw.
- Write the trade back with `status: CANCELLED`, `updatedAt: now`. Account
  doc untouched except `updatedAt` (no cash, no counts — PENDING never
  moved them).

## 2. `cancelPaperTrade` callable

`onCall` following `paperSignalOrder` conventions (deps injection, CORS,
`RH_CREDENTIAL_BUNDLE` not needed — no quote call). Validate `tradeId`,
auth, call `cancelPendingTrade`. Error map: trade-not-found → `not-found`;
non-PENDING → `failed-precondition`.

## 3. `closePaperTrade` callable — live-quote close

Flow (mirroring `paperSignalOrder`'s MCP wiring):

1. `auth` + `tradeId` validation; load the trade (`getTrade`).
2. Guard `status === OPEN` (ASSIGNED out of scope — the eval pass already
   treats share-holding exits as a dedicated seam; surface
   `failed-precondition`).
3. **Live quote per leg** via the RH MCP session (`callTool`):
   - share leg → `get_equity_quotes {symbols: [symbol]}` → `extractEquityPrice`
   - option leg → `get_option_quotes` / the provider path used by
     `rh-mcp-option-quote-provider.ts` → per-contract mark
   - Net order-level exit price: compute the liquidation value V =
     Σ(leg-sign × legMark × legQty × legMult), then sign it by entry side —
     `price = (entrySide==SHORT ? −V : V) / (orderQty × orderMult)` — so the
     ledger's `cashDelta = −signedCashDelta(fill, entrySide)` equals V
     exactly. Reduces to the leg mark for single-leg trades; a SHORT entry
     closing for a net credit yields a negative price (correct).
   - Any missing/non-finite quote → `unavailable`; **no fallback**. The
     option provider *throws* on quote-miss — the handler catches and maps
     to `unavailable`; provider/infra throws are not `internal`.
4. `applyExitFill` with `fill.price = netExitPrice`, `role: 'exit'`,
   `quantity = order.quantity`, `quoteSource: RH_MCP`,
   `date = getMarketDatePT(now)`, `fillId = 'exit-{tradeId}-manual-{ts}'`.
   The txn inside the ledger books realized P&L + credits cash.
5. **Finalize the governing run** in the same handler (post-txn): set the
   trade's governing run `state: 'EXITED'`, `exitEvent: {date, price,
   pnl: computeExitPnl(entryFill, price, side, legs), daysHeld}` via
   `updateVariantRun`. Manual close is a governing-run exit — the run must
   not linger ACTIVE on a CLOSED trade.
6. Return `ClosePaperTradeResponse`.

Error map: not-found → `not-found`; not-OPEN → `failed-precondition`;
quote failure → `unavailable`; MCP/session failure → `internal`.

## 4. Registry — governing-key guard

**Amended 2026-09-29/30** (execution-fidelity reframe — see PRD): the
guard is a *product gate*, not a capability claim — `initial-stop` and
`time-stop` DO fire in `evaluateVariant`, but US4 offers only trailing
stops as governing. `TERMINAL_VARIANT_FAMILIES` (`['trailing-stop']`)
encodes that gate; `isTerminalVariantKey` additionally rejects
degenerate params (`trailing-0` fires on the first mark):

```ts
export function isTerminalVariantKey(key: string): boolean {
  const def = parseVariantKey(key);
  if (!def || !TERMINAL_VARIANT_FAMILIES.includes(def.family)) return false;
  // Pct-param families additionally need a sane bound; a non-pct family
  // added later is governed by membership alone.
  if ('stopPct' in def.params) {
    return isGoverningEligiblePct(def.params.stopPct);
  }
  return true;
}
```

`isGoverningEligiblePct` (shared contracts) is the single pct bound used
by the BE registry and the FE form — `0 < fraction < 1` (`trailing-0`
fires instantly; `trailing-99+` needs a ~99% reversal).

`ledger.seedVariantRuns` invariants: `governingVariant` must be terminal —
`'none'` is rejected outright (legacy inert docs are written by
`positionToTrade` directly and never traverse seeding; no legit caller
passes it) — and every `variantKeys` entry must parse. Adding an exit
family later (std-dev target) = add to `TERMINAL_VARIANT_FAMILIES` +
implement its trigger — the taxonomy grows with capability, no other
wiring.

## 5. Instance launch seeding

`trade-adapter.positionToTrade` + `position-repository.createPosition`
currently hardcode `LEGACY_GOVERNING_VARIANT = 'none'`. Change: resolve the
instance doc (`getInstance(db, position.instanceId)`) and use its
`governingVariant` (default `trailing-8` — with a warn — when the field is
missing, `'none'`, non-terminal, or unparseable; a bad stored key must not
crash the nightly open pass).
variantKeys = `[governing]` — no shadow seeding. Ensure the instance read
happens once per launch batch, not per trade, if open-pass creates many
positions per instance.

## 6. Prod verify script + guide

`scripts/verify/paper-trading-trade-exits-65X.ts` + `.md` guide + run-all
entry (needs RH creds for the quote path; check-patterns from #564's
script): create+close round trip on a scratch trade if feasible, otherwise
callable presence + cancel path + seeding checks.

## Known gaps (document, don't fix)

- Governing exits on ASSIGNED trades still log-and-skip in eval-pass —
  share-holding exits remain a dedicated seam (unchanged this thread).
- Marks stop landing on CLOSED trades; post-close shadow eval is moot now
  that no shadows are seeded.
