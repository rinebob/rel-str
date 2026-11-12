**Topic:** Option Contract Time-Series Viewer  
**Topic Slug:** option-contract-viewer  
**Thread:** Multi-symbol input  
**Thread Slug:** multi-symbol-input  
**Issue:** #1261  
**Thread Parent:** #1244  
**Topic Parent:** #1243  
**Task:** #1440  
**Domain:** OPTIONS  
**Type:** CODE-REVIEW  
**Status:** Complete  
**Created:** 2026-11-11  
**Last Updated:** 2026-11-11  

# Code Review — Task #1440 (BUG: Symbol swap leaves prior symbol's contracts/chips plotted)

**Verdict: PASS (Round 2 — converged)** — Round 1 produced five majors, all
fixed in-gate and spec-pinned. Round 2 (three axes, final-state re-review)
confirmed every Round-1 fix and produced three more real gaps — a missing
entry point, a surviving slice, and an await window — all fixed in-gate and
spec-pinned. No further pass needed: every async write path and every
session entry point is now guarded or pinned (see "Guard matrix"). Focused
suites 658/658 (29 suites); tsc clean on touched files; `git diff --check`
clean. The unrelated full-suite failures (`core.component.spec.ts`,
`SidenavMenuComponent.isActive`) are another session's uncommitted WIP in
`src/app/core/` — no #1440 file is implicated.

## Round 2 (delta-scoped on the Round-1 fix machinery, plus entry-point audit)

| Axis | Result |
|---|---|
| Standards | **PASS after fixes** — confirmed all 5 round-1 fixes; found the `initSession` gap + `spy`-naming nit |
| Spec | **PASS after fixes** — ACs re-verified on final shape; found the `confirmAndLoad` await gap + unsequenced catalog writes (deferred, different slice) |
| Thermo-nuclear | **APPROVE** — seq/token judo validated; flagged the surviving `underlyingBars` slice |

Round-2 findings, all fixed in-gate unless noted:

- **R2-1 [major] `initSession` skipped the reset.** The viewer store is
  `providedIn:'root'` — it survives page teardown, so re-entering
  `/options/chart` re-mounted the previous session's plotted contracts
  under the fresh page's default 'QQQ' — the same overlay defect through
  an uncovered entry point. Fix: `resetSession()` at the head of
  `initSession` (runs before `bindDeepLink`/`bindResultsDeepLink`, so
  deep-link applies are unaffected). Spec pinned.
- **R2-2 [minor→fixed] `underlyingBars`/`underlyingBarsRange` survived
  `resetSession`** — flagged independently by all three axes: the old
  symbol's price line rendered under the new symbol until its refetch
  landed (indefinitely on error). Both fields now clear in the same
  atomic patch — nothing foreign renders, even transiently.
- **R2-3 [medium] `confirmAndLoad` await gap.** The >50 confirm parses
  against the old symbol then `await`s; a swap mid-dialog left the
  parsed foreign entries valid at confirm time → `loadPlotted` re-plot
  them under the new symbol — the exact defect reopened. Fix: capture
  `symAtSend` before the await, drop the set if `page.symbol()` moved.
  Covers both callers (textarea path + `emitEntriesToChart`). Spec pinned.
- **R2-4 [low, deferred] Unsequenced catalog writes** —
  `loadContractIndex`/`loadCatalogSummary`/`queryCatalog` responses have
  no staleness guard; a slow old-symbol response can write foreign
  catalog/index data post-swap. Pre-existing, catalog-panel surface (not
  the chart overlay), wider than this bug — recorded as a follow-up, not
  fixed here.
- **R2-5 [trivial, deferred]** a stale `loadPlotted` worker can clobber a
  NEW batch's `plottedLoadProgress` counter mid-flight — cosmetic only.
- **R2-6 [nit, fixed]** Subject named `spy` shadowed the `jest.spyOn`
  idiom → renamed `spyBars`.
- **R2-7 [nit, deferred] reset asymmetry** — `displayWindow` resets,
  `chartPadDays` survives. Judged defensible: the window is set-scoped
  state (meaningless with zero plotted entries); the pad is a
  symbol-agnostic fetch preference.

