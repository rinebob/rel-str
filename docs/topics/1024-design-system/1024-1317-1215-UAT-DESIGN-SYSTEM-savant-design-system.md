**Topic:** Savant Design System  
**Topic Slug:** savant-design-system  
**Issue:** #1317  
**Topic Parent:** #1024  
**Task:** #1215  
**Domain:** DESIGN-SYSTEM  
**Type:** UAT  
**Status:** Complete  
**Created:** 2026-10-28  
**Last Updated:** 2026-10-28  

# UAT — #1215 FE literal sweep: options/positions surfaces

## Scope

Hardcoded color literals in `src/app/features/positions-view/**` and
`src/app/features/portfolio-dashboard/**` (portfolio-gallery pages,
account-summary, stop-loss-dialog) converted to `var(--ds-*)` semantic
references. 13 swept files; ~82 literal sites → 0 remaining (2
inventory false positives: `#853` issue refs inside comments — not
colors). No chart/canvas or categorical-hue exceptions were required in
this area. The savant-trader options pages were already swept under
#1214 — this task covers the positions/portfolio options surfaces.

Scope note: `stop-loss-dialog.component.scss` contains the user's
in-flight #888 update-mode rules; only the two `var(--ds-*)` color
substitutions inside them belong to this task.

## Prerequisites

- Repo on `prod` branch, `npm install` up to date
- App served at `http://localhost:4210` (`npm start`)
- Signed-in session (routes are `authGuard`-protected)
- Dark theme active by default; light via the header theme toggle
- `node_modules/savant-ds` present (synced token layer)

## Acceptance results

| # | Criterion | Result | Evidence |
|---|-----------|--------|----------|
| AC1 | Inventory re-run: sites consumed or tagged | **PASS** | `node scripts/inventory-ui-colors.mjs` regenerated post-review-fixes; positions-view + portfolio-dashboard `kind=literal` sites = 2, both `#853` issue-ref FPs in comments |
| AC2 | No new literals in swept files | **PASS** | scoped `git diff -U0` — zero added literals; every added declaration is `var(--ds-*)` or `color-mix`; hex/rgba grep over all 13 files finds only comment issue-refs |
| AC3 | `--ds-up`/`--ds-down` semantics preserved | **PASS** | `.long`/`.profit`/`.positive` → up pair; `.short`/`.loss`/`.negative` → down pair; `.short` on `mat-sys-error` caught in review → `--ds-down`; all 25 used token names verified in `_tokens.scss` |
| AC4 | Visual spot-check, dark + light | **DEFERRED** | user-directed — deferred to phase-level walkthrough after #1216/#1217; scenarios D1–D6 below are the task's deferred checklist |
| AC5 | Existing specs green | **PASS** | full `npx jest --coverage=false` — 271/271 suites, 4,721 tests; scoped re-run post-review-fixes — 33/33 suites, 568 tests; `npx sass` compile of `styles.scss` clean |

## Deferred visual walkthrough checklist (phase-level)

Run on `http://localhost:4210`, dark theme first, then flip light via
header toggle. One line = one surface.

- **D1** `/positions-view` — open cards: `--long`/`--short` container
  tints + direction borders, `--side` badge (accent pair), `--status`
  badge (**verify it is visible on long cards** — was invisible pre-fix,
  now neutral overlay chip), PnL up/down colors, percent-bar fill/track
- **D2** `/positions-view` — open grid: row surfaces/borders, profit/
  loss chips (up/down container pairs), `.pv-more` button hover
  (**verify a visible hover delta** — restored to `-overlay`; was
  zero-delta), `border1()` debug-box scaffolding — confirm boxes are
  intentional or stale (see Findings)
- **D3** `/positions-view` — closed grid + open-summary cards:
  profit/loss colors, summary strip surfaces, muted labels
- **D4** `/portfolio` — account-summary labels (`--ds-on-surface-variant`
  — was `rgba(0,0,0,0.54)`, near-invisible on dark — **verify now
  readable**), section error block, equity-positions-table
- **D5** `/portfolio` → open stop-loss dialog — candidate-row meta text
  (`--ds-on-surface-variant`), unprotected warning (`--ds-error`),
  dialog surfaces (user's #888 WIP rules — layout itself not this task)
- **D6** `/portfolio-v2` — portfolio-gallery header: hairline borders +
  side/chart pill borders (`--ds-border-subtle`), active pill
  (color-mix fill + strong border — **verify visible in light theme**,
  was white-alpha before), position cards (direction borders, tier
  badges incl. `-small` `--mat-sys-error` exception), gallery-group
  long/short colors, warning-container rows

## Regression / smoke

- Flip `[data-theme]` between dark/light on `/positions-view` and
  `/portfolio-v2` — container tints, borders, muted text must re-theme
  (no stranded light-tuned or dark-tuned literals)
- Confirm flat `--ds-up-container`/`--ds-down-container` fills vs prior
  mint/crimson gradients read acceptably (flagged delta — deliberate,
  but confirm in both themes)
- Confirm `.chip--active` (dead CSS, `mat-chip-option [selected]` bound
  instead) removal candidate has no visual impact — chips style via
  selected state, not `.chip--active`

## Findings

- Minor (parked — user question): `positions-view.component.scss`
  calls `mixins.border1()` 8× on layout containers incl.
  `border1(blue)`/`border1(red)` named-color debug literals — mixin
  itself is tokenized (`--ds-border-strong` default); scaffolding looks
  stale but renders visible boxes — needs user call: keep or delete
- Nit: `--side` badge uses accent-family for a direction datum
  (defensible — card bg encodes direction)
- Nit: dark-theme neutral-on-tinted separations (overlay badge on
  up/down-container cards) rely on hue over luminance — subtle
- Nit: `--mat-sys-*`/`--ds-*` vocabulary mix in position-card +
  `tier-small` error-role-on-category — converges under #1163
- Scope flag: `features/trade-journal/` literals (incl. direction
  `#2e7d32`/`#c62828`) left for #1216/#1217
