**Topic:** Option Contract Time-Series Viewer  
**Topic Slug:** option-contract-viewer  
**Thread:** OCC Contract String Group Generator  
**Thread Slug:** occ-string-generator  
**Issue:** #1349  
**Thread Parent:** #1325  
**Topic Parent:** #1243  
**Task:** #1339  
**Domain:** OPTIONS  
**Type:** UAT  
**Status:** Complete  
**Created:** 2026-10-31  
**Last Updated:** 2026-11-03  

# UAT — FE: Generator drawer component + page wiring

## Scope

#1339 delivers the OCC group generator drawer on `/options/chart`: a
right `mat-sidenav` (end position, side mode) with a query form (strike
from/to/step, expiry range + explicit list, C/P/BOTH), a preview table
with state surfaces, a refine section (same axes + read-only clearable
alive-range bound), an open-date field with a study-range link toggle,
and a Send action that emits `date,id`/bare pair lines into the pairs
textarea and routes through `loadPlotted` with replace semantics.

**✓ Blocker resolved:** `queryContractAvailability` is **deployed**
(2026-10-31, via detached-worktree `firebase deploy --only functions` of
`bc6f1fd5` — the dirty working tree was NOT shipped). Post-deploy smoke:
`ok:true count=1222` on a bounded QQQ query. Scenarios 15–17 are now
executable against the real callable.

