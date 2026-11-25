# Verify guide — #1676/#1724 Pine IBS filter parity audit

## Script

`indicator-lib-1676-pine-parity.ts` — static audit of the IBS filter in
`rb-ps/rb-ta/ind/rb-st-zones.pine` (Thread #1665). Pine has no local
compiler (TradingView-only runtime), so this pins what is mechanically
checkable: the three filter inputs, formula + availability approximation,
emit/suppressed partition, emission-only suppression, ghost wiring, and
zero-cross filtered parity (#1724 — zero-cross markers partition through
the same `stIbsLongPass`/`stIbsShortPass` vars, matching the TS emit
wrappers in `signal-detection.ts`). The manual TradingView-vs-web
comparison is the separate UAT leg
(`261-1722-1676-UAT-INDICATOR-LIB-indicator-lib.md`).

## Usage

```powershell
cd functions
npx tsx scripts/verify/indicator-lib-1676-pine-parity.ts
```

No arguments, no env, read-only, ~instant. Run from `functions/`.

## Passing result

43 `PASS` lines, summary `43 PASS / 0 FAIL`, exit code 0.

## Failing result

Each `FAIL` line names the broken contract — fix the .pine file (or update
the audit if the contract intentionally changed) and re-run.

## What it pins

- Inputs: `IBS Threshold` float 0.5 / 0–1 / step 0.05; `Daily IBS
  Available From (ET hour)` int 12 / 0–23; `Show Suppressed Signals`
  bool false; `ST_ET_TZ` hoisted.
- Formula: `na` OHLC → pass-through; `(high−low) <= 0 → 0.5`;
  `(close−low)/(high−low)` otherwise.
- Availability: completed bars always defined; developing daily bar
  filters at `hour(timenow, ST_ET_TZ) >= 12`; weekly filters at ET
  Wednesday with Sunday normalized to week-tail 7 (`st-ibs.ts` parity).
- Filter directions: long `ibs >= T`, short `ibs <= 1.0 − T + 1e-15` (a
  permissive ulp margin in the TS `Number.EPSILON` guard's direction —
  wider than EPSILON itself, so boundary-adjacent shorts pass).
- Partition: all four Trend Rider `stV*{Emit,Supp}` booleans; state vars
  latch unconditionally before the filter (suppression is emission-only).
- Plots: emitted use `*Emit`, ghosts behind `stShowSuppressed` + `*Supp`,
  ~35% opacity `color.new(…, 65)`, V1 circles / V2 crosses, all
  `force_overlay`.
- Zero-cross (#1724): all four `stV*ZeroCross*{Emit,Supp}` booleans off
  the same filter vars (partition pins are end-of-line anchored); raw
  detection bools stay filter-free sign flips (a negative pin fails if
  an `Ibs` token reaches them); emit plots on `*Emit`, four ghosts
  behind `stShowSuppressed` mirroring style/linewidth, all
  `force_overlay`; no `lookahead_on` introduced.
