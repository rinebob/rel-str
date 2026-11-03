**Topic:** Savant Design System  
**Topic Slug:** savant-design-system  
**Thread:** De-Materify  
**Thread Slug:** de-materify  
**Issue:** #1163  
**Thread Parent:** #1163  
**Topic Parent:** #1024  
**Task:** #1348  
**Domain:** DESIGN-SYSTEM  
**Type:** CODE-REVIEW  
**Status:** Complete  
**Created:** 2026-11-02  
**Last Updated:** 2026-11-03  

# Code Review — #1348: dev/ds-elements live element zoo

## Verdict: PASS (round 2, 2026-11-03)

All round-1 findings remediated and independently re-verified by the
three axes. The canonical source-of-truth repair held: both vendor
copies are byte-identical to ../savant-ds (diff -rq clean), sync:ds is
a verified no-op, and canonical verify.mjs passes ~500 assertions.

**Test results:** 287 suites, 4,974 pass / 5 fail — all 5 in
option-chart-generator.spec.ts, an unrelated cross-session spec (new
file from the backtest thread) missing a Functions provider stub.
Every #1348-touched suite is green (ds-elements 13/13, ds-gallery 16/16,
nav-sections, sidenav-menu). Prod ng build green; dev ng serve unaffected.

### Round-1 findings — all verified fixed

- C1 canonical residency: _forms/_layout + edits live in ../savant-ds;
  sync:ds no-op; relays 1042/1044(1204)/1112/1211 all green
- C2 box-sizing: border-box on all fixed-geometry controls
- C3 keyframes moved inside mixin bodies; @use alone emits none
- ds-field-input → ds-input-chrome; focus-visible; ::selection;
  --ds-accent-text contrast role; dead mock machinery removed; counts
  refreshed + JSON-pinned; 5 missing specimens; @default branch;
  dense-table no longer contaminates the NOW mat-table; nav entry added

### Round-2 axis findings — all addressed before this verdict

Spec axis (finding #1 — "canonical _index.scss missing layout/forms
forwards" — was a FALSE POSITIVE: the subagent read the canonical file
through the out-of-workspace overlay, which served a stale snapshot;
exec diff + cat prove all 7 forwards present):
- restate duplication → palette-lock-1211 extended (§5b pins the zoo
  light/dark restates; --ds-accent-text now pinned in family checks)
- ds.field-input seenIn corrected (gallery-only, no app usage)
- ARIA contracts implemented on all ds-* specimens (tabs, accordion,
  combobox, menu, dialog, toast, table sort headers)
- .dlg-mock/.sidenav-mock carry visible "DOM shape — not live" tags

Thermo-nuclear axis — verdict: "safe to migrate onto":
- M1 → fixed (relay §5b); M2 → fixed (full ARIA wiring incl.
  aria-controls/activedescendant/labelledby ids, tabindex on sortable th)
- M3 → verify.mjs header corrected: element-layer pinning documented
  as a representative subset bounded by stray-selector/hex/emission
  checks; "18 mixins" comment → 19; translateX check scoped to the
  keyframes body; ds-combobox doc corrected (no .open class emitted)
- ds-table --mat-sys-* reads: DEFERRED — _data-display.scss documents
  the bridge as intentional until #1163 retires it; the new mixin
  follows file convention

Standards axis:
- .mock-tag --ds-outline → --ds-border-subtle (dead var, my bug)
- mat-form-field-parts error state now a REAL FormControl
  (touched+required) — mat-error renders genuinely
- ds-gallery: dead ACCENTS re-export removed; --ds-accent-text added
  to both accent blocks and pinned by the relay
- FAMILIES catalog extracted to ds-elements.families.ts (component
  422→160 lines)
- demo signals split per-specimen (comboVal/dsSelectVal); sel/acVal
  renamed per §8; .card-head scoped to direct child; dead .wrap removed
