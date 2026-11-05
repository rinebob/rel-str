**Topic:** Options Backtest  
**Topic Slug:** 1238-backtest  
**Thread:** Backtest Analytics  
**Thread Slug:** 1266-backtest-analytics  
**Issue:** #1366  
**Thread Parent:** #1266  
**Topic Parent:** #1238  
**Task:** #1375  
**Domain:** BACKTEST  
**Type:** CODE-REVIEW  
**Status:** Complete  
**Created:** 2026-11-05  
**Last Updated:** 2026-11-05  

# CODE-REVIEW — #1375 rerun button wiring (`optionsReplayRetry`)

**Verdict: PASS — two rounds.** Round 1 landed all-ACs-MET / MINOR /
ship-with-minors; round 2 surfaced one Major (snapshot-coalescing could
strand the in-flight flag forever), fixed in-cycle and re-verified.

## Scope

Wire the already-shipped `optionsReplayRetry` callable (#1369) into the FE:
`retryRun` on `OptionsReplayRunsService` + `OptionsReplayStore` (with a
`retryingRunIds` in-flight guard), a per-row rerun action on
`options-replay-run-list` rendered only on `symbolStatus === 'failed'`
rows, and dashboard wiring. Retry is run-scoped — one click retries every
failed symbol in the run; post-retry row transitions arrive via the
existing `watchRuns` stream (the BE deletes failed `listOutcomes` entries
transactionally, so rows flip failed→pending and the button hides).

## Verification

- `jest options-replay-run-list options-replay.store` → **52/52**
- `tsc --noEmit -p tsconfig.app.json` — clean

## Axis results (round 1)

- **Spec — all 3 ACs MET.** The full emit→store→service→callable chain was
  verified at source level against `retry.ts`: the FE disable predicate
  (`pending|running|cancelled` + in-flight set) mirrors the BE
  `RETRY_NOOP_STATUSES` exactly; `completed`+failed rows (the dominant
  partial-failure case) stay enabled. AC3's listener-driven transition was
  traced end-to-end (`listOutcomes` delete → derived `pending` →
  `showRerun` false).
- **Standards — MINOR.** Wrapper is a line-for-line mirror of
  `startReplay`; toast contract, settle handling, `ReadonlySet` semantics,
  view-model precompute, and a11y (`aria-label`, `title`, `aria-hidden`
  icon, `type="button"`) all match or exceed convention.
- **Thermo-Nuclear — ship-with-minors.** Flag cannot leak (SDK 70s
  callable timeout → catchError → clear); run-scoped flag correctly
  disables all failed rows of a run; disabled-button clicks can't select
  rows on supported browsers; stale-row clicks are safe by the
  transactional BE re-check.

## Remediated in-cycle

| # | Finding | Axes | Fix |
|---|---|---|---|
| 1 | Re-enable gap: flag cleared on callable response while the post-retry snapshot lagged ~100–500ms → a fast second click yielded a misleading "Nothing to retry" toast | Spec + TN | Flag now holds after a real retry until the `watchRuns` patch shows the run's failed outcomes gone; clears immediately only on error / empty `retriedSymbols` (no doc change coming). Self-heals any future flag leak. |
| 2 | Dead `.rerun-btn:disabled` block duplicating the global `icon-btn` mixin output verbatim | Standards + TN | Removed; `color: var(--mat-sys-error)` retained. |
| 3 | Dominant `'completed'`+failed enabled path unasserted; same-run multi-row disable unpinned | TN | Two component specs: 'completed' row in the disable matrix; one in-flight flag disables both failed rows of a run. |
| 4 | AC3 covered only implicitly | Spec | New `runRows` spec: failed outcome → dropped outcome snapshot → `pending`. |
| 5 | Per-run guard granularity untested | Standards | `retryRun('run-2')` during a `'run-1'` retry → second service call. |
| 6 | Service JSDoc omitted error paths | Standards | Appended "throws for missing/unknown runs and enqueue failures". |

## Documented deferrals (accepted residuals)

- **No FE re-validation on click** (TN-M2): a stale-render click burns a
  callable; the transactional BE re-check returns `[]` and the toast is
  truthful. UX polish, not correctness.
- **N identical run-scoped buttons per run** (TN-M4): labels/toasts are
  run-scoped and honest; a per-run single-button placement is a design
  question for a later pass if it reads ambiguous in UAT.
- **`defer()` around the callable** (TN nit): a synchronous construction
  throw is near-impossible (live root injector); `from()` is consistent
  with `startReplay`.
- **70s client vs 300s BE timeout** (TN nit): an over-70s retry toasts
  "deadline-exceeded" while the BE may still finish — self-heals via the
  listener; special-casing deferred.
- **No service spec / no dashboard-level spec**: consistent with
  `optionsReplayStart` posture and the #1374 precedent (TEST-FE §38
  dashboard wiring is covered end-to-end by the component + store specs).
- `onRerun` param typed as base `ReplayListRow`, `rerun` vs `retryRun`
  naming asymmetry, `title` duplicating `aria-label` — cosmetic, noted.

## Round 2

Re-run after R1 remediation — fresh 526-line diff, all three axes re-verify
R1 fixes intact at source level.

**TN — one Major found and fixed:** the prune predicate required a
zero-`failed` snapshot, but a retried symbol that re-fails fast
(permanent failures like 404 pick-docs — precisely the symbols users
re-retry) can write `'failed'` back within the same Firestore
snapshot-coalescing window as the post-tx state. Every delivered snapshot
then shows a failed outcome → flag held forever → session-scoped dead
button. Fixed: the retry tx flips `status→'running'` in the same commit
as the outcome deletions, so the prune now clears on `status === 'running'`
OR failed-outcomes-gone OR run-absent. Spec pins the coalesced
`'running'`+`{SPY:'failed'}` delivery and the dropped-from-snapshot case.

**Also remediated:** absent-run prune (fixes the "or the run vanished"
comment/code mismatch both Standards and Spec flagged); state-field +
prune comments rewritten to match the actual predicate; component header
comment now documents the rerun affordance; `color: var(--mat-sys-error)`
→ `var(--ds-error)` (DS token convention).

**Deferred:** handler param-order drift (cosmetic), single-row in-flight
spec subsumed by the multi-row spec (kept — documents the single-row
case), terminal re-fail coalescing residual (requires a full
enqueue→fail→close-out round-trip inside one delivery window — defensible
per scope discipline; every axis agrees no airtight fix is warranted).

**Verification:** `jest options-replay-run-list options-replay.store` →
**54/54** (+2 specs) · `tsc --noEmit` clean.

**Round-2 verdict:** converged — no round 3. Remaining items are all
documented residuals; another agent round would hunt outside the diff.

## Task diff

`.devin/tmp/1375-r1-diff.txt` (round 1), `.devin/tmp/1375-r2-diff.txt`
(round 2, pre-remediation; remediation is the current working tree).
