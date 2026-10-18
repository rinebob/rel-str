# verify-1077 — live-snapshot pass (dry-run)

**Task:** [#1077](https://github.com/rinebob/rel-str/issues/1077) — `analysisDatasetTask` live branch (trades → rows, `strength.*` from bars)  
**Script:** `paper-trading-analysis-1077-live-snapshot.ts`  
**Mode:** read-only dry-run — no index docs, no GCS objects

## What it checks

Against real prod (`rel-str`), the script enumerates
`paper-trading/trades/items` and maps every trade to a `TradeAnalysisRow`
without writing anything:

1. **One row per trade** — row count == ledger count.
2. **Cohorts** — signal-linked `EQ` rows are `signal-equity`; manual and
   option-expression rows are `excluded` (kept, not dropped).
3. **`ind.*` carried** — signal rows keep their stamped `signalIndicators`
   snapshot (zoneV1/V2(+Prev), windowV2, delta).
4. **Lifecycle split** — closed rows carry `exitDate/exitPrice/tradeRetPct`;
   open rows have null exits and a provisional mark-based ret.
5. **`strength.*`** — DI+/DI−/diHist/ADX computed from real SDS daily bars
   at the signal bar (one load per symbol, sliced to the anchor).
6. **Excursion sanity** — `mfePct ≥ tradeRetPct` and `maePct ≤ 0` on all
   closed rows; excursion basis `mark ?? underlyingClose`.

It prints one sample signal-equity row for eyeballing.

## Run

```powershell
$env:NODE_OPTIONS="--require C:\Users\bob\.config\node\ipv4-only.cjs"
cd functions
npx tsx scripts/verify/paper-trading-analysis-1077-live-snapshot.ts
```

Last run: **7/7 PASS** — 247 trades → 247 rows (229 signal-equity, 18
excluded), 220 stamped `ind.*`, 19 closed / 226 open, `strength.*` on
220/229 signal rows.

## Notes

- `strength.*` nulls are legitimate when the symbol's bar history at the
  signal bar is thin (<15 bars) or the anchor is missing.
- The writer/GCS/index-doc half of the pipeline is covered by
  `verify-1076`; this script deliberately does not write.
- `loadDailyBars` reads once per symbol (`asOf '9999-12-31'`) and slices
  to each anchor in memory — a symbol with many signal dates would
  otherwise re-read its full history per anchor.
