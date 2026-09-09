# Verification Guide — Task #258: Script Runner for Open-Close Strategy Comparison

**Topic:** #106 — Trading Strategy Library
**Thread:** #253 — Simple Open-Close Long
**Blueprint:** #256 — BE Blueprint
**Task:** #258 — BE: Script runner for open-close strategy comparison

## Scripts

### strat-lib-258-comparison.ts

Verifies the full pipeline by running the actual script runner against real Firestore data, then validating the JSON output and cross-checking with an independent computation.

**Command:**
```bash
cd functions
npx tsx scripts/verify/strat-lib-258-comparison.ts
```

**What it does:**
1. Runs `open-close-strategy-comparison.ts --symbol SPY` via `execFileSync`
2. Validates the JSON output file exists and has correct structure (generatedAt, fixedAmount, initialEquity, symbols)
3. Validates result structure (dateRange, barCount, skippedCount, dailyRecords, metrics)
4. Validates daily records (first day skipped, non-skipped records have returns)
5. Validates metrics coherence (totalNetProfit ≈ compounded equity change, counts derived from data)
6. P&L ratio sanity check (finite, positive)
7. Cross-checks with independent `computeOpenCloseReturns` call
8. Cleans up the output file

**Passing result:**
```
=== 40/40 checks passed ===
```

**Failing result:**
Any `✖` line indicates a failed check. Exit code 1.

**Prerequisites:**
- Application Default Credentials with access to the rel-str Firestore
- SPY daily bars cached in `symbol-data/SPY/daily/`

### open-close-strategy-comparison.ts (the script runner itself)

The production script runner that loads SPY and QQQ, runs the computation, writes JSON, and prints a summary table.

**Command:**
```bash
cd functions
npx tsx scripts/open-close-strategy-comparison.ts [flags]
```

**Flags:**
- `--symbol <ticker>` — Override default symbols (SPY, QQQ) with a single symbol
- `--help` — Show help

**Output:**
- Console: per-symbol date range, bar count, skip reasons, summary table, P&L ratios, fixed-amount totals, compounded final equity
- File: `scripts/output/open-close-comparison.json` with run metadata and per-day records

**Prerequisites:**
- Application Default Credentials with access to the rel-str Firestore
- SPY and QQQ daily bars cached in `symbol-data/{symbol}/daily/`
