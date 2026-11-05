# CODE-REVIEW — Dev page utilities: result actions, spec presets, lifecycle sim (#801)

**Topic:** On-demand Screenshot Capture  
**Topic Slug:** screenshot-capture  
**Thread:** Auto-Capture  
**Blueprint:** #764  
**Task:** #801  
**Domain:** SCREENSHOT  
**Type:** CODE-REVIEW  
**Status:** Complete  
**Created:** 2026-11-05  
**Last Updated:** 2026-11-05  

## Verdict: PASS

All critical/major findings were fixed in-cycle and re-verified green
before this verdict. Remaining findings are minor/nit or deferred-by-design
(see below).

## Scope

`src/app/features/dev-screenshot/` — `dev-screenshot.component.{ts,html,scss,spec.ts}`
modified; `dev-screenshot.utils.ts` + `dev-screenshot.utils.spec.ts` new.
Pure FE change over the existing `captureChartSnapshot` contract; no
backend files touched.

## Acceptance criteria (Spec axis)

- **Result cards expose copy-path and console-link actions — MET.**
  Each stored path row renders `code` + Copy (`navigator.clipboard.writeText`
  + 2s "Copied" flash) + Console anchor →
  `console.cloud.google.com/storage/browser/_details/{bucket}/{path}?project=`
  built from `environment.firebase` (`component.html`, `utils.ts`).
- **≥2 saved spec presets — MET (4).** `SPEC_PRESETS`: quick-look
  (manual/render-only), order-placed-sim, order-filled-sim,
  position-closed-sim; whole-form fill via `applyPreset`.
- **Event selector covers all CaptureEvent values + refId wired — MET**
  (pre-existing; now test-asserted: option values == `Object.values(CaptureEvent)`;
  refId flows into `spec.refId`).
- **No new backend endpoints — MET.** Everything routes through
  `captureChartSnapshot$`.
- **Out-of-scope respected:** no PNG preview (paths stay text+actions).

## Standards axis

Fixed in-cycle:

- **Major (fixed):** spec used a real 2000ms `setTimeout` — blocked
  `fixture.whenStable()` ~2s wall clock, and repeated the accepted-MAJOR
  pattern documented in `docs/topics/942-options/942-958-965-CODE-REVIEW-OPTIONS-options.md`.
  Now: exported `COPIED_FLASH_MS` + `jest.useFakeTimers()` /
  `advanceTimersByTime` (same convention as `POPUP_COPIED_MS`).
- **Major (fixed, same change):** magic number `2000` →
  `COPIED_FLASH_MS` in `dev-screenshot.utils.ts`.
- **Minor (fixed):** `navigator.clipboard` stub leaked across tests →
  saved/restored descriptor in `finally`; matching rejection-path test added.

Open judgement calls:

- `copiedPath`/`copiedTimer` reimplements the option-chain popup's
  copied-flash (two consumers — a shared helper is defensible, not required;
  §2 vs §3 tension noted).
- Silent clipboard `catch` — accepted under AGENTS.md scope discipline
  (dev tooling), documented in code.
- Component spec now ~520 lines (over the 400 "strong smell" line);
  component ~330. Dev-tooling files; flagged, not blocking.

Contract check: clipboard call matches `navigator.clipboard.writeText(string):
Promise<void>` and the repo's established pattern; env values are real
config (no silent fallbacks); console URL is the genuine object-detail form.

## Thermo-nuclear axis

Fixed in-cycle:

- **Behavior defect (fixed):** preset could not be re-applied — `change`
  doesn't refire on the same select value. `applyPreset` now resets the
  select to the placeholder after filling the form.
- `consoleUrl` field-arrow → plain method (removed needless indirection).
- Duplicated `mountResult` spec helper hoisted to describe scope.
- Overclaiming test name ("every pipeline event") renamed.
- Rejection-path coverage added (rejected write → no "Copied").

Kept as-is (rejected or deferred):

- Hard-coded `rel-str.appspot.com` in the spec assertion is the
  *independent* expected value — importing `environment` there would make
  the test tautological.
- `ul`/`.paths` `list-style: none` + `padding-left` are live styles
  (rows are still `li`); not dead CSS.
- Nine-signal `applyPreset` bulk-set vs a unified form-model signal —
  real code-judo if the form grows, but reframes pre-existing state; deferred.

## Spec-axis caveat (not a violation)

All sim presets produce `positionType:stock` — the only `positionType`
the dev form offers. Lifecycle sims therefore preview *stock* naming only;
option-position captures embed a different path segment. The issue doesn't
ask for a positionType field — noted as a known limitation.

## Second pass (post-fix re-review)

Re-reviewed the post-fix diff against all three axes — every in-cycle fix
verified in place (exported constant, fake-timer spec, clipboard restore,
preset re-apply, method-not-field `consoleUrl`, hoisted `mountResult`,
rejection-path test). New-issue scan surfaced two nits, both accepted
as-is:

- `applyPreset` mutates the select's `value` directly rather than a
  signal-bound `presetKey` — equivalent behavior, less plumbing.
- `(navigator as { clipboard? }).clipboard` cast in spec cleanup —
  scoped, not contract-masking.

**No new findings of consequence — converged.**

## Test results

- Full suite, first run: **5175/5175 green** (297 suites).
- Mid-review re-run caught 2 spec suites failing to compile — both
  unrelated in-flight contract-list work (`PickerTab` 'chunks',
  `onListChunk*` methods not yet landed). The user's subsequent commits
  completed that work; the targeted re-run of both suites passes
  (128/128 across contract-list-picker, option-chart, dev-screenshot).
- `dev-screenshot` suite: 39/39 (4 suites) — incl. new preset, event
  coverage, copy/console actions, copy feedback, and rejection-path tests.
- `tsc --noEmit -p tsconfig.app.json` clean.
