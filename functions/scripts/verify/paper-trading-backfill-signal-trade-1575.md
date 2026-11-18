# paper-trading-backfill-signal-trade-1575

Verify script for **#1575 — BE: `generatePaperSignalTrades` — mint picked
signals as backdated ledger trades** (Topic #553, Thread #906).

## What it pins

Static seams plus an end-to-end fixture mint through the REAL ledger
(`applyEntryFill`/`applyExitFill` over an in-memory txn store) — no env,
read-only:

- **Static seams** — `FillDimensions.governingPolicy` on the ledger,
  `commitBackfilledTrade` in the repository, the callable registered in
  `index.ts`, `SDS_BARS` provenance + `auto: false` pick tickets in the
  pass source, the spec registered in `package.json`, the batch cap (50)
  and the 7-key curated variant set.
- **Fixture mint (target close)** — deterministic `sig`-origin tradeId,
  `signalDedupeKey` on the trade, `governingPolicy` marker stamped on the
  doc, entry fill at the signal-bar close with `SDS_BARS` and no
  `rawQuoteRef`, all 7 curated runs seeded, day-by-day marks ending at
  the firing bar, `target-50` EXITED with `exitEvent`, the
  `governingVariant` mirror naming the actual closer, realized P&L, and
  exactly ONE backfill commit before the ledger close.
- **Dedupe + errors** — re-minting the same pick returns `deduped` (no
  second entry); a missing `st-signals` doc and a missing signal bar each
  return `error` with no ledger writes.
- **Callable** — unauthenticated requests and over-cap batches are
  rejected before any mint runs.

## Usage

```powershell
cd functions
npx tsx scripts/verify/paper-trading-backfill-signal-trade-1575.ts
```

All 32 checks print `✓`; exits non-zero on any failure.