What IS executable today: the spec seam (real store + stubbed service +
DOM assertions, TEST-FE's documented highest seam), the drawer's chrome
and form mechanics, per-symbol persistence, and the error path (a Run
against the missing callable legitimately exercises error + Retry).

## Prerequisites

- Repo at `C:\aa\projects\rel-str`, deps installed (`npm install`).
- Jest 30 + jest-preset-angular for the spec seam.
- `npm start` for the manual pass — spawns `ng serve` (port 4200) plus
  the Robinhood Observation API (3456). `environment.ts` has
  `useEmulators: false`, so the app calls deployed prod functions.
- No credentials needed; localStorage carries `rs-optgen:{SYMBOL}` blobs.

## Start instructions

Spec seam:

```powershell
npx jest --coverage=false `
  src/app/features/savant-trader/components/option-group-generator/option-group-generator.component.spec.ts `
  src/app/features/savant-trader/pages/option-chart/option-chart-generator.spec.ts `
  src/app/features/savant-trader/pages/option-chart/option-chart.component.spec.ts `
  src/app/features/savant-trader/stores/option-group-generator.store.spec.ts
```

Expected: 4 suites / 61 tests green.

Manual:

```powershell
$env:NODE_OPTIONS="--require C:\Users\bob\.config\node\ipv4-only.cjs"
npm start
```

Navigate to `http://localhost:4200/options/chart` (any symbol, e.g. QQQ).

## Scenarios

### Spec-verified (documented seam — evidence recorded)

1. **Query form writes + blur commits** — `option-group-generator.component.spec.ts`:
   axis inputs write store query on blur; empty input clears the bound;
   typing `472.5` commits `472.5` (no mid-keystroke clobber);
   C/P/BOTH writes `type`. Result: **PASS** (spec evidence).

2. **Run → preview table + count** — spec renders rows
   `contractId | Exp | Strike | T | First | Last` with `N contracts`
   and `of M` under refine. Result: **PASS** (spec evidence).

3. **Refine without refetch** — spec asserts one service call after
   refine narrows the table; ALL clears the type bound. Result: **PASS**.

4. **Truncated / error / loading / three empty states** — specs cover
   the truncated warning, endpoint error + Retry reruns, the loading
   state (spinner + Run disabled mid-flight), and never-ran / ran-empty /
   refined-to-zero as distinct messages. Result: **PASS**.

5. **Alive-range bound** — spec: displays `start → end` read-only,
   clear button calls `applyRange(null)`. Result: **PASS**.

6. **Open-date linkage** — spec: toggle ON backfills openDate from the
   range start and the derived date shows in the (always-editable) field;
   toggle persisted, date not (persist blob = `{version, query, refine,
   useRangeAsOpenDate}`). Result: **PASS**.

7. **Send → pairs textarea → loadPlotted replace** —
   `option-chart-generator.spec.ts`: send writes `date,id` lines into
   `occIdInput` and calls `onLoad`; replacing the plotted set does not
   refetch retained contracts; Send disabled + hint on empty filtered
   set. Result: **PASS**.

8. **Symbol plumbing** — page spec: `ngOnInit`/`onSymbolChange` drive
   `genStore.setSymbol`; drawer spec: symbol swap reseeds local expiry
   text from the persisted blob. Result: **PASS**.

9. **Study-range route** — page spec: `onStudyRange(range|null)` writes
   and clears `refine.aliveRange` through `applyRange`. Inert until
   #1340 emits. Result: **PASS** (route verified; emission deferred).

### Manual (executable now — no backend required)

10. **Drawer chrome** — click the `tune` toolbar button: right sidenav
    opens in side mode; the chart refits (no overlap/cutoff); button
    shows pressed state. Close via `chevron_right` or the toggle.
    Result: **PASS** (user confirmation 2026-11-03).

11. **Form mechanics + persistence** — set strike Min `470`, step `5`,
    a date bound, and C/P/BOTH = Puts. Verify values commit on blur
    (type `472.5` — the decimal must survive). Close the drawer, reopen,
    reload the page — axes restore. Switch symbol (e.g. QQQ → SPY):
    axes reset to SPY's blob; switching back restores QQQ's.
    Result: **PASS** (user confirmation 2026-11-03).

12. **Error path** — error state + Retry + Send-disabled-on-empty
    verified. Result: **PASS** (user confirmation 2026-11-03).

13. **`::ng-deep` non-leak** — `mat-form-field` hints/errors elsewhere
    render normally; drawer compaction scoped under `.gen-panel`.
    Result: **PASS** (user confirmation 2026-11-03).

14. **A11y spot-check** — icon buttons expose names (`aria-label` on
    close, clear-range, tune toggle; `aria-pressed` on tune); error
    region `role="alert"`, loading `role="status"`. Result: **PASS**
    (user confirmation 2026-11-03).

### Real callable (post-#1336 deploy — confirmed 2026-11-03)

15. **Run → real availability data** — query form → Run → preview
    table populated from the partner endpoint; count line; `of M` under
    refine. Result: **PASS** (user confirmation 2026-11-03).

16. **Refine/truncated/ran-empty manual pass** — narrowing with no
    network activity (DevTools), the truncated warning with the real
    returned count, ran-empty vs refined-to-zero messages.
    Result: **PASS** (user confirmation 2026-11-03).

17. **Send → chart round-trip** — Send emits lines into the pairs
    textarea, `loadPlotted` replaces the plotted set, chips/mark series
    update. Result: **PASS** (user confirmation 2026-11-03).

## Traceability

| QA checklist item (issue #1349) | Scenario(s) | Status |
|---|---|---|
| tune toggle + end sidenav + refit | 10 | PASS |
| Query form writes + list-overrides-range + C/P/BOTH | 1, 11 | PASS |
| Run → real path → preview + count + `of M` | 2 (spec), 15 (real) | PASS |
| Refine no-refetch, ALL clears, alive-range clear | 3, 5, 16 | PASS |
| Truncated count, error+Retry, three empty states | 4, 12, 16 | PASS |
| Open-date editable both states, toggle persisted | 6 | PASS |
| Send → textarea → loadPlotted replace, >50 gate, disabled-on-empty | 7, 17 | PASS |
| Per-symbol persistence restore | 8, 11 | PASS |
| Refinement pass (drawer UX, compaction non-leak, toggles, states) | 10–14 | PASS |
| Review majors fixed in-gate | 4 (truncated), 6 (disabled), 13 (leak) | verified |

## Regression / smoke checklist

- [x] Focused spec suites — see execution log.
- [x] `tsc --noEmit` — clean on touched files; 2 pre-existing errors in
      unrelated HEAD files (`scripts/bulk-swing-sweep.ts`,
      `indicator-config-dialog.component.ts`).
- [x] `ng build` (dev) — clean post pass-2 fixes.
- [x] `git diff --check` — clean.
- [ ] Full Jest suite — 4,899 green during review gate (pre pass-2;
      pass-2 changes are template/spec-only + covered by the 61 focused
      tests; a full rerun is recommended before ship but not blocking).

## Findings

- ~~**Gate blocker:** #1336~~ — resolved: callable deployed 2026-10-31;
  real-path scenarios 15–17 executed PASS 2026-11-03.
- Pre-existing dead markup found in review (not this diff): pairs-input
  `mat-hint` is invisible under the control panel's own `::ng-deep`
  (introduced in `59dc28ff`); `.strike-range-row`/`strike-clear` dead
  CSS (introduced in `bdbc70af`). Candidates for a cleanup task.

## Execution log

- 2026-10-31 — Prerequisites verified: `firebase functions:list` shows
  no `queryContractAvailability`; #1336 = `4_BACKLOG`.
- 2026-10-31 — Focused spec seam run: **4 suites / 61 tests green**
  (drawer component, page wiring, page component, store).
  `tsc --noEmit` clean on touched files (2 pre-existing unrelated HEAD
  errors); `ng build` clean; `git diff --check` clean.
- 2026-10-31 — Dev server already running on :4200 (serves this working
  tree); browser preview opened for the manual pass — scenarios 10–14
  awaiting user confirmation.
- 2026-10-31 — Manual pass round 1 (user): two findings fixed in-gate —
  (a) date fields upgraded to `mat-datepicker` per the page's Exp From/To
  convention (`MatDatepickerModule`+`MatNativeDateModule`, local-midnight
  `iso+'T00:00:00'` display, `toISOString` write, `dateChange` commits —
  covers picker selection and typed+change entry); (b) tune icon's 40px
  M3 state-layer circle was off-center on the 26px button — switched to
  the token recipe (`--mat-icon-button-state-layer-size/touch-target-size/
  icon-size`) instead of shrinking width/height. Re-check pending.
  61/61 focused specs green post-fix; `ng build` clean.
- 2026-10-31 — **Runtime defect found + fixed:** `isoDate()` called in
  template bindings allocated a fresh `Date` every CD pass → ngModel
  permanently dirty → infinite change-detection loop → page hung on
  `/options/chart` load whenever persisted date values existed. Fixed
  with memoized `computed` projections (`queryExpGteDate` etc.) matching
  the page's `queryExpGteDate` convention + a regression spec asserting
  stable Date identity across CD passes. Specs missed it because empty
  dates yield `null` (stable) — the loop needs a persisted/populated
  blob. 62/62 specs + build green post-fix.
- 2026-10-31 — **#1336 shipped locally** (`queryContractAvailability`
  callable + proxy, QA #1350 PASS: 16/16 live SA route + 8/8 callable
  seam). Blocker for scenarios 15–17 is now *deploy only* — commits are
  local on `prod` until `git push` triggers auto-deploy.
- 2026-10-31 — Focused spec seam re-run post-#1336: **4 suites / 63
  tests green**.
- 2026-11-03 — Re-run on current tree (replay-dropdown slice present):
  `option-chart-generator.spec.ts` failed `NG0201: No provider found for
  Functions` — the new `OptionsReplayRunsService` injection wasn't
  stubbed. Fixed with the same service stub the page spec uses.
  **4 suites / 73 tests green** post-fix.
- 2026-11-03 — **Manual pass round 2 (user): all PASS** — drawer chrome
  + refit, form mechanics + per-symbol persistence, error path, ng-deep
  non-leak, a11y names/roles, real-callable Run → preview + count +
  `of M`, refine-without-refetch, Send → textarea → loadPlotted
  round-trip. **QA PASS.**
