**Topic:** Savant Design System  
**Topic Slug:** savant-design-system  
**Issue:** #1202  
**Topic Parent:** #1024  
**Task:** #1215  
**Domain:** DESIGN-SYSTEM  
**Type:** CODE-REVIEW  
**Status:** Complete  
**Created:** 2026-10-28  
**Last Updated:** 2026-10-28  

# Code Review — #1215 FE literal sweep: options/positions surfaces

## Scope reviewed

`git diff` scoped to the 13 swept files (12 source + regenerated
`ui-color-sites.json`) across `features/positions-view/**` and
`features/portfolio-dashboard/**` (portfolio-gallery pages +
account-summary + stop-loss-dialog). Verified the scoped diff contains
only this task's changes. `stop-loss-dialog.component.scss` mixes in the
user's in-flight #888 update-mode rules — only the two `var(--ds-*)`
color substitutions inside them belong to this sweep; the new selectors
are the user's WIP and were reviewed for color literals only.

Scope note: the issue's phrase "options surfaces" was interpreted as the
options-domain positions/portfolio areas — the savant-trader options
pages (chain, strategy builder, dashboard) were already swept under
#1214. `features/trade-journal/` retains literals (incl. direction
`#2e7d32`/`#c62828`) and was judged out of #1215 scope — flagged as a
scope question for #1216/#1217 rather than chased here.

## Standards — PASS

- Every `var(--ds-*)` name used verified present in
  `vendor/savant-ds/styles/_tokens.scss` (both `[data-theme]` blocks).
- `color-mix(in srgb, var(--ds-on-surface) 14%, transparent)` on the
  gallery-header active pill matches the convention established in #1214.
- `var(--mat-sys-*)` reads (allocation/*, position-card tier badges) are
  bridged tokens, not literals — left for #1163 de-materify by design.
- In-review fixes applied (see Findings) — all verified by re-running
  the inventory and a clean sass compile afterwards.

## Spec — PASS

| AC | Result |
|---|---|
| Inventory re-run shows literal sites consumed or tagged | MET — positions-view + portfolio-dashboard `kind=literal` sites → 2 remaining, both `#853` issue-reference false positives in comments |
| No new color literals introduced | MET — `git diff -U0` over the scoped files shows zero added literals; all added declarations are `var(--ds-*)`/`color-mix` |
| `--ds-up`/`--ds-down` semantics preserved | MET — `.long`/`.profit`/`.positive` → up pair; `.short`/`.loss`/`.negative` → down pair; `.short` was found mid-review still on `var(--mat-sys-error)` and corrected to `--ds-down` |
| Visual spot-check dark + light | DEFERRED — user-directed; phase-level walkthrough after #1216/#1217 land |
| Existing specs stay green | MET — full `npx jest`: **271/271 suites, 4,721/4,721 tests**; sass compile clean |

## Thermo-nuclear — PASS (after in-review fixes)

- Direction vs feedback split is correct throughout (`up/down` for
  side/PnL, `success/error/warning` for protection/error states);
  container/on-container pairs correct wherever explicitly set.
- Mint/crimson `linear-gradient` card/badge fills → flat
  `--ds-up-container`/`--ds-down-container` — thematically sound; the
  flat-vs-gradient visual delta is flagged for the deferred walkthrough.
- `--theme-surface` legacy bridge aliases canonicalized to
  `--ds-surface` in the two swept files that used them.

## Findings (all resolved in-review unless noted)

- **Major (fixed)** — `.pv-open-card__badge--status` used
  `--ds-up-container`, identical to the long card's own background —
  invisible badge on every long card, and a direction hue for a
  non-direction OPEN/CLOSED status. Now `--ds-surface-overlay` +
  `--ds-on-surface` (neutral status chip, theme-adaptive).
- **Major (fixed)** — `account-summary.component.scss:19`
  `rgba(0,0,0,0.54)` missed literal on `.pd-summary-label` —
  near-invisible under the shipping dark theme. → `--ds-on-surface-variant`.
- **Minor (fixed)** — four `var(--ds-surface-variant)` uses introduced
  on a token the layer marks deprecated ("retires in the literal
  sweep"). → `--ds-surface-raised`; the `.pv-more` hover, which had
  collapsed to a zero-delta (raised → variant = same value), now uses
  `--ds-surface-overlay` restoring a real hover delta.
- **Minor (fixed)** — four `rgba(255,255,255,*)` white-alpha literals in
  `portfolio-gallery-header.component.scss` (dark-tuned; collapse under
  light theme) → `--ds-border-subtle` hairlines/pill borders,
  `color-mix(on-surface 14%)` active fill, `--ds-border-strong` active
  border.
- **Minor (fixed)** — `.pv-open-card__badge--side` container background
  without paired `color` → added `--ds-on-accent-container`. Card-level
  `--long`/`--short` container backgrounds intentionally carry no painted
  `color` — descendants set their own; judgement call consistent with
  the original markup.
- **Nit (fixed)** — `.chip--active` in `open-grid.component.scss` is
  dead CSS (template binds `mat-chip-option [selected]`), tokenized
  anyway; removal is cleanup-scope, not this task.
- **Nit (parked)** — `--mat-sys-*` muted-text/tier reads in
  `position-card` mix vocabularies with `--ds-*`; converge under #1163.
- **Nit (parked)** — flat containers vs prior gradients; confirm in the
  deferred visual pass.
- **Nit (parked)** — positions-view has zero spec files; sweep is
  style-only so jest coverage is indirect. Noted for UAT evidence.

## Test results

- `npx jest --coverage=false` (full suite) — **271/271 suites,
  4,721/4,721 tests, 0 snapshots**
- `npx sass --load-path=node_modules/savant-ds/styles src/styles.scss` —
  clean
- `node scripts/inventory-ui-colors.mjs` — regenerated post-fix;
  artifact in diff; 2 remaining sites both `#853` issue-ref FPs

## Convergence pass (round 2)

All six round-1 fixes re-verified correct and complete (badge separation
+ contrast both themes, zero remaining literals, deprecated-alias purge,
hover delta restored, white-alpha purge, pairing, `.short`→`--ds-down`,
`--theme-surface`→`--ds-surface` canonicalization). Full-diff re-scan
produced no new major findings:

- **Minor (parked — user question)** —
  `positions-view.component.scss:19,29` call `mixins.border1(blue)` /
  `border1(red)` — named-color literals emitted by the debug-scaffolding
  mixin (default already `--ds-border-strong`). 8 `border1()` boxes
  render on layout containers; flagged for user confirmation whether the
  scaffolding is intentional vs stale debug, rather than silently
  tokenizing a debug artifact. `trade-journal` uses the same mixin.
- **Nit** — `--side` badge uses accent-family for a direction datum
  while `positions-view` rows use up/down containers; defensible (card
  bg encodes direction) but inconsistent — visual pass.
- **Nit** — dark-theme neutral-on-tinted separations (overlay badge,
  raised track on `#153b21`/`#41171b` up/down-container cards) rely on
  hue over luminance — subtle; dark-mode visual pass.
- **Nit** — `tier-small` `--mat-sys-error` for a neutral size category +
  `--mat-sys-*`/`--ds-*` vocabulary mix — converges under #1163.

No further passes needed — findings converged to parked minors/nits.

## Verdict

**PASS** — 0 critical, 0 major remaining (2 majors found and fixed
in-review); parked nits recorded for #1162/#1163 and the deferred visual
pass. Advance to `7_QA`.
