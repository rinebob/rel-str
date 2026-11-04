**Topic:** Options Backtest  
**Topic Slug:** 1238-backtest  
**Thread:** Backtest Analytics  
**Thread Slug:** 1266-backtest-analytics  
**Issue:** #1366  
**Thread Parent:** #1266  
**Topic Parent:** #1238  
**Task:** #1374  
**Domain:** BACKTEST  
**Type:** CODE-REVIEW  
**Status:** Complete  
**Created:** 2026-11-04  
**Last Updated:** 2026-11-04  

# CODE-REVIEW — #1374 options-replay-run-controls toolbar

**Verdict: PASS — two rounds.** Three axes (Standards, Spec, Thermo-Nuclear)
all landed approve-with-minors both rounds; every convergent finding was
remediated in-cycle.

## Scope

New `options-replay-run-controls` toolbar — status pills (symbol-status
vocabulary), template select from the seeded `REPLAY_TEMPLATES` registry,
symbol search, sort field + direction, New Replay primary action
(relocated from the section header per IMPL-FE §1's `newReplay`
passthrough). Plus `hasActiveFilters` on `options-replay-run-list` with
filter-miss empty copy (the documented #1373 deferral), dashboard wiring
onto the #1373 store surface, and a "Clear filters" affordance added
in-cycle.

## Axis results

| Axis | Verdict | Notes |
|---|---|---|
| Standards | MINOR → clean | Faithful port; signals/OnPush/`import type`/jest-style specs all conform. 7 findings — a11y trio + layout guard + dead rules remediated below |
| Spec | ALL ACs MET | Full emit→setter→`filteredRows` chain cited; TEST-FE row fully covered; no scope creep |
| Thermo-Nuclear | Sound, ship-with-minors | 9 findings + 3 judo moves; dead-store-surface and UX-loop items remediated below |

## Remediated in-cycle

| Finding | Fix |
|---|---|
| TN-1: `store.toggleSortDirection` dead + flip duplicated in component | Store method deleted (+ its spec); component's value-emitting `sortDirectionChange` → `setSortDirection` is the single flip site (preserves IMPL-FE `*Change` contract and legacy parity — TN's own alternate option) |
| TN-2 + UX loop: `resetFilters` dead; "No rows match the current filters" invites an action nothing offered | `hasActiveFilters` input + `resetFilters` output + conditional "Clear filters" pill on the toolbar → `replayStore.resetFilters()`; revives the dead method |
| Standards: a11y — unassociated labels, icon-only accname, visual-only pill state | `aria-label` on both selects + symbol input; `aria-label` on sort-direction button; `aria-hidden` on `add` icon; `role="group" aria-label` + `aria-pressed` on status pills |
| Standards: missing `flex-shrink: 0` host guard on the strip | `app-options-replay-run-controls { flex-shrink: 0; border-bottom }` inside `.replay-content` (mirrors sim-section rule) |
| Standards: dead flex/spread rules on `.replay-header` after button moved | rules dropped |
| TN-3: dead `.run-now-btn mat-spinner` SCSS (copied from legacy) | removed |
| TN-6: filter defaults restated in 3 places | `DEFAULT_REPLAY_FILTERS` const → initialState + `resetFilters` + `hasActiveFilters` |
| Spec-F1: absence-check selectors were tautological | pinned `.filter-label` texts to exactly [Status, Template, Symbol, Sort] |
| TN-7: no `[value]` round-trip spec | sortBy round-trip spec added |
| Store spec broke on `MatSnackBar` stub vs committed `DsToastService` | provider token swap — remediation of a ship artifact (see below) |

## Ship-artifact note (transparency)