## Axis summaries

### Standards — PASS after fixes

- **[major] Vacuous assertion.** `expect(rangeBars).not.toHaveBeenCalledWith('QQQ', expect.anything())`
  could never match a 3-arg `loadUnderlyingBarsForRange` call — the
  yank-back regression it claimed to pin was unverified. Fixed:
  `not.toHaveBeenCalled()` (no swap-path code calls the ForRange seam).
- **[major] `loading` strand on non-swap focus releases.** The first
  guard shape (`focus !== parsed.contractID → return`) dropped responses
  for `removePlotted`/`clearChartFocus` mid-flight too, which null focus
  without clearing `loading` — a spinner could strand forever. Fixed by
  the seq model (below): released-mid-flight loads keep their seq and
  complete exactly as before.
- **[nit] Spec re-injected `OptionChartLoadService`** instead of using
  `setup()`'s return — destructured.
- Verified: comment style, `patchState` idioms, named-reset convention
  (`clearPlotted`/`clearCatalog`), sanctioned `setTimeout(0)` spec flush,
  no `as any`, all five symbol-switch paths funnel through
  `page.onSymbolChange`.

### Spec — PASS (all 3 ACs met)

- AC1 "onSymbolChange clears plotted contracts + chips + focus" — MET
  (`resetSession` atomic patch).
- AC2 "plotted-set input decided + implemented (clear)" — MET
  (`page.occIdInput` pre-existing clear; `store.occIdInput` via
  resetSession).
