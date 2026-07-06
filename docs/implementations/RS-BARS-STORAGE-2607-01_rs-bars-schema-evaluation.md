# RS-BARS-STORAGE-2607-01 — rs-bars Schema Evaluation & Migration Plan

- **Status**: in-progress
- **Area**: BE
- **Scope**: MAINT / PERF
- **Code**: RS-BARS-STORAGE
- **Created**: 2026-07-04
- **Last updated**: 2026-07-06
- **Related**: RH-AGENT-THERMO-2607-01 T26

## Problem Statement

The current `rs-bars` collection stores all three timeframes (daily, weekly, monthly) as raw arrays inside a **single Firestore document** per symbol:

```
rs-bars/{SYMBOL}  →  { daily: OhlcBar[], weekly: OhlcBar[], monthly: OhlcBar[], ...metadata }
```

This design has three structural problems that compound over time.

### Sin 1 — Unbounded document growth (daily / 2-day only)

Firestore has a hard 1 MB per-document limit. Size by timeframe today:

- Daily: 7 years × ~252 bars/yr = ~1,764 bars × ~75 bytes ≈ **~132 KB**
- Weekly: 7 years × ~52 bars ≈ **~27 KB** — stable forever, no ceiling risk
- Monthly: 8 years × 12 bars ≈ **~7 KB** — stable forever, no ceiling risk
- Metadata overhead: ~2 KB

**Total today: ~165–180 KB per symbol.**

Daily growth rate: ~17 KB/yr. A planned 2-day timeframe (~126 bars/yr) would add ~9 KB/yr on top. The ceiling risk is real only for the daily and 2-day intervals. Weekly and monthly are safe as flat docs indefinitely.

### Sin 2 — Write amplification on every nightly sync

The nightly sync calls `docRef.set(docData)`, which **replaces all three arrays wholesale** for every symbol on every run. An incremental run that adds one new daily bar rewrites ~165 KB of data per symbol:

- 761 symbols × ~165 KB = **~125 MB of write traffic per nightly run**
- Any future intraday write pattern would do the same: read 1,764 bars, splice 1 bar, write all 1,764 bars back

### Sin 3 — No query granularity

- Want the last 45 bars for the agent worker? Full doc read + client-side slice.
- Want to backfill one year without touching the rest? Full doc overwrite.
- Want to query across symbols for a specific date range? Not possible — arrays are opaque to Firestore queries.

---

## Decision

**Year-shard only the intervals that need it: daily and 2-day. Keep weekly and monthly as flat arrays on the root metadata doc.**

Reasoning:
- Weekly (~27 KB) and monthly (~7 KB) are bounded in size forever — year-sharding them adds read complexity with zero benefit.
- Daily compounds at ~17 KB/yr; 2-day at ~9 KB/yr — these need sharding.
- This minimises reads per symbol: 2 daily shards (current year + prev year for agent lookback) + 1 metadata doc = **3 reads per symbol** on incremental agent runs, vs. 22 reads if all intervals were sharded.

**Target collection: `symbol-data` (not `rs-bars`)**

`rs-bars` is a design mistake and will be retired. `symbol-data` already has one doc per symbol (SA-driven, contains `currentPrice` and basic metadata) and is the correct generic home for all per-symbol data. Bar subcollections hang off it cleanly without polluting it with a separate concern.

`rs-bars` will continue writing as normal during the cutover period — this lets us observe whether the nightly sync self-heals any currently missing data. It is deleted only after the new schema is verified over several nightly runs.

---

## Final Schema

```typescript
// symbol-data/{SYMBOL} — existing root doc, extended with bar metadata fields (merge only)
interface SymbolDataDoc {
  // existing fields (unchanged):
  symbol: string;
  currentPrice?: { price: number; date: string; time: string };
  name?: string;
  currency?: string;
  region?: string;
  timezone?: string;
  type?: string;
  // new fields added by rs-bars-sync (merge only, do not disturb existing fields):
  lastDailyBarDate?: string;    // YYYY-MM-DD
  lastWeeklyBarDate?: string;   // YYYY-MM-DD
  lastMonthlyBarDate?: string;  // YYYY-MM-DD
  lastBarSyncedAt?: Timestamp;
  // flat arrays — small enough to stay here forever:
  weekly?: OhlcBar[];           // ~27 KB max, bounded
  monthly?: OhlcBar[];          // ~7 KB max, bounded
}

// symbol-data/{SYMBOL}/daily/{YYYY} — year shard for daily bars
// symbol-data/{SYMBOL}/2day/{YYYY}  — future, not in scope for this task
interface SymbolBarsYearDoc {
  year: number;                       // YYYY
  interval: 'daily';                  // 2day deferred to separate task
  bars: OhlcBar[];                    // sorted chronologically, bars for this calendar year only
  updatedAt: Timestamp;
}

// Collection paths:
// symbol-data/{SYMBOL}              — SymbolDataDoc (root, existing + extended)
// symbol-data/{SYMBOL}/daily/{YYYY} — SymbolBarsYearDoc
// symbol-data/{SYMBOL}/2day/{YYYY}  — future (out of scope here)
```

---

## Migration Strategy

**Parallel write — no destructive changes until verified.**

