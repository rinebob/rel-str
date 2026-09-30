# Code Review — #667 BE Live-quote close

**Topic:** Paper Trading Infra
**Topic Slug:** paper-trading-infra
**Task:** #667
**Topic Parent:** #553
**Domain:** PAPER-TRADING
**Type:** CODE-REVIEW
**Status:** Complete
**Created:** 2026-09-29
**Last Updated:** 2026-09-29

## Diff scope

| File | Change |
|---|---|
| `functions/src/paper-trading/callables.ts` | `ClosePaperTradeDeps`, `netExitPrice`, `handleClosePaperTrade`, `closePaperTrade` onCall (MCP session, secrets, finally cleanup) |
| `functions/src/index.ts` | export `closePaperTrade` |
| `tests/functions/paper-trading/close-paper-trade.test.ts` | 13 tests: equity/option/spread close, unavailable paths (miss/throw ×2 providers), guard ladder, race map, run-finalize tolerance |
| `functions/scripts/verify/paper-trading-close-667.ts` + `scripts/verify/*` | prod round-trip verify (7/9 checks… 7/7) + registrations |
| `553-652-656-IMPL-be` doc | net-price formula + provider-throw error map clarified |

## Round 1 — three axes

- **Standards:** CLEAN modulo minor items — all applied (unused
  `getAccount` import dropped, verify header renumbered, redundant `!`
  assertions on narrowed union removed).
- **Spec:** CLEAN except the error-map deviation below — all ACs met.
- **Thermo:** verified sign math for all leg/side combos incl. negative
  net prices (correct — credit at close), eval-pass backfill ordering,
  terminal-guard no-op, date semantics, ASSIGNED rejection, txn race.

### Findings → fixes applied

1. **Medium — provider-thrown quote misses surfaced as `internal`, not
   `unavailable`.** `RobinhoodMcpOptionQuoteProvider.getQuotes` throws on
   missing marks/quotes; `netExitPrice` now catches → `undefined` →
   `unavailable` (per spec's error map). New test: provider-throw →
   unavailable, no ledger write.
2. **Low — `updateRun` failure post-commit surfaced `internal` after a
   successful close.** Now try/catch + warn — eval pass backfills the run.
   New test: failed finalize still returns the close result.
3. **Doc** — IMPL doc's net-price formula amended to include the
   entry-side sign (implementation's actual contract).

### Deferred (tracked)

- Non-idempotent close: retry after committed-but-lost response gets
  `failed-precondition` — FE treats as refresh trigger (#670).
- ASSIGNED manual close stays gated out (share-holding exits are a
  dedicated seam — ledger.ts documents the P&L mismatch).

## Round 2 — verification

All round-1 fixes verified; no new findings. One consistency nit applied:
equity-quote `callTool` throws now map to `unavailable` like the option path
(same "no live quote" failure class); test added. 131/131.

## Verification

- `npx tsx --test "tests/functions/paper-trading/*.test.ts"` → 131/131
- `paper-trading-close-667.ts` → 7/7 on prod (real quote round-trip)
- `cd functions && npm run build` → clean

## Verdict

**PASS** — QA gate via `/proj qa 553 667`.
