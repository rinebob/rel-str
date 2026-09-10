# Verification Guide: indicator-lib-268 — Std Dev Lines Engine

## Scripts

### indicator-lib-268-engine.ts

Verifies the `computeStdDevLines` engine (`std-dev-lines.ts`) with both
deterministic synthetic fixtures (golden values) and real SPY daily bars
from Firestore.

**Command:**
```
cd functions
npx tsx scripts/verify/indicator-lib-268-engine.ts
```

**Arguments/flags:** None.

**Prerequisites:** Application Default Credentials with access to the rel-str
Firestore `symbol-data` collection. IPv4-only Node preload (see `AGENTS.md`).

**What it does:**

Part A — Deterministic golden-value checks (no Firestore):
1. SMA center line and population std dev match hand-computed values on
   closes [100, 101, 102, 103, 104] with period 5.
2. Regular and Fibonacci band values match `center ± level × stdDev`.
3. EMA center line and exponentially-weighted std dev match hand-computed
   values with period 3.
4. Edge cases: empty input, short input, period=0, non-integer period.

Part B — Real Firestore SPY data:
1. Loads SPY daily bars from Firestore via `loadAllDailyBars`.
2. Validates structure: array lengths, band counts, default levels.
3. Validates NaN handling: first 49 bars NaN for center line, std dev, and
   band arrays. Bar 49 is finite (guards against undefined false positive).
4. Validates band formula `upper = center + level × stdDev` at first,
   middle, and last bar.
5. Validates band symmetry at first, middle, and last bar.
6. Validates band ordering: upper widens and lower narrows with higher levels.
7. Prints sample values for last 5 bars.
8. Validates EMA mode: structure, NaN handling, formula, symmetry (regular
   + fib), ordering (regular + fib), and differs from SMA (relative threshold).

**What a passing result looks like:**
```
=== N/N checks passed ===
```
All checks print ✔ before the summary. Exit code 0.

**What a failing result looks like:**
Any check failure prints ✖ instead of ✔. The script exits with code 1
and prints the total passed/failed count.

**Setup/teardown:** None required. Read-only — does not modify Firestore data.

## Pipeline stages covered

1. **Pure computation** — golden-value checks confirm SMA, EMA, population
   std dev, and band formula correctness against hand-computed expected values.
2. **Integration** — real Firestore SPY data confirms the engine works with
   production data shape and volume.
3. **Edge cases** — empty input, short input, invalid period, non-integer
   period, and EMA mode are all exercised.

## Order

Run this script after the unit tests pass:
```
cd functions
npx tsx --test ../tests/functions/std-dev-lines.test.ts
npx tsx scripts/verify/indicator-lib-268-engine.ts
```
