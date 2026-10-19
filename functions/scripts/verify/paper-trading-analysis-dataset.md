# verify-1079 — analysis-dataset relay (live dry-run + AMAT replay parity)

**Task:** [#1079](https://github.com/rinebob/rel-str/issues/1079) — indexed verification for the full analysis-dataset pipeline  
**Script:** `paper-trading-analysis-dataset.ts`  
**Mode:** read-only dry-run — both passes run through injected collector `writeDataset` seams; no GCS objects, no index docs

## What it checks

### Part 1 — live snapshot dry-run (real pass)

Runs the real `runLiveSnapshot` against prod with `writeDataset` swapped
for an in-memory collector — the full mapping path is exercised, nothing
persists:

- one row per ledger trade, single final `writeDataset` call
- cohort split (`signal-equity` vs `excluded`), closed/open split
- per-column non-null sample across all 46 row fields

**#1007 transitional fallback:** working-tree `collections.ts` routes
`trades` to `st-paper-trading/trades/items`, which stays empty until the
rename migration runs (deploy → `--apply` per its runbook). When the
canonical path enumerates zero, the `listTrades` dep reads the legacy
`paper-trading/trades/items` directly — same `{id, ...data}` +
`isPaperTrade` construction `listTrades` uses — and prints a `⚠`. Once
the canonical collection has docs the legacy read never fires.

### Part 2 — AMAT replay parity (asserted)

Replays the prototype's bar window through the real `runReplay` + real
detector + real exit registry:

- `loadDailyBars` slices to `d >= 2023-01-01` — the prototype computed
  indicators on the 2023+ slice, so the warmup window must match
- `barRange.to` is frozen at **2026-10-16** (the max date the fixture
  references) so newly-appended SDS bars can't drift the check

Asserts against the checked-in prototype CSV
(`paper-trading-analysis-dataset-amat-prototype.csv`):

| Metric | Expected | Tolerance |
|---|---|---|
| row count | 99 | exact |
| closed count | 98 | exact |
| %profitable | 32.7% | ±0.5pp |
| payoff | 1.30 | ±0.02 |
| signal set | identical (`signalBarDate\|signalType`, both ways) | exact |

Expected values are derived from the CSV at run time, not hardcoded.
The diff (expected vs actual + both-ways signal-set diff) prints on
every run.

### Part 3 — informational full-history baseline

Same replay with no warmup slice (`d >= 0000-01-01`), same frozen `to`.
Production-faithful semantic (SDS computes indicators on full history);
printed only — the baseline drifts if SDS backfills older shards.

## Run

```powershell
$env:NODE_OPTIONS="--require C:\Users\bob\.config\node\ipv4-only.cjs"
cd functions
npx tsx scripts/verify/paper-trading-analysis-dataset.ts
```

Last run: **ALL CHECKS PASSED** — live 247 trades → 247 rows
(229 signal-equity / 18 excluded, 19 closed / 228 open); AMAT parity
99/98/32.7%/1.30 with zero signal-set diff; full-history baseline
194/193/35.8%/1.30. Warn-free now that the #1007 migration has run —
the legacy fallback leg was exercised during the migration window
(passed with 1 warn).

## Notes

- Wired into `run-all.ts` under the paper-trading group (after
  `paper-trading-analysis-1077-live-snapshot.ts`).
- Exit code is non-zero if any Part 1/2 assertion fails; the ⚠ warn does
  not fail the run (it's a known transitional state).
- The live column sample is the quick way to eyeball which fields are
  actually populated in prod (e.g. `capitalRequired` is 0/247 — only
  options expressions carry it).
