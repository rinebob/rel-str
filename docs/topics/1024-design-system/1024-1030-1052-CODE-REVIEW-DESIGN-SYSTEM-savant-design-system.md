**Topic:** Savant Design System  
**Topic Slug:** design-system  
**Thread:** Design System Foundation  
**Thread Slug:** ds-foundation  
**Issue:** #1052  
**Thread Parent:** #1025  
**Topic Parent:** #1024  
**Task:** #1052  
**Domain:** SHARED  
**Type:** CODE-REVIEW  
**Status:** Complete  
**Created:** 2026-10-17  
**Last Updated:** 2026-10-17  

# Code Review — #1052: data-display mixins graduate to savant-ds

## Verdict: PASS (one adversarial finding remediated)

## Scope

- savant-ds: `styles/_data-display.scss` (new), `_index.scss` (+1
  forward), `scripts/verify.mjs` (manifest + fixture + decl asserts),
  `README.md`
- rel-str: `_pd-visual-language.scss` (3 bodies removed, tab pair kept),
  `design-system-vl-shim-1040.{ts,md}` (DELEGATED +3 / LOCAL = 2 tab
  mixins), `design-system-data-display-1052.{ts,md}` (new relay),
  `run-all.ts` + `README.md` (registration), and
  `design-system-consumption-1039.ts` (R1 fix)

## Axes

### Spec — PASS

- AC1 (per-mixin graduate/stay decision): `dense-table` (8 call sites
  across 7 PD table stylesheets), `state-block`, `stat-strip` graduate;
  `bounded-tab-group` + `tab-scroll-pane` stay PD-local — Material-
  coupled (`::ng-deep .mat-mdc-tab-body-wrapper`,
  `--mat-tab-container-height`), two call sites. Shipping MDC-piercing
  mixins into the shared DS during the Material exit would fossilize the
  dependency being removed.
- AC2 (established pattern): `ds.*` partial, verbatim semantics
  tokenized to `--ds-*` where covered, parity-probe relay, mixin-surface
  set-equality — all present.
- AC3 (manifests + verify surface): `FORWARDS_MANIFEST`,
  `STYLES_MANIFEST`, index fixture, coverage block — updated.
- AC4 (#1040 shim coverage): DELEGATED/LOCAL manifests updated; relay
  green at 39 checks.

### Standards — clean

New partial and verify section mirror the `_dialog.scss`/`#1037`
conventions exactly (doc comments, two-direction decl asserts,
probe-rooted emission, direct `@use` resolution check).

### Adversarial — 1 finding, remediated

- **R1** — `design-system-consumption-1039.ts` `SHADOWABLE` list was
  hardcoded (`tokens/index/page/dialog/feedback`); a new package partial
  name (`data-display`) escaped the src/ shadow guard. Fixed by deriving
  the list from the installed package's `styles/` dir. Negative-tested:
  a planted `src/_data-display.scss` fails the guard.
- Verified elsewhere: verbatim parity vs the **pre-graduation** bodies
  (compiled from `dca3609d^` — all 20 emitted selectors decl-identical
  after token normalization; the shim-side probe alone would have been
  self-referential post-graduation).

## Evidence

- `npm run verify` (savant-ds): all checks passed, incl. 12-selector
  data-display fixture both directions
- All 8 DS relays green (1034/1035/1036/1037/1038/1039/1040/1052)
- `npm run build` green; jest portfolio-dashboard 545/545
- Negative tests: planted `src/_data-display.scss` shadow → FAIL
