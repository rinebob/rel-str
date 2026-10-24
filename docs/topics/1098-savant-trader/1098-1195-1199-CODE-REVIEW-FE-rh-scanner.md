**Topic:** Savant Trader  
**Topic Slug:** savant-trader  
**Thread:** FE Blueprint — Auto-Run Scans  
**Thread Slug:** scanner-auto-run  
**Issue:** #1195  
**Thread Parent:** #1183  
**Topic Parent:** #1098  
**Task:** #1199  
**Domain:** FE  
**Type:** CODE-REVIEW  
**Status:** Complete  
**Created:** 2026-10-22  
**Last Updated:** 2026-10-22  

# Code Review — #1199 Page rebuild (auto-run overview)

## Verdict

**PASS** — one remediation round. Three axes (standards / spec /
attack) reviewed the post-implementation working-tree diff
(`.devin/tmp/1199-review.diff`, ~1380 lines). One convergent MEDIUM +
a handful of LOWs; all material items remediated in-review.

## Scope

- REWRITE: `pages/scanner/scanner.component.{ts,html,scss}` — the
  single-run page becomes the auto-run overview (init wave + 15-min
  interval + stacked recipe tables + Run-all/auth header).
- REWRITE: `pages/scanner/scanner.component.spec.ts` — 13 specs per the
  TEST plan.
- DOC: IMPL §3/§4 synced to as-built (SymbolListStore injection note).

## Round 1 findings → dispositions

### Convergent (standards MEDIUM, echoed by spec + attack)

