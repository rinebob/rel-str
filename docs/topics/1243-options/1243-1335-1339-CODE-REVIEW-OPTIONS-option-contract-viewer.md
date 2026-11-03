**Topic:** Option Contract Time-Series Viewer  
**Topic Slug:** option-contract-viewer  
**Thread:** OCC Contract String Group Generator  
**Thread Slug:** occ-string-generator  
**Issue:** #1335  
**Thread Parent:** #1325  
**Topic Parent:** #1243  
**Task:** #1339  
**Domain:** OPTIONS  
**Type:** CODE-REVIEW  
**Status:** Complete  
**Created:** 2026-10-30  
**Last Updated:** 2026-10-31  

# Code Review — FE: Generator drawer component + page wiring

**Task:** #1339 — FE: Generator drawer component + page wiring  
**Blueprint:** #1335 — FE Blueprint: OCC group generator drawer  
**Verdict:** PASS (all findings fixed in-gate or documented as accepted deviations)

## Scope

Working tree is heavily dirty with unrelated work — review scoped to the
task's files only:

- `src/app/features/savant-trader/components/option-group-generator/option-group-generator.component.{ts,html,scss,spec.ts}` (new)
- `src/app/features/savant-trader/pages/option-chart/option-chart-generator.spec.ts` (new)
- `src/app/features/savant-trader/pages/option-chart/option-chart.component.{ts,html,scss,spec.ts}` (page wiring)
- `src/app/features/savant-trader/components/options-contract-chart/options-contract-chart.component.ts` (one output)

## Axes

### Standards — CHANGES REQUESTED → resolved

- **MAJOR:** root-level `::ng-deep .mat-mdc-form-field` in the new
  component SCSS compiled to a global rule — it would have shrunk every
  `mat-form-field` app-wide (hidden subscript wrapper kills
  `mat-error`/`mat-hint` everywhere; `!important` label positioning).
  **Fixed:** scoped under `.gen-panel`.
- **MAJOR (spec-required, accepted):** `studyRange` output +
  `onStudyRange` handler + `(studyRange)` binding + routing spec are inert
  until #1340 emits — flagged alongside Thermo-Nuclear as dead surface.
  Kept: TEST-FE explicitly requires the chart→`applyRange` route in this
  task and IMPL §FE-3/FE-4 sequences the seam declaration here. Emission
  is #1340's scope.
- **MINOR (judgement calls, documented):** query/refine SCSS block
  duplicates the left panel's compaction rules; `GeneratorOptionType`
  (`'C'|'P'|'BOTH'`) vs refine `'call'|'put'` mirrors the wire contract
  shapes shipped in #1337 utils, not drawer-layer inconsistency;
  `corpusDates`/`lastEmitted`/`hasRun`/`emit()` naming and the redundant
  `setSymbol` guard live in the shipped #1338 store API (out of scope).
- **Carried-over gap (not this diff):** `ContractAvailabilityService`
  has no own spec — its callable contract is exercised through the store
  spec's mocked seam (#1338 scope).
- Verified clean: no `as any`/type-erased fixtures, jest conventions per
  AGENTS.md (`jest.fn`, `setTimeout(0)` macrotask flush), page-scoped
  provider matches the feature-state convention.

### Spec — CHANGES REQUESTED → resolved

All six issue ACs MET with line evidence after fixes:

- **`mat-sidenav position="end" mode="side"` + `tune` toggle** — MET.
- **Query form + refine section** — MET: strike from/to/step, expiry
  range + list (list overrides range on the wire), C/P/BOTH; refine
  mirrors the axes + read-only, clearable `aliveRange` bound.
- **Preview table + states** — MET: six columns, count + `of M` when
  refined, truncated warning, spinner, error+retry, three distinct empty
  messages.
