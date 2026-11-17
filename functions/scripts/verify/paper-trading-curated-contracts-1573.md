# paper-trading-curated-contracts-1573

Verification guide for **#1573 — SHARED Task: Signal-replay contracts**
(Topic #553 Paper Trading Infra, Thread #906 Historical Signal Replay).

## What it verifies

The runtime-verifiable surface of the merged-ledger contracts — pure
contract task, so no Firestore/prod pipeline stages exist to hit:

1. **Curated variant set** — `CURATED_VARIANT_KEYS` is the pinned 7-key
   set (trailing-5/8, ma-close-20/50/100, target-50/100), unique, with
   `trailing-8` present (the governing-policy fallback must resolve) and
   every key matching the `{family}-{param}` grammar shape.
2. **Governing-policy marker** — `CURATED_GOVERNING_POLICY` ===
   `'deepest-stop-else-trailing-8'`.
3. **Quote source** — `OptionQuoteSource.SDS_BARS` exists (bars-priced
   backfill fills); AV_EOD/RH_MCP/AV_REALTIME unchanged.
4. **Batch bounds** — `GENERATE_PAPER_SIGNAL_TRADES_MAX_ITEMS` and
   `DELETE_PAPER_TRADES_MAX_ITEMS` both 50.
5. **Id determinism** — a `SignalPick`'s three fields reproduce the live
   ingest's `signalDedupeKey` + `buildTradeId` outputs exactly (symbol
   case-normalizes), so a live capture and a historical mint of the same
   signal can never double-mint. `signalTradeDesc` still throws on
   unsupported signal types. The dedupe-key layout
   (`{SYM}_{type}_{date}`, what `trade.signalId` carries) is also pinned
   **distinct** from `stSignalOccurrenceId` (`{SYM}_{date}_{type}`) — the
   swapped-order trap `st-ids.ts` warns about.

## Usage

```
cd functions
npx tsx scripts/verify/paper-trading-curated-contracts-1573.ts
```

Read-only, no env vars, no Firestore — instant.

## Pass

`=== 14 passed, 0 failed ===`, exit 0.

## Fail

Any `FAIL {name} — {detail}` line — e.g. a key set drift, a policy marker
rename, or an id builder that stopped normalizing symbol case. Exit 1.
