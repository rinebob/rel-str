**Topic:** Option chain percent change grid  
**Topic Slug:** option-chain-pct-change-grid<br>
**Thread:** Corpus-backed chain data
**Thread Slug:** corpus-chain-data<br>
**Issue:** #512  
**Thread Parent:** #504
**Topic Parent:** #326  
**Domain:** OPTIONS  
**Area:** FE  
**Type:** IMPL  
**Status:** Draft  
**Created:** 2026-09-22  
**Last Updated:** 2026-09-22  

---

# FE IMPL: Corpus surface for oc%c

Read path is unchanged — `getHistoricalOptionsChain$` keeps calling
`partnerHistoricalOptionsV2` per date. The work is error/UX surfacing.

## Task 1 — Per-date resilience for manual runs

`runAnalysis` (`option-chain-pct-change.store.ts`) wraps target fetches in a
`mergeMap(SNAPSHOT_FETCH_CONCURRENCY)` pipeline (added 2026-09-22), then
`forkJoin`s start + targets + bars. One date erroring currently kills the
whole run.

Change: wrap each target fetch in `catchError` producing a tagged result
(`{ ok: true, res } | { ok: false, error }`), so a failed/missing date
degrades to an error row instead of failing the run:

```ts
mergeMap((dt, i) =>
  svc.getHistoricalOptionsChain$(symbol, dt).pipe(
    map((res) => ({ i, ok: true as const, res })),
    catchError((err) => of({ i, ok: false as const, err })),
  ),
  SNAPSHOT_FETCH_CONCURRENCY,
)
```

The `map` stage then splits results: ok results populate `snapshotCache`;
failed results populate a per-date error map. The grid render path already
has per-date error rows in the swing-compare path (`snapshotErrors` /
`runErrors`) — reuse that display pattern for manual-run target errors: the
target's grid row renders an unavailable state with retry affordance.

Manual runs keep requiring the **start** snapshot — a start failure still
fails the run (no start = no comparison basis).

## Task 2 — Unsupported-symbol error

SA will return a distinguishable signal for non-`optionsEnabled` symbols
(exact shape pending the SA handoff spec — likely a body `code` mapped to a
dedicated callable code, see BE blueprint).

Store: when `runAnalysis`/`ensureSnapshots` surfaces that code, set
`error: "Options analysis isn't available for {SYMBOL}"` (or similar) — not
the generic fetch-failure message.

## Task 3 — `source` badge on run date rows

`GetHistoricalOptionsChainResponse.source` (`"gcs" | "live"`, optional)
arrives with each snapshot. Thread it through:

- `ensureSnapshots` / `runAnalysis` record `source` per date alongside the
  snapshot (extend the per-date result objects).
- `run-section` renders a small badge on each target-date row:
  `live` → visible "live fetch" chip (explains a slow row); `gcs` → subtle
  or nothing (default is fine). Absent `source` → no badge.
- Post-hoc only — never a loading indicator (the value doesn't exist until
  the response lands).

## Files

- `option-chain-pct-change.store.ts` — per-date catch + source capture,
  unsupported-symbol error mapping
- `swing-compare.feature.ts` — same per-date source capture + error-code
  passthrough in `ensureSnapshots`
- `components/run-section.component.ts` — date-row badge rendering
- `option-chain-pct-change.component.ts` — symbol-level error display
  (existing `store.error()` banner suffices)