All new code is added as new functions/sections alongside existing code, clearly delimited by comments. Old code is not deleted until the new schema is confirmed correct in production. This allows:
- The old `rs-bars` flat-doc sync to continue running unchanged during cutover
- The new `symbol-data` year-shard sync to run in parallel
- Readers (`getCachedBars`, `rh-agent-indicator-series`) to be switched one at a time
- `rs-bars` to be deleted only after the new path is verified over several nightly runs

**Phase 1 — Parallel write**
1. Add `syncSymbolToSymbolData` alongside existing `syncSymbol` in `rs-bars-sync.ts`
2. New function writes daily year shards to `symbol-data/{SYMBOL}/daily/{YYYY}` and weekly/monthly flat arrays to `symbol-data/{SYMBOL}.weekly` / `.monthly` (merge)
3. Also upserts `{ symbol, enabled: true }` into `rh-agent-symbols/{SYMBOL}` so the agent enable list stays in sync automatically — eliminating the need to run `seedAllSymbolsFromPartner` manually
4. Both old and new sync paths run on the same nightly schedule until verified

**Phase 2 — Switch readers**
1. Add `getCachedBarsFromSymbolData` alongside existing `getCachedBars` in `rh-agent-data-loader.ts`
2. New function: reads `Promise.all([currentYearShard, prevYearShard])` for daily + reads `symbol-data/{SYMBOL}.weekly` / `.monthly` from root doc — 3 Firestore reads per symbol total
3. Update `rh-agent-indicator-series.ts` reader to use `symbol-data` (this file was missing from the original affected-files list)
4. Switch agent worker to use new reader
5. Verify signal output matches old path over several runs

**Phase 3 — Retire rs-bars**
1. Stop old `syncSymbol` writes to `rs-bars`
2. Delete `rs-bars` collection via admin script
3. Remove old code sections from all affected files

---

## Affected Files

### Backend
- `functions/src/rs-bars/rs-bars-sync.ts` — add `syncSymbolToSymbolData` alongside existing `syncSymbol`; new function targets `symbol-data` subcollections and upserts `rh-agent-symbols`
- `functions/src/rh-agent-cloud-function/rh-agent-data-loader.ts` — add `getCachedBarsFromSymbolData` alongside existing `getCachedBars`
- `functions/src/rh-agent-cloud-function/rh-agent-indicator-series.ts` — add new reader path for `symbol-data` (**not in original doc — identified during review**)
- `functions/src/rh-agent-cloud-function/rh-agent-shared.ts` — `writeIntradayBarsToRsBars` already dead (T04); remove in Phase 3 cleanup
- `functions/src/rh-agent-cloud-function/rh-agent-types.ts` — `OhlcBar` already canonical (T05); no change needed
- `functions/src/webhooks/webhooks-config.ts` — add `SYMBOL_BARS_DAILY_SUBCOL = 'daily'`, `SYMBOL_BARS_WEEKLY_FIELD = 'weekly'` etc. constants

### Backend (migration script)
- **No migration script needed.** On the first nightly sync after Phase 1 is deployed, `syncSymbolToSymbolData` will detect no existing `symbol-data` year-shard docs (equivalent to `!existing` / `isStale` in the old path) and trigger a full backfill automatically — fetching 7 years of daily, 7 years of weekly, 8 years of monthly from SA for every symbol. This is the same auto-backfill behaviour that already works for new symbols in `rs-bars`.

### Frontend
- `src/app/features/rh-agent/services/rh-agent-chart.service.ts` — audit for direct `rs-bars` reads; update if found
- `src/app/features/services/rel-str-db-v2.service.ts` — `getAvailableSymbolsFromSymbolData$` already reads from `symbol-data` root — **no change needed**

### Firestore
- `firestore.rules` — add read rules for `symbol-data/{symbol}/daily/{year}` and `symbol-data/{symbol}/2day/{year}`
- `firestore.indexes.json` — no composite indexes needed (reads are by doc path, not query)

---

## rh-agent-symbols Sync (bonus fix)

The `rh-agent-symbols` enable list currently requires manual seeding via `seedAllSymbolsFromPartner`. Adding the following upsert to `syncSymbolToSymbolData` eliminates this entirely:

```typescript
await db.collection('rh-agent-symbols').doc(symbol).set(
  { symbol, enabled: true },
  { merge: true }  // never overwrites existing enabled=false overrides
);
```

New symbols added to SA are picked up automatically on the next nightly bar sync. The `enabled` flag can still be set to `false` manually to exclude a symbol from agent runs — `merge: true` preserves any existing override.

---

## Notes

- This evaluation was triggered during THERMO review (RH-AGENT-THERMO-2607-01). The storage model issue was not captured in the original THERMO scope — hence this separate doc.
- `OhlcBar` is already canonical in `rh-agent-types.ts` (T05) — no type changes needed.
- The HTF multiplier stays hardcoded at 3 — no changes to indicator computation are implied by this migration.
- Indicator warm-up requires ~80 bars max (Wilder ADX-14 × HTF-3 = 42 bars + EMA post-smooth). For agent signal computation, reading the current year + previous year of daily shards (~500 bars) is sufficient. For historical backtesting, all year shards are read — fine since backtest scripts are infrequent and run from a local machine.
- 2-day timeframe is out of scope for this task. Schema is designed to accommodate it as `symbol-data/{SYMBOL}/2day/{YYYY}` when that task arrives.
- The `rh-agent-symbols` company overview duplication vs. `symbol-data` is a known issue; consolidation is deferred to a separate task.
