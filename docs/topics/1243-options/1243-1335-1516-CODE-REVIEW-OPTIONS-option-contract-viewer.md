**Topic:** Option Contract Time-Series Viewer  
**Topic Slug:** option-contract-viewer  
**Issue:** #1335  
**Topic Parent:** #1243  
**Task:** #1516  
**Domain:** OPTIONS  
**Type:** CODE-REVIEW  
**Status:** Approved  
**Created:** 2026-11-16  
**Last Updated:** 2026-11-16  

# CODE-REVIEW — #1516 FE Task: Clear-all control for the plotted contract set

## Verdict: **PASS** (three rounds)

## Round 3 — focused adversarial re-check on the remediation delta (2026-11-16)

Independent pass over only the new machinery (`orphanContractLoad`,
`EMPTY_CONTRACT_VIEW`, the emptied-set `removePlotted` branch, the
`displayWindow` preserve, the four new specs). Six attack lines, all
verified safe:

- **Ghost repaint:** unreachable on every path — late focused loads die
  on the seq guard, foreign contracts (focused or focus-released)
  clear with the slice, `loadPlotted` workers can't write
  `contractData` (verified: only `loadContractInternal`,
  `resetSession`, and `EMPTY_CONTRACT_VIEW` write it).
- **Over-kill:** the seq bump *is* unconditional, but reaching
  "empty the set via ×" requires no active focus (chips collapse to
  the focused chip), so no legitimately-owned in-flight load is
  reachable to orphan. Comment widened to say so.
- **Slice clobbering:** `error`/`loading`/`occIdInput`/
  `currentSearchIndex` are written only by `loadContractInternal` +
  `resetSession` — pure contract-load slice. `occIdInput` the *signal*
  isn't the textarea (that's a component field) — user input can't be
  wiped.
- **Foreign synthesized chip × on an empty set:** reachable, and the
  emptied-set branch is precisely what makes it work — without it,
  `contractData` would keep painting the dismissed contract chipless.
- **Spec fidelity:** the in-flight spec exercises the real
  `loadContractInternal` seq guard — the `next` handler checks seq
  only, so it cannot pass via focus-clearing alone.

### Non-blocking findings (documented, accepted)

- **Empty-set = blank slate (behavioral choice):** `loadContract(F)` →
  `loadPlotted([A])` → × A wipes F's loaded data — the invariant can't
  distinguish "ghost" from "prior single view". Chosen deliberately:
  restoring a stale contract under an emptied set is exactly the bug
  being fixed; refetch is one Load away.
- **Nits (unfixed):** foreign-chip × also resets `currentSearchIndex`
  (paging position lost — cosmetic).
- **Fixed post-review:** the negative-direction invariant is now
  spec-pinned — a *non-empty* `removePlotted` leaves an in-flight
  foreign `loadContract` alone (its `contractData` still fills).

**Converged.** No fourth pass warranted — every remaining item is a
documented trade-off, not an open question.

## Round 2 — remediation-delta re-check (2026-11-16)

## Round 2 — remediation-delta re-check (2026-11-16)

Scoped to the fix delta (~55 lines across the feature, viewer store,
and specs), verified directly — same rationale as #1515: a re-run of
three agents on a delta this small is review theater.

**Zero new findings.** All four Round-1 defects reproduced red before
the fix and pass green after:

- **Ghost repaint (F1/F2):** `clearPlotted` and the emptied-set branch
  of `removePlotted` now orphan the in-flight contract load
  (`orphanContractLoad()` — new viewer method exposing the
  `contractLoadSeq` bump `resetSession` inlines) and patch
  `EMPTY_CONTRACT_VIEW` (`contractData`/`occIdInput`/`loading`/`error`/
  `currentSearchIndex`). Verified: `focusPlotted` → clear →
  `contractData` null; in-flight `Subject` → clear → `subject.next`
  → data still null, `loading` false.
- **displayWindow (F3):** preserved across `clearPlotted`
  (`displayWindow: s.displayWindow()` in the patch) — spec-pinned.
- **Standards (F4–F6):** `font-family: inherit` added; classes renamed
  into the `plotted-*` namespace (`plotted-count`,
  `plotted-clear-all`); spec assertion tightened to `'2 plotted'`.
- The `removePlotted` guard is keyed on the set *becoming* empty, not
  focus correspondence — covers the mid-flight-release variant where
  `contractData` belongs to a contract focus already released.

**Converged — no further pass warranted.** Remaining items are
documented below, not open questions.

## Round 1

Three-axis review (Standards / Spec / Thermo-nuclear) of the working
tree diff. Spec and Thermo-nuclear independently converged on the same
major: the new button called `clearPlotted()`, which reset only the
plotted slice — the viewer slice (`contractData` et al.) survived, so
the series projection repainted a cleared contract as a ghost line.
`resetSession`'s own comment documents exactly this hole; the fix
mirrors its contract.

