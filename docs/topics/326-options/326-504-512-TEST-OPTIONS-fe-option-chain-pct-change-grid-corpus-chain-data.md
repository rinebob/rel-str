**Topic:** Option chain percent change grid  
**Topic Slug:** option-chain-pct-change-grid<br>
**Thread:** Corpus-backed chain data
**Thread Slug:** corpus-chain-data<br>
**Issue:** #512  
**Thread Parent:** #504
**Topic Parent:** #326  
**Domain:** OPTIONS  
**Area:** FE  
**Type:** TEST  
**Status:** Draft  
**Created:** 2026-09-22  
**Last Updated:** 2026-09-22  

---

# FE TEST: Corpus surface for oc%c

## Unit — store (`option-chain-pct-change.store.spec.ts`)

- `runAnalysis` with one target fetch erroring → run completes, good dates
  populate `snapshotCache`, failed date lands in the per-date error map.
- Start-date failure still fails the whole run.
- Result ordering preserved after per-date catch (index re-sort still works).
- `source` from each response is recorded per date.
- Unsupported-symbol code → human-readable `store.error()` (not generic
  fetch message).

## Unit — swing-compare feature (`swing-compare.feature.spec.ts`)

- `ensureSnapshots` captures `source` per date; per-date error rows already
  exist — verify the new codes flow through unchanged.

## Unit — run-section (`run-section.component.spec.ts`)

- `source: 'live'` on a date → badge renders; `source: 'gcs'` → none/subtle;
  missing → none.

## Integration

- Manual run with a mixed corpus state (some dates error) → grids render for
  good dates, error row for bad.
- Non-enabled symbol run → symbol-level error message visible.

## Edge cases

- All target dates fail → run completes with zero grids + all error rows.
- `source` absent (pre-corpus SA) → no badge, no error.