- AC3 "spec pins + swap-path regression" — MET (7 #1440 specs).
- **[major] `fetchUnderlyingBars` unsequenced** — an in-flight old-symbol
  bars fetch resolving after the swap's `loadUnderlyingBars(newSym)`
  overwrote `underlyingBars` with foreign bars. Same defect class.
  Fixed: `lastBarsRequest` closure token — latest-request-wins for both
  `next` and `error` handlers (stale error can't kill a newer request's
  spinner either).
- Judged justified-adjacent (not creep): the viewer-slice reset and
  in-flight guards are required by the same overlay symptom — the series
  projection draws `contractData` whenever the set is empty, focus flag
  or not.

### Thermo-nuclear — APPROVE after fixes

- **[major] Focus-token aliasing** — two overlapping loads of the SAME
  contract id share one focus token: the loser's error could release
  focus/kill the spinner the winner owns, then the winner's success is
  dropped → error shown for a successful fetch. Fixed: `contractLoadSeq`
  monotonic counter bumped at load intent and by `resetSession` — all
  superseded/orphaned responses drop, aliasing class eliminated.
- **[major] Mandatory reset pairing** — `resetContractView` +
  `clearPlotted` had to be called together or a lone call strands a
  focused loading-chip. Fixed: folded into one `store.resetSession()` —
  seq bump + single atomic `patchState` of `{...initialPlottedState, …}`
  (one call site in `onSymbolChange`; `store.clearPlotted` unreachable
  inside the earlier `withMethods` — composition order — the spread is
  also more atomic than two patches).
- **[minor, pre-existing] Raw vs normalized `value`** inside
  `onSymbolChange` (`symbol.set(value)` vs `loadSymbolData(trim/upper)`)
  — flagged, not worsened.
- **[nit] Asymmetric session resets** — `displayWindow` resets via the
  plotted slice, `chartPadDays` survives. Both user view-prefs; policy
  choice left as-is.
- **[minor, follow-up] Old symbol's `underlyingBars` render during the
  new fetch window** — "stale beats empty" by design; out of this bug's
  contract-overlay scope.

## Guard matrix (final state)

| Async write path | Staleness mechanism |
|---|---|
| `loadContractInternal` next/error | `contractLoadSeq` — bumped at every load intent + `resetSession`; superseded/orphaned responses drop |
| `loadPlotted` workers | `current?.status === 'loading'` re-read — reset removes the record, late fetches can't resurrect it (pre-existing) |
| `fetchUnderlyingBars` next/error | `lastBarsRequest` identity token — latest-request-wins across all 7 fetch entry points |
| `confirmAndLoad` (>50 await) | `symAtSend` re-check post-await — a mid-dialog swap drops the foreign parsed set |
| Session entry points | `onSymbolChange` + `initSession` both call `resetSession` — every swap path + page remount covered |

`resetSession` = seq bump + ONE atomic `patchState` of
`{...initialPlottedState, underlyingBars, underlyingBarsRange,
occIdInput, loading, error, contractData, currentSearchIndex}` — no
half-reset call sites exist.

## Spec pins added (10)

Set-swap clear (contracts+hover+pin+focus); focused-swap clear
(contractData+loading+error+store occIdInput); in-flight response drop
(no repaint, no `ForRange` call); in-flight error drop; same-id
supersede race (stale error can't kill the newer load); released
mid-flight load still completes; stale underlying fetch dropped;
`initSession` clears the surviving root-store session; `loadPlotted`
worker can't resurrect post-swap; mid-confirm swap drops the parsed set.

## Test results

- `option-chart` + `stores` suites: **658/658 PASS (29 suites)**.
- `npx tsc --noEmit` — 0 errors on touched files (pre-existing errors in
  `scripts/bulk-swing-sweep.ts` + `portfolio-dashboard.store.spec.ts` are
  other sessions' WIP).
- Full suite: 5,465/5,477 — the 12 failures are `core.component.spec.ts`
  (`SidenavMenuComponent.isActive`, `currentUrl()` undefined) in another
  session's uncommitted `src/app/core` WIP; unrelated to this diff.
- `git diff --check` — clean.

## Files in this task

- `src/app/features/savant-trader/stores/options-contract-viewer.store.ts`
  (`contractLoadSeq`, guards, `resetSession`)
- `src/app/features/savant-trader/stores/underlying-bars-feature.ts`
  (`lastBarsRequest` token)
- `src/app/features/savant-trader/pages/option-chart/option-chart-page.service.ts`
  (`resetSession` call in `onSymbolChange` + `initSession`)
- `src/app/features/savant-trader/pages/option-chart/option-chart-load.service.ts`
  (`symAtSend` guard across the >50 confirm await)
- `src/app/features/savant-trader/pages/option-chart/option-chart-services.spec.ts`
  (10 specs — file also carries #1431's uncommitted `?results=` work;
  hunk-scope at ship)

## Scope addendum (post-QA, user-directed) — auto-swap on foreign underlying

After the Round-2 PASS and the executed UAT, the user folded one behavior
change into this task's ship: the `wrong-underlying` parse gate that
blocked pasted/sent contracts whose embedded symbol ≠ the page symbol is
replaced by an **auto-swap** — the input's dominant underlying drives
`page.onSymbolChange` (the same full session-reset path as a manual
swap), then the load proceeds. Minority underlyings in a mixed paste are
still rejected as `wrong-underlying` against the detected symbol.

Applied on both load seams: textarea/picker sends (`onLoad`, which also
covers `emitLinesToChart`) and pre-built entry sends
(`emitEntriesToChart`, the `?results=` path — previously it could plot a
foreign set under the wrong underlying with no guard at all).

Files: `plotted-pairs.util.ts` (`symbol` param now optional; new
`dominantUnderlying` helper — majority vote, first-seen tiebreak) and
`option-chart-load.service.ts` (`retargetUnderlying` seam; occIdInput
restored after the swap clears it; rejectedEntries set post-swap so the
`onSymbolSwitched` hook can't wipe the fresh notice).

Spec pins added (7): unconstrained parse accepts any underlying;
`dominantUnderlying` majority / first-seen tie / empty; foreign paste
swaps + loads + restores field; bare foreign id swaps then focused-
loads; mixed input swaps to majority + rejects rest; same-symbol load
never fires the swap path.

Test results after addendum: 8 suites / 194 focused specs PASS;
`tsc --noEmit` clean. UAT doc gained scenario 10 (foreign-underlying
auto-swap) — **executed 2026-11-12, PASS** (all three sub-cases).
