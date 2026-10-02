# Code Review — #666 BE Pending cancel

**Topic:** Paper Trading Infra  
**Topic Slug:** paper-trading-infra  
**Task:** #666  
**Topic Parent:** #553  
**Domain:** PAPER-TRADING  
**Type:** CODE-REVIEW  
**Status:** Complete  
**Created:** 2026-09-28  
**Last Updated:** 2026-09-28  

## Diff scope

| File | Change |
|---|---|
| `functions/src/paper-trading/ledger.ts` | `cancelPendingTrade` + `CancelTradeInput` — txn-seam PENDING→CANCELLED, runs→EXITED, cashDelta 0 |
| `functions/src/paper-trading/callables.ts` | `handleCancelPaperTrade` + `CancelPaperTradeDeps` + `cancelPaperTrade` onCall (pure ledger, no MCP) |
| `functions/src/paper-trading/passes/expression-fill-pass.ts` | `not pending` rejections → `skipped`, not `errors` |
| `functions/src/index.ts` | export `cancelPaperTrade` |
| `tests/functions/paper-trading/` | ledger ×3, cancel-paper-trade ×7 (new file), expression-fill race ×1 |
| `functions/scripts/verify/paper-trading-cancel-666.ts` + `scripts/verify/{paper-trading-cancel-666.md,README,run-all}` | prod verify 9/9 + registration |

## Round 1 — three axes

- **Standards:** CLEAN. Injected-deps pattern, guard ladder, error-message
  formats, txn seam, test conventions, verify-script shape all match
  existing paper-trading code. No unused imports.
- **Spec:** CLEAN. All ACs met incl. the two carried forward from the #665
  review (run finalization; cancel-vs-fill → skipped). Ownership check,
  contract response `{ tradeId }`, stats exclusion, rules all verified.
- **Thermo:** two low-severity fixes applied:
  - `callables.ts` — ownership check was fail-open on `userId`-less trades
    → now fails closed (`!trade.userId || ≠ uid` → permission-denied); test added.
  - `ledger.ts` — account write keyed to `input.userId` (caller) could
    bump/mint a foreign account doc → resolves `trade.userId ?? input.userId`.
  - Clean: txn race re-checks both directions, run finalization vs
    eval/stats filters, security rules (admin-SDK-only writes).

## Deferred findings (tracked on owning tasks)

- `cohort.tradeIds` keeps cancelled members — intentional (nothing reads
  it; FE groups by `trade.cohortId`); #671's cancelled-selector AC covers
  display.
- `CallableName.CANCEL_PAPER_TRADE` + `cancelPaperTrade$` wrapper — #670 ACs.
- `PaperTradeOverrides` can strip `userId` via `{userId: undefined}` — no
  caller does; noted for a future hardening if overrides grow callers.

## Verification

- `npx tsx --test "tests/functions/paper-trading/*.test.ts"` → 118/118
- `npx tsx functions/scripts/verify/paper-trading-cancel-666.ts` → 9/9 on prod
- `cd functions && npm run build` → clean

## Verdict

**PASS** — QA gate via `/proj qa 553 666`.