- 1024-1025-DS-INVENTORY extracted table now lists all element mixins
- 1204 header comment 47→54

### Deferred / noted (not blocking)

- Overlay-bound Material specimens (mat-menu/select-panel/tooltip/
  snackbar/datepicker) render under the app accent, not the picked
  preview — inherent to CDK overlays on <body>
- Drift protection is process-gated (verify sweep is manual, not CI)
- av-proxy-api vendors package.json verbatim vs rel-str hand-written
  — harmless, different contracts noted
- dark() default differs between zoo (dark) and gallery (light)
- ~650-line @switch justified for one-per-archetype testbed

---



3 critical findings, 9 major. The defects live in the canonical mixin
layer and the vendor-sync workflow, not just the dev page — this is
the code that gets copied app-wide during migration, so it must be
right before it ships.

**Test results:** full suite green — 287 suites, 4,970 tests, 0
failures.

## Critical findings (blocking)

### C1 — Mixin work lives only in `vendor/savant-ds` — canonical checkout doesn't have it; `sync:ds` will erase it
`vendor/savant-ds` is a downstream copy: `sync-savant-ds.ts` does
`rmSync(DST)` then copies from `../savant-ds`. The canonical checkout
(`C:\aa\projects\savant-ds`) has none of the new work (verified: no
`_forms.scss`, `_layout.scss`, `ds-btn`, or the 6 new tokens). Four
verify relays now fail on this machine: theme-tokens-1204 (47-token
contract, vendor byte-compare), widgets-1112 (byte-compare),
sa-consumption-1042 (file parity), palette-lock-1211 (6 new dark
tokens not restated in ds-gallery's light block).

**Fix:** land the work in `../savant-ds` (incl. `scripts/verify.mjs`
manifest updates — token list pinned at :194,:245), update
`design-system-theme-tokens-1204.ts` REQUIRED (→ 53 tokens), restate
the 6 tokens in ds-gallery's light block, then `npm run sync:ds`.

### C2 — All new mixins assume `box-sizing: border-box`; the app has no global border-box
No `* { box-sizing }` reset exists. Every fixed-geometry element
renders oversized: `ds-field-input` height 40+2=42px; `ds-btn.outline`
32+2=34px vs ghost's 32 (the zoo's own button row is mismatched);
`ds-radio` grows ~7px on `:checked` (border-width trick); `ds-check`
19px vs 16 + off-center `::after`; `ds-switch` thumb geometry
asymmetric. Inherited from graduated `field-input` too.

**Fix:** `box-sizing: border-box` on every fixed-geometry mixin root
(and children with fixed dims).

### C3 — Top-level `@keyframes` violate the package's mixin-only emission contract
`_feedback.scss` emits `ds-spin` + `ds-progress-slide` at top level —
every `@use 'index'` consumer gets both keyframes in its encapsulated
chunk whether or not it includes the mixins. `_dialog.scss:91` shows
the established pattern is a single shared global keyframe; the
file's own header repeats "compile-time only."

**Fix:** move `@keyframes` inside `ds-spinner()`/`ds-progress()` (or
into `_tokens.scss` emitted-once globals).

## Major findings (blocking)

4. **Naming collision:** `ds.field-input` (compact container,
   `_widgets.scss:291`) vs `ds.ds-field-input` (bare input chrome,
   `_forms.scss:17`) — near-identical names, different contracts, will
   be confused during migration. Split convention (unprefixed legacy vs
   `ds-*` new) needs a documented boundary + rename (e.g.
   `ds-input-chrome`).
5. **ARIA/focus gaps in canonical contracts:** `ds-tabs` (no
   tablist/tab/aria-selected), `ds-accordion` (no aria-expanded),
   `ds-combobox` (mouse-only — divs, no roles, no aria-activedescendant),
   `ds-menu` (no roles); `.menu-item`/`.tab`/`.acc-head`/
   `.combo-option`/`.ds-toast .action` have no `:focus-visible`.
   Doc comments must state the keyboard/ARIA contract; specimens
   should model it.
