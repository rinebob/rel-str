**Topic:** Savant Design System  
**Topic Slug:** savant-design-system  
**Issue:** #1202  
**Topic Parent:** #1024  
**Task:** #1216  
**Domain:** DESIGN-SYSTEM  
**Type:** CODE-REVIEW  
**Status:** Complete  
**Created:** 2026-10-28  
**Last Updated:** 2026-10-28  

# Code Review — #1216 FE literal sweep: shared components

## Scope reviewed

`git diff` scoped to 13 files: 3 style files changed
(`interval-toggle.component.scss` literal conversion;
`flex-chart.component.scss` + `chart-sync-overlay.component.scss` dead
`var(--fc-*, literal)` fallback drops), 9 files carrying
`literal-sweep exception #1216` tags (6 flex-chart indicators,
`rs.constants.ts`, `rs-chart.component.scss`,
`shared/flex-chart-indicator-visuals.ts`, `shared/flex-chart-theme.ts`),
plus regenerated `ui-color-sites.json`.

Inventory blind spots found and closed pre-review: repo-root `shared/`
is outside the script's scan roots (both contract files tagged), and
`var()`-fallback literals are not flagged as sites (7+2 dropped).
`stop-loss-form.component.html` `&#9660;`/`&#9650;` entities remain as
documented false positives — the file is the user's in-flight WIP and
was intentionally not touched.

## Standards — PASS

- All `var(--ds-*)` names used verified in `_tokens.scss`.
- `interval-toggle` mappings correct: `#ccc`→border-subtle,
  `#3f51b5`→accent, `#ffffff`→on-accent, `--theme-*`→ds.
- Dead `--fc-*` fallbacks provably unreachable — the template binds all
  `--fc-*` properties unconditionally on the wrapper
  (`flex-chart.component.html:4-10`); overlay inherits via cascade.
  `--fc-min-height, 300px` correctly retained (never bound — consumer
  override seam).
- Exception tags state WHY and follow the #1214 convention.

## Spec — PASS

| AC | Result |
|---|---|
| Inventory re-run: sites consumed or tagged | MET — features/shared `kind=literal` = 28, all inside `literal-sweep exception #1216` blocks; src/app/shared = 4 arrow-entity FPs; repo-root `shared/` literals tagged at file level |
| No new literals introduced | MET — scoped diff adds only `var(--ds-*)` declarations + comment tags |
| `--ds-up`/`--ds-down` semantics preserved | MET — no direction colors in scope; zone ramp (up=green/down=red) and RSI reference lines match convention |
| Visual spot-check dark + light | DEFERRED — user-directed; phase-level walkthrough |
| Existing specs green | MET — full `npx jest`: **275/275 suites, 4,759 tests**; scoped shared run 19/19, 392; sass clean |

## Thermo-nuclear — PASS (after in-review fix)

- Dead-fallback drops proven safe: `palette()` always resolves
  (defaults dark), every `--fc-*` bound on the wrapper; encapsulation
  blocks external reach-in.
- CHART_PALETTES exception is the honest boundary — chart chrome is a
  separate visual domain feeding imperative config; citing #1164 is
  correct, divergence is deliberate.

## Findings (all resolved in-review unless noted)

- **Minor (fixed)** — `st-trend-band-width.indicator.ts:232`
  `#4caf50` setup-dot literal sat in a second function outside the first
  tag's scope → tagged.
- **Minor (fixed)** — `st-zone.indicator.ts` fallback `#9e9e9e`
  duplicated the canonical `ST_ZONE_FALLBACK_COLOR` contract export —
  now imports and uses the constant (literal deleted, not just tagged).
- **Minor (fixed)** — `var(--fc-bg, transparent)` and
  `var(--fc-no-data-text, var(--mat-sys-…))` retained dead fallbacks
  while siblings were dropped → both dropped (bindings always resolve).
- **Minor (fixed)** — `ui-color-sites.json` was stale post-edit →
  regenerated; shared literal sites = 32 (28 tagged + 4 FPs).
- **Nit (parked)** — `[style.--fc-axis-text]` binding consumed nowhere
  (pre-existing dead binding — surfaced, not introduced).
- **Nit (parked)** — `!important` ×3 in interval-toggle active state is
  probably not load-bearing; clean exit is MDC token overrides —
  follow-up ticket material, not a blocker.
- **Nit (parked)** — accent is cyan, not the replaced indigo `#3f51b5`;
  active-state hue visibly changes — verify at AC4 spot-check.

## Test results

- `npx jest --coverage=false` (full) — **275/275 suites, 4,759/4,759
  tests, 0 snapshots**
- Scoped shared re-run — 19/19 suites, 392 tests
- `npx sass` compile — clean
- `node scripts/inventory-ui-colors.mjs` — regenerated post-fix

## Verdict

**PASS** — 0 critical, 0 major; 4 minors fixed in-review, nits parked
for AC4/#1163. Advance to `7_QA`.