- **FIXED — open-date input was `[disabled]` while the link toggle was
  on**, contradicting PRD US16 ("still accepts manual edits"; "stays
  independently editable either way"). `[disabled]` removed.
- **FIXED — truncation warning hardcoded "first 2000"** vs PRD US14
  ("visible notice with the returned count"). Now interpolates
  `store.records().length` (equals `res.count` when truncated).
- **Send → textarea + `loadPlotted`** — MET incl. replace semantics and
  the >50 confirm path preserved by going through `onLoad`.
- **Specs** — MET: component spec = real store + stubbed service (DOM
  assertions), page spec covers send/replace/symbol-swap/studyRange.
- Deferred (consistent with ACs): `firstObserved*` bounds exist on the
  wire + handlers but have no form fields; single bare-ID send routes
  through the existing single-contract path (matches paste semantics);
  brush emission is #1340. `isInvertedRange` has no form-side validation —
  endpoint 400 surfaces via the error state. Minor scope additions:
  drawer close output, Clear button, header symbol label.

### Thermo-Nuclear — CHANGES REQUESTED → resolved

- **MAJOR — query/refine duplication:** 8 isomorphic handlers collapsed
  to 3 parameterized axis handlers (`onAxisNum`/`onAxisDate`/
  `onAxisExpiries`); template duplication noted as minor (a descriptor-
  driven `@for` moves complexity into descriptor objects rather than
  deleting it — the two blocks diverge in adornments).
- **MAJOR — dead studyRange surface:** same disposition as Standards —
  spec-required seam, emission deferred to #1340.
- **MINOR (documented):** free-text expiry local signals retained —
  `updateOn:'blur'` preserves unparseable raw text on commit where a
  store-bound join would drop it; `hasRun` vs a `'done'` status variant
  and a keyed `setQuery<K>` signature are #1338 store-API suggestions;
  template calls `store.*` methods directly in a few places alongside
  wrapped handlers (house convention tolerates both).
- **Verified good (agent):** page-scoped provider; the send→textarea→
  `onLoad` seam is deliberate — it preserves the >50 confirm gate and
  re-entrancy guard in one ingress; specs are DOM/behavior-level with
  typed fixtures.

## Test results

Full suite: **285 suites / 4,899 tests — all green.**

A real flake was found and fixed in-gate: NgModel's control setup is
microtask-deferred, so the first `input`/`blur` dispatch after
`detectChanges()` committed the stale model value — the two blur-commit
specs failed under full-suite load while passing in focused runs.
`setup()` now awaits one macrotask flush before returning, so every spec
interacts with fully-wired form controls (15/15 deterministic across
repeat runs + full suite).

`git diff --check`: clean. `tsc --noEmit`: clean.

## Second pass (post-fix re-review)

All three axes re-ran against the post-fix final state. Every first-pass
fix verified correct; pass-2 findings below — all minors, all resolved
or documented.

**Fixed in pass 2:**

- Icon-only buttons lacked accessible names (`matTooltip` supplies none):
  `aria-label` added to `.gen-close`, `.gen-alive-clear`, and the page's
  `.generator-toggle` (plus `[attr.aria-pressed]` for its on/off state).
- `.gen-error` gained `role="alert"`, `.gen-status` gained
  `role="status"` (live-region semantics, matching the page's precedent).
- 13 per-binding `{ updateOn: 'blur' }` object literals (new identity →
  `NgModel.ngOnChanges` each CD pass) hoisted to one shared `blurOpts`
  const on the component.
- Truncated copy said "showing first N" while the table renders
  `filtered()` — under refine the number didn't match the rows shown.
  Reworded: "endpoint returned first N availability rows; narrow filters
  to refine" — accurate regardless of refine state.
- `isInvertedRange` doc comment claimed it was "the form's reject
  condition" but no form path calls it — comment corrected to name the
  actual callers (`applyRange`, persisted-settings sanitize).
- Spec: unused `By` import removed; `whenStable()` swapped for the local
  `flush()` helper; added the missing loading-state spec (`gen-status`
  visible, Run disabled mid-flight, `gen-empty` suppressed) — the last
  uncovered state branch per TEST-FE.

**Documented / out of scope (not this diff):**

- `mat-hint` "One per line — bare ID or YYYY-MM-DD,ID" on the pairs input
  is dead markup — the control panel's own `::ng-deep` hides
  `mat-mdc-form-field-subscript-wrapper`. Introduced in `59dc28ff`
  (#1264, shipped) — follow-up material, not #1339.
- Top-level `.strike-range-row` block in the page SCSS duplicates the
  nested one + unreachable `.strike-clear` — introduced in `bdbc70af`
  (directory move). Pre-existing; flagged for a cleanup task.
- `option-chart.component.{ts,scss}` = 831/982 lines — the ~350-line
  catalog-builder/filter block is the extraction seam when the next
  feature lands. Advisory only; this diff added thin delegation.
- Unvirtualized preview table (up to 2000 rows in a 340px sidenav) —
  bounded by the endpoint cap; candidate for #1340-adjacent polish.
- `'Step'` label-substring lookup in `setInput` is first-match — works
  today, mildly brittle if labels change.

Pass-2 test state: **61/61 focused suites green** (incl. new loading
spec); `git diff --check` clean. `tsc --noEmit` reports two errors in
unmodified HEAD files (`scripts/bulk-swing-sweep.ts`,
`indicator-config-dialog.component.ts`) — pre-existing, unrelated.

## Verdict

**PASS** — all critical/major findings resolved in-gate; minors are
documented deviations or out-of-scope notes on shipped #1337/#1338 API.
