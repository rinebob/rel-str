# Code Review — Task #781: Dialogs → token/density pass

**Topic:** #576 Portfolio Allocation  
**Topic Slug:** portfolio-allocation  
**Thread:** #751 Portfolio Visual Consistency  
**Blueprint:** #775 (FE)  
**Issue:** #775  
**Thread Parent:** #751  
**Topic Parent:** #576  
**Task:** #781 — FE: Dialogs → token/density pass (5 dialogs)  
**Domain:** PORTFOLIO  
**Type:** CODE-REVIEW  
**Status:** Complete  
**Created:** 2026-10-15  
**Last Updated:** 2026-10-15  
**Reviewer:** Devin (three-axis: Standards / Spec / Thermo-nuclear sub-agents)  
**Verdict:** PASS (after in-loop remediation)

## Scope reviewed

Uncommitted working-tree diff — `src/app/features/portfolio-dashboard/` only:

- `styles/_pd-visual-language.scss` — new `dialog-chrome()` and `dialog-status()` mixins
- `allocation-bucket-dialog.component.ts` + new `.scss` — inline `styles:` → `styleUrl`
- `allocation-assign-dialog.component.ts` + new `.scss` — same
- `allocation-bucket-detail-dialog.component.ts` + new `.scss` — same
- `components/close-position-dialog/close-position-dialog.component.{html,scss}`
- `components/stop-loss-dialog/stop-loss-dialog.component.{html,scss}`

Excluded as foreign uncommitted WIP: `savant-trader/**` (order-confirm-dialog
option display, order-execution option-flow refactor), `shared/st-*`,
`shared/paper-trading-contracts.*`, all other modified/untracked paths.

## Standards axis

Two violations found and remediated in-loop; remaining items are judgement calls.

- ~~Duplicated Code~~ — `.status-section`/`.result-row`/`.error-message`/`@keyframes spin`
  were verbatim-identical (~50 lines) across close-position and stop-loss scss.
  **Fixed:** hoisted into `vl.dialog-status()`; component `@keyframes spin` copies
  deleted (the global one in `src/styles.scss:107` resolves — emulated
  encapsulation leaves unscoped animation-name references global).
- ~~Dead rule / selector bug~~ — `.title-row { gap: 12px }` in the detail dialog
  lost specificity to the mixin's `h2[mat-dialog-title]` (0,1,1 beats 0,1,0).
  **Fixed:** selector changed to `h2.title-row`.
- ~~Dead code~~ — `.field-row` rule in close-position was fully redundant with
  the mixin's content-field width. **Fixed:** rule deleted AND the four
  wrapper `<div class="field-row">`s removed from the template.
- Judgement calls accepted as-is: per-dialog `min-width` kept on
  `mat-dialog-content` consistently across all five; `.bucket-picker` title-row
  font-size left at 1rem; mixin emits `.dialog-error`/`.dim` utilities that not
  every dialog consumes (documented shared-mixin noise).
- Contracts verified clean: `styleUrl` paths resolve; `@use` depths correct per
  location (`styles/…` at feature root, `../../styles/…` under `components/<dir>/`);
  `MatButtonModule` in all five `imports` arrays; all `--mat-sys-*` props are
  real tokens; every `[data-testid]` the specs query is preserved.

## Spec axis

All six acceptance criteria met.

- Compact chrome on all 5 dialogs via `dialog-chrome()` — 16px title, 20px
  tertiary title icon (close/stop-loss have icons; the allocation trio have
  none), flex-column content, tight gaps. **Met.**
- Token colors — zero surviving `#hex`/`rgba`/named colors in the five dialogs;
  `vl.$up`/`vl.$down` literals are the feature's sanctioned accent convention
  (partial header lines 14–18). Dark-theme safe: `on-surface-variant`,
  `outline-variant`, `error-container`/`on-error-container`, `error`. **Met.**
- Consistent mat-form-field density — host-level `--mat-form-field-container-*`
  tokens (spread-builder convention) + `subscriptSizing="dynamic"` on every
  field. Caveat: `app-stop-loss-form` (shared component) uses hand-rolled
  `.sl-input` controls, no mat-form-field — cascade is inert there; its inputs
  are already compact (24px). **Met.**
- 32px stroked buttons — all secondary actions `mat-stroked-button`; mixin
  forces 32px/12px on `mat-dialog-actions button` in all 5. Gap: stop-loss's
  primary CTA lives inside the shared child form in `mat-dialog-content` at
  Material default height — deferred (shared with savant-trader order-ticket;
  touching it is out of this ticket's scope). **Met.**
- Specs green — 5 focused suites, 61/61 pass; `ng build` clean. **Met.**
- Scope note: `modify-order-dialog.component` is a 6th pd dialog not in the
  checklist — ticket enumerates five, so in-spec; flagged for a follow-up if
  "all dialogs" was intended literally.

## Thermo-nuclear axis

No critical/major findings. `dialog-chrome()` judged the right seam; three new
scss files (9–91 lines) justified vs a `panelClass`+global-stylesheet
alternative that would break the feature-internal `@use` convention.

- ~~Two reds for the same element~~ — error icon used `vl.$down` while
  `.error-message` used `var(--mat-sys-error)`. **Fixed:** unified on
  `var(--mat-sys-error)` inside `dialog-status()` (success keeps `vl.$up` —
  no sys success token exists).
- ~~Inconsistent min-width seam~~ — `:host` in close/stop-loss vs
  `mat-dialog-content` in the allocation trio. **Fixed:** all five now use
  `mat-dialog-content { min-width }`.
- ~~Mixin comment accuracy~~ — cited `app-stop-loss-form` as a cascade
  beneficiary though it has no mat-form-field. **Fixed:** comment reworded.
- Observation (not this change): `AllocationBucketDetailDialogComponent` has no
  production `dialog.open` call site — the inline detail panel replaced it in
  #693. Styling an orphaned dialog is harmless; cleanup candidate later.

## Test results

- Focused: 5 dialog suites — **61/61 pass** (post-remediation).
- `npx ng build` — clean.
- Full suite (`npx jest`): **2 failing suites / 43 tests — all pre-existing at
  HEAD, unrelated to this diff.**
  - `shared/screenshot-capture-contracts.spec.ts` — expects `PositionType` =
    `['stock']` but HEAD already has 4 values.
  - `order.component.spec.ts` — `No provider found for Functions` via
    `OrderExecutionService → ScreenshotService`; injection exists at HEAD.
  Both suites touch zero files in this diff; verified against HEAD sources.

## Findings summary

| Severity | Found | Disposition |
|---|---|---|
| Critical | 0 | — |
| Major | 0 | — |
| Minor | 5 | All fixed in-loop |
| Nit | 3 | 2 fixed; stop-loss CTA gap deferred (shared component) |

## Verdict

**PASS** — task advances to `7_QA`.
