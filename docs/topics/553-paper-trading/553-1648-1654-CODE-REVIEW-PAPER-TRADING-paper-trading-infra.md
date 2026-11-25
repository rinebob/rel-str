**Topic:** Paper Trading Infra  
**Topic Slug:** paper-trading  
**Thread:** Signal Selection  
**Thread Slug:** signal-selection  
**Issue:** #1654  
**Thread Parent:** #1117  
**Topic Parent:** #553  
**Blueprint:** #1648  
**Domain:** FE  
**Type:** CODE-REVIEW  
**Status:** Complete  
**Created:** 2026-11-24  
**Last Updated:** 2026-11-24  

# Code Review — #1654: FE-IMPL occurrence pane + checkbox toggles

**Verdict: PASS** — two passes; 2 majors + ~8 minors fixed in-gate; no
blockers remain. AC1–AC6 all MET (Spec axis verified each against the
diff, not the spec files).

## Axes

| Axis | Result | Findings |
|------|--------|----------|
| Standards (repo conventions + Fowler baseline + contract baseline) | PASS after fix | 1 major, 4 minors, ~6 nits |
| Spec (ACs + IMPL/TEST Phase-2 sections) | MET ×6 | 1 spec gap, 2 doc nits |
| Thermo-nuclear (races, state leaks, structural) | PASS after fix | 2 majors, 4 minors |

## Majors fixed in-gate

1. **Checkbox/ledger divergence on refused or failed toggles**
   (Standards + Thermo, both). `[checked]` rewrites the DOM only when the
   bound value changes — a refused delete left the box displaying
   *unchecked* against a live trade, and the next click would dispatch
   the opposite of what the user saw. `onBoxChange` now snaps the
   element back to `occ.checked` on every tap — the box only ever shows
   confirmed state; pending disable + spinner signal the in-flight op.
   `occurrence-list.component.ts:55-63`. Pin: spec "snaps the box back
   to model state on tap".
2. **Select×toggle interleave silently drops confirmed mutations**
   (Thermo M2). A toggle resolving inside a `selectSymbol` refetch
   window patched the doomed bundle; the arriving stale join then
   rendered the pre-toggle row (unchecked while a trade exists; or a
   phantom check after a delete). `confirmedPatches` — a session overlay
   keyed by occurrenceId — records every confirmed outcome and is merged
   into each arriving bundle (`store:186-190`, `:240-254`). Bounded
   staleness is acceptable: this pane is the sole mutator of these rows.
   Pin: spec "survives the select×toggle interleave".

## Minors fixed in-gate

- **Queue-response overwrite of the open stamp** (Thermo m2) —
  `ngOnInit` fires `loadQueue` + `selectSymbol` in parallel; a queue
  response carrying the pre-open stamp could revert the propagated
  `openedAt` and resurrect the new-signal dot on the just-opened symbol.
  `queueSeq` guard (parallel to `bundleSeq`) + `symbolOpenedAt` session
  map — written on every bundle read, merged into queue rows whenever
  they (re)arrive, so the merge works even when the row didn't exist at
  propagation time. `store:138-163`, `:196-198`. Pin spec included.
- **Bundle keyed by the response symbol** (Thermo m4) — `res.symbol`,
  not the request param: a wrong-payload response can no longer launder
  foreign rows under this selection's header.
- **rowErrors staleness** (Standards minor / Thermo m1) — same-symbol
  row errors clear on successful bundle load: a fresh join means fresh
  row state. Pin spec included.
- **`'mint returned no result'` misdiagnosis** (Thermo m3) — a result
  that arrived without `tradeId` now reports `'mint result missing
  tradeId'`. Pin spec included.
- **Spec gap** (Spec axis) — `getSignalReviewBundle$` request-arg pin
  added (`toHaveBeenCalledWith('AAPL')`).
- **`tradeStatus` after mint** — left `undefined` deliberately
  (`MintResult` carries no status; a deduped join could be any lifecycle
  state) — now documented at the patch site.
- Housekeeping: `@task #1654` tag, merged `@angular/core` imports,
  `previousOpenedAt!` → hoisted const, stale "Phase-1 shell" header.

## Deferred / noted

- `confirmedPatches` never expires within the session — bounded
  staleness under the sole-mutator assumption (documented in the state
  field's docblock). An external delete wouldn't be reflected until a
  new confirmed toggle or page session.
- `signal-review.store.spec.ts` is ~550 lines — over the 400-line
  guideline smell threshold; spec files are naturally repetitive and
  this is repo-common. Noted only.
- `Object.fromEntries(Object.entries(m).filter(...))` delete-key idiom
  kept — explicit and greppable; the rest-spread alternative saves
  little.
- Uppercase legacy `direction` values would render unstyled — a
  server-side `normalizeStSignalDirection` concern, not this task's.
- `tradeId: undefined` in a delete patch leaves the key present —
  harmless; flagged if anything ever does `'tradeId' in o`.

## Spec coverage added during review

Snap-back visual state, select×toggle interleave, unknown-occurrenceId
guard, mint-success-without-tradeId, row-error clear on re-open, queue
stamp merge, `getSignalReviewBundle$` request arg.

## Verification

- `npx jest --coverage=false` — **338/338 suites, 6,471 tests** green.
- `tsc --noEmit -p tsconfig.app.json` — 0 errors tree-wide.
- Focused: 50/50 across the three spec files.

## Files

- `src/app/features/savant-trader/stores/signal-review.store.ts` (+ spec)
- `src/app/features/savant-trader/pages/symbol-review/occurrence-list.component.{ts,html,scss,spec.ts}` (new)
- `src/app/features/savant-trader/pages/symbol-review/symbol-review.component.{ts,html,spec.ts}`