Commit `049dccf3` (#1373 ship) captured the user's in-flight
`MatSnackBar`→`DsToastService` conversion of `options-replay.store.ts` —
the foreign-marker check at that ship covered dialog/tooltip tokens but
not the snackbar token. The committed store is correct; only the spec's
provider token lagged. Fixed here (import + provider swap) so the suite
is green again.

## Documented deferrals

- **Shared control-strip SCSS extraction** (TN judo 3 / Standards 5): the
  ~120 shared `.run-control-*`/`.pill-*`/`.filter-*` lines now exist in
  three places, but `backtest-run-control` is parked (`showSimRuns =
  false`) — one live consumer, rule-of-three not met. Extract when legacy
  revives or a third toolbar lands.
- **Select desync on retired template id** (TN-5): `[value]` binding can't
  render an unlisted value; unreachable today (options and filter share
  `REPLAY_TEMPLATES`). Revisit if template retirement lands.
- **Props-tunnel granularity** (TN-4): 6 in/6 out matches the sibling and
  the dumb-view mandate — keep.
- **Dashboard-level integration spec**: TEST-FE doesn't require one; the
  wiring is a 1:1 copy of the proven legacy binding.
- **`.run-now-btn` naming** (port artifact, shared with both siblings —
  renaming only this one creates inconsistency).
- **Rerun action** stays a later task (`runStatus` already on rows).

## Verified

- `jest options-replay` → **97/117 pass**; the 20 failures are all in the
  user's three in-flight de-materify spec suites
  (`contract-series-dialog`, `new-run-dialog`, `run-detail` — their
  uncommitted `DsDialogService` conversions vs `MatDialog` stubs). Every
  task-scoped suite is green: run-controls **14/14**, run-list, store
  (incl. the `DsToastService` fix).
- `tsc --noEmit -p tsconfig.app.json` clean · `git diff --check` clean on
  task files.
- `ng build` currently blocked by a **foreign** strict-template error in
  `topic-viewer-page.component.ts:33` (user's in-flight work — template
  check only, tsc passes). Task template itself compiles under TestBed
  (spec suite) and mirrors proven bindings; re-verify at ship.

---

## Round 2 — post-remediation re-review

The working tree moved between rounds: the user de-materified the new
component in place (`mat-icon` → `span.dse-icon`, `mat-spinner` →
`span.dse-spinner --spinner-size`, `MatIconModule`/`MatProgressSpinnerModule`
dropped from imports) — the repo's design-system direction, evaluated as
correct (byte-identical convention to the sibling strip and ~30 sites).

All three axes re-verified every round-1 remediation at source level —
no broken fixes, all 3 ACs still MET (Spec: PASS, zero new defects;
Standards: MINOR; TN: APPROVE / ship-with-minors).

| Finding | Axes | Disposition |
|---|---|---|
| Sort-direction `dse-icon` missing `aria-hidden` (the `mat-icon`→`span` swap dropped the implicit SR-hide; `add` icon had it, this one didn't) | all 3 | **FIXED** — `aria-hidden="true"` added |
| Run-list `status-icon` + empty-state `inbox` spans expose ligature text to SRs (same mat→dse regression, foreign line but in-scope file) | Standards + TN | **FIXED** — `aria-hidden="true"` on both |
| `hasActiveFilters` sort-exclusion predicate unpinned | TN | **FIXED** — spec: sort changes → `hasActiveFilters() === false` |
| `snackBar` identifier survived the `DsToastService` conversion in store + spec (ship-captured foreign line) | TN | **FIXED** — renamed `toast` (store :162/180/281/290 + spec vars) |
| `DEFAULT_REPLAY_FILTERS` doc overstated `hasActiveFilters` coverage | Standards | **FIXED** — comment now describes the actual predicate |
| `ng build` foreign block resolved mid-round — `topic-viewer` + trade-journal errors fixed by user; `tsc` now clean repo-wide | — | re-verified clean |
| Dead `mat-spinner` selector in sibling `backtest-run-control.component.scss:26` | Standards + TN | **DEFERRED** — AC3 requires the legacy control untouched; belongs to the user's de-materify sweep |
| `BacktestUiStore.toggleSortDirection` dead method (same class removed from replay store R1) | TN | **DEFERRED** — sibling store, sweep/parity cleanup |
| 2px double border-bottom under strip (host + card edges stack) | Standards + TN | **DEFERRED** — identical on sim sibling; consistent visual language, fix both or neither |
| `CommonModule` imported but only `@if`/`@for` used; component input defaults restate store defaults (module-private const) | Standards + TN | accepted — sibling boilerplate convention; bounded drift risk |

### Round-2 test results

- `jest options-replay-run-controls options-replay-run-list options-replay.store` →
  **54/54 PASS** (incl. new predicate-boundary spec + `dse-icon` glyph pin)
- `tsc --noEmit -p tsconfig.app.json` clean repo-wide

### Round-2 verdict

**PASS reaffirmed.** No new majors; every new minor in scope fixed, the
rest are documented sweep-level deferrals outside AC3's "legacy untouched"
boundary. Trajectory converged — no third round warranted.
