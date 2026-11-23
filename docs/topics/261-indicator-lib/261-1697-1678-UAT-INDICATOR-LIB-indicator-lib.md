**Topic:** Trading Indicator Library  
**Topic Slug:** indicator-lib  
**Thread:** Intraday Bar Strength (IBS)  
**Thread Slug:** intraday-bar-strength  
**Issue:** #261  
**Thread Parent:** #1665  
**Topic Parent:** #261  
**Task:** #1678  
**Domain:** BE  
**Type:** UAT  
**Status:** Complete  
**Created:** 2026-11-23  
**Last Updated:** 2026-11-23  

# UAT — #1678 BE: IBS filter verification script

QA issue: #1697. Backend verify-script surface — no user-facing route;
acceptance is fully automated.

## Getting to the feature

No UI route. The surface is a repo script — run from `functions/`:

```bash
cd functions && npx tsx scripts/verify/ibs-trend-rider-filter-1678.ts
```

Requires ADC/Firestore credentials (same as other live verify scripts);
reads `symbol-data/{symbol}` — **read-only**, no writes.

## Scenarios

| # | Scenario | Evidence | Result |
|---|----------|----------|--------|
| S1 | Default run — SPY @ T=0.5 | `=== 26 passed, 0 failed ===`, exit 0. Table: D-V1 97→76 (21.6%), D-V2 104→64 (38.5%), W-V1 13→11 (15.4%), W-V2 15→10 (33.3%) | PASS |
| S2 | Threshold override | `--threshold=0.6` → 26/26, higher suppression (W-V2 40.0%) | PASS |
| S3 | Symbol override | `--symbol=QQQ` → 26/26 (W-V2 16→12, 25.0%) | PASS |
| S4 | Deterministic clock | `--now=2026-11-21T18:00:00Z` → 26/26, table identical across repeat | PASS |
| S5 | Arg validation | `--threshold=abc` and `--symbol=bad/sym` → usage error, exit 2 — no Firestore access attempted | PASS |
| S6 | Gate-engagement invariant | emitted non-last signals must carry finite ibs; suppressed candidates must show finite bound-violating ibs; recorded ibs must equal independent `computeIbs` recompute — all checked per cell ×4 | PASS |
| S7 | Read-only | script performs only `collection().doc().get()` via `getCachedBarsFromSymbolData`; zero write calls (code review verified) | PASS |
| S8 | Registration | `run-all.ts` entry after `indicator-lib-ibs-1675.ts`; README index row + ordered entry 66; guide `ibs-trend-rider-filter-1678.md` accurate (26 checks, `--now` documented) | PASS |

## Traceability

- IMPL §4 (verify-script module): production data path, zone chain,
  unfiltered-vs-gated runs, per-cell table — S1–S4
- Emitted-bound + finite-ibs invariants — S1, S6
- Suppressed-side bound-violation invariant (review M2) — S6
- Recorded-vs-recomputed ibs (review M1 blind-spot) — S6
- Arg safety (review minors) — S5
- Read-only discipline — S7
- Standard conventions + registration — S8

## Notes

- Suppression rates are empirical/informational — V2 runs hotter
  (33–38%) than the PRD's rough ~10–25% estimate; documented in the
  guide, not gated.
- Without `--now`, the developing last bar follows wall-clock
  availability (pre-12:00 ET daily, Mon–Tue weekly) — production parity.