## The change

- `option-chart.component.html` — `chips-panel-head` row at the top of
  the chips panel: `{N} plotted` count + **Clear all** button calling
  `store.clearPlotted()`, gated on `plottedList().length > 0`.
- `option-chart.component.scss` — head row + ghost text-button styles.
- `option-chart-dom.spec.ts` — DOM spec: control absent when empty;
  click clears set + pin + unmounts the panel.
- `plotted-contracts-feature.ts` — `clearPlotted` orphans in-flight
  contract loads + resets the viewer slice; `removePlotted` does the
  same when it empties the set; `displayWindow` preserved.
- `options-contract-viewer.store.ts` — `orphanContractLoad()` exposes
  the seq bump to the plotted feature.
- `plotted-contracts-feature.spec.ts` — four new specs pinning the
  review findings.

## Findings — all remediated in-gate

| # | Severity | Finding | Disposition |
|---|----------|---------|-------------|
| F1 | MAJOR | `clearPlotted` left `contractData` populated — drill into a contract, Clear all, and `plottedChartSeries()`'s contractData fallback repaints the just-cleared contract with no chip (both Spec and Thermo-nuclear caught it; `resetSession` documents the same hole) | **FIXED** — `EMPTY_CONTRACT_VIEW` patch + `orphanContractLoad()` on `clearPlotted` |
| F2 | MAJOR | No `contractLoadSeq` bump on clear — an in-flight focused load resurrects the cleared contract seconds later; `loading` also stays true, semi-locking the page | **FIXED** — `orphanContractLoad()` exposed from the viewer `withMethods` and called on both clear paths; `loading: false` in the patch |
| F3 | MINOR | `displayWindow` silently reset to `'lifetime'` via the `initialPlottedState` spread — a view preference, not set membership | **FIXED** — preserved in the patch; spec-pinned |
| F4 | MINOR | `.chips-clear-all` missing `font-family: inherit` — buttons don't inherit the app font | **FIXED** |
| F5 | NIT | `chips-*` class names vs. the panel's `plotted-*` family | **FIXED** — renamed `plotted-count`/`plotted-clear-all` (head stays `chips-panel-head` — it heads the panel) |
| F6 | NIT | Weak count assertion `toContain('2')` | **FIXED** — `toContain('2 plotted')` |
| F7 | MINOR | `removePlotted` had the identical ghost hole — × the last/focused chip empties the set but leaves `contractData` painted (pre-existing, same seam) | **FIXED** — emptied-set branch applies the same `EMPTY_CONTRACT_VIEW` + seq-bump guard |

## Axes summaries

- **Standards:** no major; template/store-call patterns consistent
  (direct `store.clearPlotted()` matches `setHoveredContract`,
  `toggleUnderlying`, `addPadDays` pass-throughs). Findings were the
  font-family omission and naming namespace.
- **Spec:** FAIL on F1; satisfied on the common path otherwise.
  Confirmed Clear-all hidden in rejection-only state is correct.
- **Thermo-nuclear:** F1 + F2 (in-flight variant), F3, plus the
  pre-existing batch-race and rejections items below. Verified all
  load-flight guards hold: mid-load clear is safe (workers re-check
  `status === 'loading'` on the fresh map), post-`Promise.all`
  continuation doesn't exist, and stale underlying bars match
  fresh-page state.

## Documented minors / deferred (not defects of this task)

- **Overlapping-batch progress race (pre-existing):** Clear all →
  immediate reload while old workers drain can write the old batch's
  `done`/`total` into the new batch's progress (cosmetic flicker;
  pre-existing for concurrent `loadPlotted`). A batch token would fix
  it — deferred, follow-up candidate.
- **`rejectedEntries` survives Clear all:** the "N entries skipped"
  notice is send-feedback, not plotted membership — intentionally kept
  (it lives in `option-chart-load.service`, unreachable from the
  store). Panel stays mounted showing just the notice in that state.
- **Head count under focus:** drilled into a contract, the head reads
  `{N} plotted` while `chipContracts()` renders 1 chip — accurate
  (the set persists); the button now cleanly clears set + drill-down
  thanks to F1's fix.
- **Wasted fetches after clear:** workers keep `shift()`-ing queued
  contracts after a clear; results are correctly dropped. Perf nit.
- **No `focus-visible` style on the new button** — siblings lack one
  too; consistent as-is.

## Test evidence

- New review specs: 4/4 red before fix → green after
  (`#1516`-tagged in `plotted-contracts-feature.spec.ts`)
- Focused suites (feature spec + DOM spec): **66/66**
- Wider suites (stores + option-chart + contract-chart): **765/766** —
  the one failure was a `beforeEach` TestBed-compile timeout under
  parallel-worker contention on the first DOM test (environmental;
  re-run `--runInBand` → **8/8 green**)
