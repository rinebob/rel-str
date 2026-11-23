**Topic:** Trading Indicator Library  
**Topic Slug:** indicator-lib  
**Thread:** Intraday Bar Strength (IBS)  
**Thread Slug:** intraday-bar-strength  
**Issue:** #261  
**Thread Parent:** #1665  
**Topic Parent:** #261  
**Task:** #1678  
**Domain:** BE  
**Type:** CODE-REVIEW  
**Status:** Complete  
**Created:** 2026-11-23  
**Last Updated:** 2026-11-23  

# CODE-REVIEW — #1678 BE: IBS filter verification script

**Verdict: PASS** — 3 axes (standards / spec / thermo) over a small-scope
diff: new verify script + guide + `run-all.ts`/README registration. Two
MAJOR findings raised and resolved in-gate; all actionable minors fixed;
remaining items are documented NITs.

## Scope reviewed

- `functions/scripts/verify/ibs-trend-rider-filter-1678.ts` (new, ~190 lines)
- `functions/scripts/verify/ibs-trend-rider-filter-1678.md` (new guide)
- `functions/scripts/verify/run-all.ts` — one appended line (own hunk only)
- `functions/scripts/verify/README.md` — one table row + ordered entry 66
  (other added lines in the working tree are foreign #1651 session hunks)

No production code touched — the gate under test (`signal-detection.ts`)
is #1677's reviewed-and-shipped surface.

## Findings and resolution

### MAJOR (thermo) — both resolved

| # | Finding | Resolution |
|---|---------|------------|
| M1 | Bound checks were vacuous when `ibs` was `null` — a "gate never engages" regression would print all-green. `computeIbs` only returns `undefined` for the developing bar, so every non-last signal must carry a finite ibs. | Emitted-signal checks now require a finite, bound-satisfying ibs on every index except the last bar; plus a global `WARN` when total suppression is zero. |
| M2 | `suppressed` was count-arithmetic only — over-suppression (off-by-one, wrong-side bound) invisible despite each suppressed candidate carrying its own recorded `indicators.ibs`. | New per-cell check: every suppressed candidate must have a finite ibs violating its bound (exact prod semantics — `ibs < T` LONG, `ibs > 1−T+EPSILON` SHORT). Blind-spot sibling fixed too: new check asserts recorded `indicators.ibs` equals an independent `computeIbs` recompute on the signal's own bar, closing the self-referential gap the spec axis also flagged (its MINOR-1). |

### MINOR — all fixed

- `--symbol` not validated/normalized → `toUpperCase()` + ticker regex + usage exit (precedent: `data-pipeline-st-signals-backfill-1001.ts`).
- `--threshold` unvalidated (NaN/out-of-range/bare flag funneled into `T`) → validated `[0,1]` finite, usage exit 2.
- `normalizeBars` dropped prod's `?? 0`/`?? ''` fallbacks → mirrored exactly.
- Global weekly `<45` FAIL was stricter than prod's per-branch skip → demoted to `WARN`; cell-level skip unchanged.
- `process.exit` inside `main()` could truncate piped stdout → `process.exitCode`.
- Check named `suppressed ⊆ candidates` but asserted `emitted ⊆` → renamed.
- Bound-check tolerance `1e-9` looser than prod's exact comparisons → checks now use prod's exact semantics (`>= T`, `<= 1−T+Number.EPSILON`) — the recorded value is what the gate compared, so exactness cannot false-fail.
- Suppression-table column misalignment → consistent padding.
- Guide stated the V2-hotter cause as fact → hedged ("likely — wider range re-arms more often").

### Accepted / deferred NITs (documented, not fixed)

- `detectLastBarSignals` (prod's actual entry) not directly exercised —
  thin delegation covered by #1677 specs; the all-bars scan is the right
  instrument for this empirical check.
- `args` record is loosely typed (`Object.fromEntries`); access is
  immediately validated.
- `logger.info` JSON from the data loader interleaves with the table —
  cosmetic, same as sibling live scripts.
- `'9999-12-31'` no-trim sentinel vs prod's real `marketDate` — deliberate
  (zones are causal; precedented by `replay.ts`/`backtest-data-loader.ts`).

## Verification evidence

- Live run on SPY: `=== 26 passed, 0 failed ===` — suppression table
  unchanged: D-V1 21.6% (97→76), D-V2 38.5% (104→64), W-V1 15.4% (13→11),
  W-V2 33.3% (15→10). The new recompute check confirms recorded ibs equals
  `(C−L)/(H−L)` on the signal's own bar for every emitted signal.
- `--threshold=0.6` run also green (override seam exercised);
  `--threshold=abc` and `--symbol=bad/sym` fail fast with usage, exit 2.
- `npx tsc --noEmit -p functions` clean (only the pre-existing foreign
  `options-engine-eod-selection-1501.ts` errors, unrelated).

## Spec-axis result

All IMPL §4 requirements COVERED: production data path
(`getCachedBarsFromSymbolData`), production zone chain (`windowV2` = own
zone, 45-bar floor), unfiltered-vs-gated pairing matching
`ibsGateFromConfig`'s always-on seam, per-cell candidates/emitted/
suppressed/%, read-only. Registration conventions verified.

## Follow-ups

- None required for this task. The replay-parity gap (`replay.ts`
  unfiltered) remains the standing Topic #553 follow-up from #1677.