- **Successful reauth did not dismiss the banner.** `onReauth` only
  called `store.clearError()`, but `authFailed` derives from
  `runs[].errorKind` — which clears per-recipe only on relaunch
  (#1198 semantics). The banner would sit there post-auth until the
  user separately clicked Run all or waited for the interval.
  **Fixed:** successful reauth now calls `store.runAllRecipes()` —
  each relaunch clears its `errorKind`, the banner drops as recipes
  launch, and the failed tables actually re-fill (matches the banner
  copy's promise). Spec now pins the re-fire.

### Remediated LOWs

- **"no calls continue off-page" overstated** — the page interval stops
  re-arming, but an already-fired stagger wave completes in the
  root-scoped store (~seconds). Comment + spec name reworded.
- **`REFRESH_MS` duplicated literal in spec** — kept deliberately (pins
  the PRD's 15-min contract; importing the component const would let a
  cadence change pass silently); comment added saying so.
- **Dead `store.error`/`requiresReauth` channel** — nothing on the
  rewritten page writes `error` today; retained as forward-compat for
  the (still-on-disk) single-run machinery, now commented in the
  template; `requiresReauth` branch spec'd anyway.
- **Snack copy drift** — "retry the scan" → "re-running the scans"
  (matches the reworded banner + the new auto re-fire).
- **Live-propagation pin** — binding spec now also asserts a post-init
  `runs.set()` reaches the table's `run` input (was pre-init only).

### Accepted / flagged (no change)

- Interval keeps firing while `authFailed` — every tick retries all 9
  calls; harmless load and doubles as self-heal detection.
- Every remount fires a full wave (no freshness check) — the "run on
  mount" design; `loadTrackedSymbols` is TTL-cached upstream.
- Interval tick mid-wave re-launches in-flight recipes — seq tokens
  drop the stale completions; bounded (≤1 extra call per recipe/tick).
- No `AbortSignal` on hung calls — self-heals via next wave.
- jsdom can't verify the actual `overflow-y` scroll region or
  horizontal clip on very wide tables — flagged for QA visual pass.
- Reauth banner has no dismiss affordance (only reauth+relaunch or a
  later wave clears it) — accepted; the error-free path is the exit.

## Verified clean (attack axis)

- Interval arm/clear/remount lifecycle; double-mount; interval-vs-click
  same-tick re-entry (store's pendingLaunches + seq tokens hold).
- `runs()[recipe.id]` can never be undefined (both seeded from the same
  catalog constant; nothing deletes run keys).
- `lastRefresh` ISO-string max — single `toISOString()` writer.
- `tracked()` memoizes; one Set instance feeds all 9 tables.
- Template transient states all guarded (`@if` on run status, error,
  lastRefresh); error-status tables render nothing.
- Per-entry settle re-binds only that table (map spread preserves
  untouched entry identity) — no 9-table recompute stampede.

## Verification

- 13/13 `scanner.component.spec.ts`; 41/41 across the three scanner
  page suites; 2513/2513 feature-wide (pre-remediation run; touched
  files re-verified post-remediation)
- `npx tsc --noEmit -p tsconfig.app.json` — clean
- `git diff --check` — clean on the scanner fileset
- Fake timers per AGENTS.md — `jest.useFakeTimers` +
  `advanceTimersByTime`; no banned `setTimeout` flush (the async reauth
  spec uses `await fixture.whenStable()` on real timers)

## Round 2 — rail + detail rework (post visual-QA fail)

Scope: the stacked-table layout failed user visual QA; the `?variant=`
prototype picked rail + detail (scoreboard rail, selected-recipe
detail). The rework also added full-width layout, the `filters_applied`
header echo, magnitude-aware `displayCell` formatting, and `first N of
M` truncation disclosure. Three axes re-ran on the worktree diff.

### Standards — findings → dispositions

- **MED Duplicated Code — `baselineRows` re-composed the table's
  parse→dedupe→mergeLookup pipeline — fixed.** `scanRunRows` extracted
  to `scanner-rows.util`; the table's `rows`/`lookup` computeds now
  delegate via one `prepared` pass; the rail consumes the same prefix.
- **LOW nested status/count ternaries — fixed** (switch → then
  simplified further by the thermo axis's status-field deletion).
- **LOW tautological `.table-scroll` spec assertion — fixed** (replaced
  with a structural parentage pin; jsdom can't assert overflow).
- **NIT `--ds-font-size-xs` doesn't exist / `var(--ds-radius-sm, 8px)`
  dead fallback — fixed** (`11px` literal per `td.mono` convention;
  bare `--ds-radius-sm`).
- **NIT `@task` tags — fixed** (`#1197, #1199` on recipe-table files).
- **NIT `aria-pressed` → `aria-current`** (selection list, not a
  toggle button) — fixed.
- Retained dead `store.error`/`requiresReauth` banner — documented
  forward-compat retention, accepted both rounds.

### Spec — findings → dispositions

- **LOW `filterSummary` could throw on a drifted `filters_applied`
  entry — fixed** (per-field typeof guards; malformed entries render
  nothing rather than crash the table's computed). Function then moved
  to `scanner-rows.util` as `appliedFilterSummary` (thermo LOW).
- **LOW IMPL said 'HH:mm' but code renders `h:mm a` — doc fixed.**
- **LOW PRD truncation disclosure weakened — fixed**: header count is
  `first N of M` when the wire page is capped below `total_items`
  (title attr explains the cap); spec pins 'first 1 of 350'.
- **NIT stale-result inconsistency (rail shows last-known tickers on
  err while detail hides them) — accepted + IMPL-documented** (rail =
  last-known scoreboard state; detail = honest failure).
- **NIT `runs()[recipe.id]` unguarded — accepted** (store seeds one
  entry per catalog recipe; both derive from the same constant).
- **NIT `.detail overflow-x:auto` — accepted** (wide tables need it;
  the "no scroll traps" requirement targets vertical).
- **NIT `999.999` → '1000.00' pre-separator branch boundary —
  accepted** (cosmetic edge; preserving the '2.10' two-decimal price
  convention outweighs).

### Thermo-nuclear — findings → dispositions

- **MED baseline-sort contract still duplicated above `scanSortCell` —
  fixed.** `seedSortLevels` + `baselineSortedRows` extracted to
  `scanner-sort.util`; the table seeds `sortLevels` via `seedSortLevels`
  and the rail calls `baselineSortedRows` — "rail top tickers === table
  seeded top rows" is now one function.
- **LOW `filterSummary` in the wrong layer — fixed** (moved to
  `appliedFilterSummary` in `scanner-rows.util`, the canonical owner of
  the `filters_applied` wire shape).
- **LOW rail `count` flicker under loading — fixed.** A retained stale
  result keeps `N / M` through loading/error, matching the table's
  stale-render policy ('…' only when nothing has ever landed).
- **NIT `selectRecipe` identity wrapper + `?? null` no-op — fixed**
  (template binds `selectedId.set` directly).
- **NIT `RailEntry.status` rename-for-CSS — fixed** (`status-{{e.run.status}}`
  uses the store's own status values; the field and its mapping
  deleted).
- **NIT dead error surface / `scanRunRows` doc line — accepted/doc'd.**

### Round-2 verification

- 73/73 across pages/scanner + scanner-rows + scanner-sort suites;
  `tsc --noEmit` clean; `git diff --check` clean
- Convergence: all three axes PASS on the remediated state

## Round 3 — convergence pass (post-remediation final state)

All three axes verified every R2 remediation holds. New findings were
hygiene-level; all concrete ones fixed.

### Fixed

- **Reauth banner lingered ~11s** (spec axis): `errorKind` cleared
  per-recipe at launch — the last armed recipe launches ~11s after a
  successful reauth said "re-running". `runAllRecipes` now clears
  `errorKind` at arm (status/result retained; a re-failing launch
  re-sets it). Spec'd: `authFailed` drops with zero timers elapsed.
- **Unguarded `runs()[recipe.id]` in `railEntries`** (standards +
  thermo, convergent): the store's own `launchRecipe` defends with
  `?? idleRun()`; the page now mirrors it via the exported `idleRun`
  factory. Unreachable today (both derive from SCANNER_RECIPES) — the
  asymmetry is gone.
- **Stale comment overclaim** (standards + thermo + spec, three-way
  convergent): rail comment said count keeps `N / M` "through loading
  and error" — error shows 'err' by design (IMPL: last-known tickers
  under the err dot). Comment corrected.
- **Doc drift — "9 recipes" → 12** (spec axis): the catalog is 3
  `qualityRecipe()` factory calls + 9 literal entries = 12. IMPL/TEST
  "9" references corrected. (Earlier rounds miscounted `id:` literals
  and missed the factory-minted ids.)
- **NIT `ScanSort` inline re-declaration**: both new util signatures
  now use `ScanSort` from `@st/scanner`.

### Accepted (unchanged)

- Util exports covered transitively via component specs — TEST doc's
  deliberate seam choice; the shared-pipeline contract is pinned at
  the behavioral level.
- Rail `N / M` lacks the detail's `first` prefix — compact rail is
  scoreboard density; the detail discloses the cap.
- `999.999` → `1000.00` branch-boundary; dead `store.error` banner
  channel — both accepted in R2.

### Round-3 verification

- 114/114 across scanner page + scanner-rows + scanner-sort +
  scanner-store suites; `tsc --noEmit` clean; `git diff --check` clean
- **Verdict: PASS — converged.** No structural findings remain.
