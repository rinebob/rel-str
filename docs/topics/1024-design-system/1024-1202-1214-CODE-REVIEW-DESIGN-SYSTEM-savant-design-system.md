**Topic:** Savant Design System  
**Topic Slug:** savant-design-system  
**Issue:** #1202  
**Topic Parent:** #1024  
**Task:** #1214  
**Domain:** DESIGN-SYSTEM  
**Type:** CODE-REVIEW  
**Status:** Complete  
**Created:** 2025-11-05  
**Last Updated:** 2025-11-05  

# Code Review — #1214 FE literal sweep: savant-trader surfaces

## Scope reviewed

`git diff` scoped to the 44 swept files (43 source + regenerated
`ui-color-sites.json`). Verified the scoped diff contains **only** this
task's changes — unrelated in-flight work (#1258 scanner, chart-view,
functions/) is present in the working tree but touches none of these
paths except comment-level additions in `chart-view-toolbar.component.scss`
and `options-contract-chart-series.builder.ts`, which are this task's.

## Standards — PASS

- Every `var(--ds-*)` name used (27 distinct) verified present in the
  compiled token layer (`sass --load-path` compile of `styles.scss`).
- Mapping convention applied consistently: neutrals → surface/border
  tokens, direction → `--ds-up`/`--ds-down`, status ramps →
  success/warning/error/accent container pairs, error banners →
  error/container pairs.
- Exception comments use the explicit `literal-sweep exception #1214`
  form established in #1213; each states *why* (canvas-rendered chart
  config, categorical identity hue, deliberate dark-terminal readout,
  programmatic contrast white).
- Dead `var(--mat-sys-*, fallback)` fallbacks removed in
  `contract-mini-chart` (bridge now resolves — fallbacks were dead code).
- One indentation defect found in-review and fixed
  (`order-ticket.component.scss` `.status-paper` was at parent level
  instead of sibling level — SCSS-valid but misleading).

## Spec — PASS

| AC | Result |
|---|---|
| Inventory re-run shows literal sites consumed or tagged | MET — savant-trader `kind=literal` sites 366 → 114; every remainder is inside a `literal-sweep exception #1214`-tagged file/section OR is a documented false positive (issue refs `#717`/`#762`/`#1016`/`#1152`/`#1189`–`#1191`/`#1199`/`#1258` and `&#9660;`/`&#9650;` HTML entities inside comments) |
| No new color literals introduced | MET — every added declaration uses `var(--ds-*)`; added literal lines exist only inside tagged exception blocks (same hues, moved/annotated) |
| `--ds-up`/`--ds-down` semantics preserved | MET — profit/long/buy/positive → `--ds-up`; loss/short/negative/put → `--ds-down`; no accent-bound direction colors |
| Visual spot-check dark + light | DEFERRED — user-directed; phase-level walkthrough after #1215–#1217 land |
| Existing specs stay green | MET — `npx jest src/app/features/savant-trader`: 137/137 suites, 2,720 tests; sass compile clean |

## Thermo-nuclear — PASS

- `color: var(--ds-surface)` on solid `--ds-error`/`--mat-sys-success`
  backgrounds is a deliberate token-role bend (surface-as-on-solid) —
  *improves* dark-theme contrast vs fixed `#fff`. Consistent with the
  #1213 `rsButtonOne` precedent. **Minor**: flag for #1162 component
  pass — a dedicated `--ds-on-solid` role may be cleaner.
- `color-mix(in srgb, var(--ds-on-surface) 10%, transparent)` replaces
  a `rgba(255,255,255,.08)` hover tint — theme-adaptive, evergreen-safe.
- var() inside Angular inline `styles:` arrays and SVG fills resolves
  at runtime the same as SCSS output; jest-preset-angular compiled all
  edited components clean.
- No spaghetti, no size creep — edits are line-level token swaps.

## Findings

- **Minor** — `--ds-surface` as text-on-solid: works in both themes but
  bends the token role. Revisit under #1162.
- **Nit** — ~20 inventory false positives (issue refs + HTML entities in
  comments) still count as literal sites; the inventory regex could learn
  to skip comment text. Cosmetic — documented rather than chased.
- **Nit** — `latest-run.store.ts` etc. untouched (not literal sites).

## Test results

- `npx jest src/app/features/savant-trader` — **137/137 suites, 2,720/2,720 tests**
- `npx sass` compile of `styles.scss` — clean
- `node scripts/inventory-ui-colors.mjs` — regenerated; artifact in diff

## Verdict

**PASS** — 0 critical, 0 major; 1 minor + 2 nits recorded for downstream
tasks. Advance to `7_QA`.
