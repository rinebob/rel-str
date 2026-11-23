# Verification guide — #1678 (IBS trend-rider filter)

**Task:** #1678 — BE: IBS filter verification script (`ibs-trend-rider-filter-1678.ts`)
**Script:** `ibs-trend-rider-filter-1678.ts`
**Env:** live Firestore read — same ADC credentials as other live verify
scripts (`firebase-admin-init`); read-only, no writes.

## `ibs-trend-rider-filter-1678.ts`

```bash
cd functions && npx tsx scripts/verify/ibs-trend-rider-filter-1678.ts
cd functions && npx tsx scripts/verify/ibs-trend-rider-filter-1678.ts --symbol=QQQ --threshold=0.6
cd functions && npx tsx scripts/verify/ibs-trend-rider-filter-1678.ts --now=2026-11-21T18:00:00Z
```

**Flags/args:**

- `--symbol=SYM` — symbol to load from `symbol-data` (default `SPY`);
  upper-cased and validated
- `--threshold=T` — gate threshold override (default `0.5`); must be a
  number in `[0,1]`, passed through as `IbsGateConfig.threshold` so the
  run exercises the same seam prod uses
- `--now=ISO` — pins the availability clock into `IbsGateConfig.now` for
  deterministic runs; omitted → wall clock, like production (see Notes)

**What it verifies:**

1. Loads the symbol's stored daily + weekly bars via
   `getCachedBarsFromSymbolData` — the production run's data path — and
   asserts ≥45 daily bars (weekly <45 warns and the W cells skip, as
   prod's per-branch gate does).
2. Recomputes zones with the production chain
   (`computeStTrendBands` → `computeStZone`/`computeStZoneV2`, `windowV2` =
   own zone) and runs `detectAllStTrendRiderSignals` unfiltered vs gated.
3. Prints a per-cell table (candidates / emitted / suppressed / suppr%) for
   `D-V1`, `D-V2`, `W-V1`, `W-V2`.
4. Asserts per cell:
   - every emitted LONG satisfies `ibs ≥ T` and every emitted SHORT
     `ibs ≤ 1−T` — with a **finite** ibs required on every signal whose
     index is not the last bar (only the developing bar may legitimately
     emit with `ibs: null`); a gate that never engages fails here
   - every **suppressed** candidate carried a finite ibs that violated its
     bound (gate never removes a passing or uncomputed candidate)
   - recorded `indicators.ibs` equals an independent `computeIbs`
     recompute on the signal's own bar (no record-vs-decide drift)
   - `indicators.ibs` is recorded as `number | null` on emitted signals
   - the gated set is a subset of the unfiltered candidate set (gate
     only removes)
5. Asserts at least one emitted signal across cells; warns if the gate
   suppressed nothing overall.

**Observed baseline (SPY, 2026-11-23, T=0.5):** D-V1 21.6% (97→76),
D-V2 38.5% (104→64), W-V1 15.4% (13→11), W-V2 33.3% (15→10).
V2 suppression runs hotter than the PRD's rough ~10–25% estimate — likely
because the V2 zone's wider ±4 range re-arms more often within sustained
moves, producing more candidates on weak-close bars; the table is
informational, not gated on the estimate.

**Passing:** `=== 26 passed, 0 failed ===`, exit code 0.
**Failing:** any `FAIL` line names the broken check; exit code 1.
`WARN` lines flag degraded conditions (thin weekly bars, zero suppression)
without failing.

**Notes:** counts drift as SDS appends bars — the checks are invariants
(bound satisfaction, subset, recorded-vs-recomputed `ibs`), not pinned
counts. With no `--now`, the last bar's IBS availability follows the wall
clock — pre-12:00 ET the developing daily bar emits with `ibs: null`,
Mon–Tue likewise for weekly; this is production parity, not a defect.