6. **Contrast regressions:** `ds-toast .action` ≈1.4:1 in dark;
   accent-as-text in light ≈3.3-3.7:1 (below 4.5 AA) on card-title /
   acc-head / tab.active / dialog title / sort indicators / ghost+outline
   btn text — needs a `--ds-accent-text` derived token or role
   restriction; `.danger:hover` should use `--ds-on-error-container`.
7. **Spec can't catch its own failure mode:** specimen `@switch` has
   no `@default` — a `SpecimenKind` without a `@case` renders a
   silently empty NOW pane with no test failure. Add default marker +
   non-empty-pane assertion.
8. **Dead mock machinery:** `MockKind`, `PaneSpec.mock`, the html:56-68
   switch + ~71 lines `.mock-*` SCSS — unreachable, pinned by a test
   that forbids it. Delete the path.
9. **Restate duplication unpinned:** ds-elements' host restate blocks
   duplicate ds-gallery's drift-prone blocks with no relay coverage —
   extend verify-1211 to this file or extract a shared
   `ds.theme-preview` mixin (kills both duplications).
10. **42/44 card counts stale** vs regenerated `ui-element-sites.json`
    (mat-icon 904→495, native-button 314→231, mat-select 195→46+70…);
    header says "44 archetypes · ~3,678" vs actual 54/3,219. Either
    refresh literals with a self-inclusion caveat or load the JSON.
11. **5 uncovered archetypes:** `mat-form-field-parts` (163),
    `native-input-checkbox` (23), `native-input-date` (8),
    `native-input-radio` (5), `native-input-file` (3, absent entirely).
12. **`mat-table` NOW pane contaminated:** `.demo-table` wraps the real
    mat-table AND carries `ds.dense-table` — the "before" isn't stock.

## Minor (sample — full list in sub-agent reports)

- File sizes (.ts 353/.html 630/.scss 438) — defensible for a zoo if
  the mock path (~100 lines) is deleted; extract `ds-elements.data.ts`.
- Accent derivation is now a third copy of `applyAppAccent` — hoist.
- `dev/ds-elements` missing from Dev nav submenu (spec-pinned at
  nav-sections.spec.ts) — confirm intent.
- `mat-select` rendered in a DS-TODAY pane (Material widget in ds
  column).
- Shared specimen signals bound twice (nativeSelectVal, acVal).
- Honest-mock labels uneven: `.dlg-mock`/`.sidenav-mock` lack
  "not live" markers while cdk/syncfusion are explicit.
- `--ds-selection` token defined but unconsumed.
- `ds-progress` animates `left` (layout property) — use transform.
- Family merges vs AC's 10-family list (icons→data, syncfusion→cdk,
  no natives section) — reasonable but diverges from AC wording.

## Remediation plan

1. **Port to canonical `../savant-ds`** — same file diffs +
   verify.mjs manifest + new partials registered; then `sync:ds`
   (becomes no-op), update the 4 verify relays, add tokens to
   ds-gallery light restate.
2. **Mixin fixes (in canonical, then sync):** box-sizing on fixed
   geometry; keyframes inside mixins; `--ds-accent-text` + toast
   action + danger-hover contrast; `:focus-visible` on interactive
   children; ARIA contract comments; rename ds-field-input helper;
   `::selection` or drop `--ds-selection`; transform for progress.
3. **Page fixes:** delete mock machinery + `.pane` dedupe; refresh
   counts (document self-inclusion or read JSON); add the 5 missing
   archetype cards; `@default` + non-empty-pane spec; rename NOW
   `.demo-table`; honest-mock tags on dlg/sidenav mocks; nav submenu
   decision; fix `mat-list`→DROP + `mat-icon`→D2-b wording.
4. Re-run `/proj review 1024 1348`.
