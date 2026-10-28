**Topic:** Savant Design System  
**Topic Slug:** savant-design-system  
**Thread:** Theme & Palette  
**Thread Slug:** theme-palette  
**Issue:** #1202  
**Thread Parent:** #1161  
**Topic Parent:** #1024  
**Task:** #1213  
**Domain:** DESIGN-SYSTEM  
**Type:** Code Review  
**Status:** Complete  
**Created:** 2026-10-27  
**Last Updated:** 2026-10-27  

# CODE-REVIEW — #1213 FE: literal sweep — styles/global layer

## Verdict: PASS

All three axes passed with no critical or major findings. Four minor
items were fixed in-review (see "Fixes applied"); remaining items are
nits, documented exceptions, or deferrals to the feature-area sweeps
(#1214–#1217), listed below.

## Scope reviewed

- `src/app/styles/_variables-global.scss` — dead `$axis-label-fallback`
  removed; all 10 consumer-referenced `--theme-*` names now defined as
  `--ds-*` aliases in one `:root` block (previously only 4 were defined,
  and 6 were never defined anywhere — consumers silently used light-tuned
  fallbacks or dropped declarations). `[data-theme]` override removed;
  `--ds-*` carries both theme sets.
- `src/app/styles/_mixins-global.scss` — `rsButtonOne` `lightgrey`/`black`
  → `--ds-border-subtle`/`--ds-on-surface`; `border1` default `black` →
  `--ds-border-strong`; `customScrollbar` `#bbb`/`#888` fallbacks dropped
  (vars now defined).
- `src/styles.scss` — `literal-sweep (#1213) exception` tags on both
  `--mat-sys` definition blocks (68 literals = the bridge values
  themselves, retire in #1163); three bridge keys added per theme
  (`--mat-sys-background`, `--mat-sys-surface-variant`,
  `--mat-sys-warning`) fixing previously-dropped consumer declarations.
- `src/app/features/ds-gallery/ds-gallery.component.scss` — same 3 keys
  mirrored in the local dark `--mat-sys` block (relay parity contract,
  now 34 keys).
- `src/app/features/savant-trader/components/paper-trade-action-dialog/
  paper-trade-action-dialog.component.scss` — `var(--ds-font-size-xs)` →
  `var(--ds-font-size-sm)`; `xs` was never emitted, the `.mono`
  declaration silently dropped.
- `src/app/features/sync-chart-view/sync-chart-view.component.scss` —
  5 never-defined MUI-style vars (`--background-paper`, `--text-primary`,
  `--error-main`, `--text-secondary`, `--divider-color`) → `--ds-*`
  equivalents; 10 previously-dead declarations on a live legacy page.
- `docs/topics/1024-design-system/ui-color-sites.json` — regenerated
  (4,106 sites / 2,463 literals project-wide; 0 untriaged literals in
  the global layer).

## Standards — PASS

- Every `var(--ds-*)` introduced resolves to a real token in
  `vendor/savant-ds/styles/_tokens.scss` under the `on-{x}` naming
  contract; mappings are semantically correct
  (`background-paper`→`surface-raised`, `divider-color`→`border-subtle`,
  etc.).
- Dead code removed cleanly (`$axis-label-fallback` — zero references
  repo-wide).
- Comments honest and verified (heatmap light-fallback claims,
  dashboard-v3's no-fallback `var(--theme-primary)`).
- All `--theme-*` definitions live in one home; all 10 names have real
  consumers.
- Emission order is correct — `var()` in `--theme-*` resolves at
  computed-value time against `<html>`'s `data-theme`.

## Spec — PASS

- **AC1 (inventory re-run, consumed-or-tagged): MET** — 0 literals in
  `_variables-global.scss` / `_mixins-global.scss`; the 68 remaining
  `styles.scss` literals sit inside the exception-tagged `--mat-sys`
  definition blocks (matches the task's third-party/adapter exception
  category).
- **AC2 (no new literals): MET under exception reading** — 9 new hexes
  were added but all inside the tagged definition layer, each fixing a
  dropped consumer declaration (`--mat-sys-background`,
  `-surface-variant`, `-warning`). Reviewed and accepted as documented
  exceptions rather than untriaged consumer literals.
- **AC3 (--ds-up/--ds-down preserved): MET** — untouched.
- **AC4 (no stranded light-tuned literals): MET at code level** — all
  referenced `--ds-*` names exist in both theme sets; the sweep also
  *removed* stranded light-tuned fallback behavior (heatmap headers,
  dashboard-v3 buttons). The visual spot-check itself is a QA item.
- **AC5 (specs green): MET** — 269 suites / 4,650 tests pass; changes
  are SCSS/JSON-only.
- Scope note: three feature files were touched outside the named
  `styles.scss`/`app/styles/` area — all are minimal dead-var/dead-token
  bugfixes in the sweep's spirit, disclosed here rather than hidden.

## Thermo-nuclear — PASS

- No undefined-var regressions: every `--ds-*`/new `--mat-sys-*`/new
  `--theme-*` name verified against `_tokens.scss` and both bridge
  blocks; a full census of all custom-property families in `src` found
  no remaining dropped declarations (fallback-covered component vars
  like `--fc-*`/`--span`/`--header-height` excluded by design).
- Theme inversion: no contrast breaks — all `--theme-surface`/`--theme-on-surface`
  consumers pair consistently; the change *fixes* prior dark-mode
  breakage (light-tuned heatmap headers, unstyled dashboard-v3 selected
  state).
- `var()` chains: only color tokens inside `color-mix`; no px/shadow
  token leaks into color contexts.
- Contrast checks: `rsButtonOne` ~9–10:1 both themes; scrollbar thumb
  `--ds-border-strong` subtle on dark (~1.4:1) with hover affordance
  (~4:1) — deliberate, flagged for visual QA.
- `--mat-sys-surface-variant` dark `#44474e` matches the M3 baseline;
  `--mat-sys-warning` light `#fb8c00` matches `--ds-warning` exactly.

## Fixes applied in-review

- ds-gallery comment "full **31-key** set" → "full key set" (the count
  staled when keys went to 34).
- `--mat-sys-warning` reordered to lead its container pair in
  `styles.scss` (both blocks) + gallery mirror — restores the
  solid→on→container→on-container ordering convention.
- `_variables-global.scss` trailing newline restored.
- `_variables-global.scss` caveat comment added: `--theme-*` aliases
  resolve once at `<html>` (latent theme-freeze note — zero subtree
  consumers today) + token-role notes for scrollbar/button mappings.

## Round 2 — convergence pass (fresh eyes)

Second review round over the final diff found no CRITICAL/MAJOR issues;
round-1 claims re-verified independently. One new actionable minor +
three nits, all resolved:

- `ui-color-sites.json` was stale (regenerated before the in-review
  fixes — line drift in `_variables-global.scss`, pre-fix
  `--mat-sys-warning` ordering). Re-run; now current.
- Inventory whitelist gap found and fixed: `inventory-ui-colors.mjs`
  skipped `var(--ds-accent)` sites because `accent` was missing from
  the color-name whitelist — `--theme-primary`/`--theme-on-primary`
  aliases were absent from the artifact. `accent` added to the regex.
- NIT: ds-gallery 34-literal mirror block now carries an explicit
  `literal-sweep exception #1213` tag (was only inferrable).
- NIT: `rsButtonOne` token-role bend (`--ds-border-subtle` as button
  fill) now documented inline at the mixin.
- NIT (noted for QA): `--theme-outline` light-mode change — heatmap
  week separators go `#000` → `#b9c0ca` (dark mode improves; the only
  substantive light-mode visual change among the new aliases).

## Nits / deferrals (non-blocking)

- `sync-chart-view.component.scss` retains `rgba(0,0,0,…)` shadow
  literals — feature-sweep scope (#1214+), file stays in the inventory.
- `var(--header-height, 48px)` vs global `--app-header-height` — naming
  mismatch predates this change; run-dashboard already nests the global
  var. Flag for a later sweep to consolidate.
- `--ds-font-size-xs` may warrant a real SHARED token if a sub-12px
  size was the design intent — deferred to savant-ds backlog.
- `topic-viewer` hover used the always-`#f5f5f5` fallback — now themed
  (visual change, improvement; QA spot-check will see it).
- Pre-existing light-tuned literals inside feature files
  (`open-card`, `new-trade.dialog`, `rs-chart-view`, `dashboard-v2/v3`
  hovers) — catalogued by the thermo pass for the #1214–#1217 sweeps.
- Latent: `--theme-*` aliases are app-theme-frozen; a future
  subtree-scoped preview won't re-resolve them. Documented in-file.

## Verification

```text
npx sass --load-path=vendor/savant-ds/styles src/styles.scss  → clean
scripts/verify/design-system-palette-lock-1211.ts             → 19/19
npx jest                                                       → 269 suites, 4,650 tests
npx jest ds-gallery (post-review-fix re-run)                   → 16/16
inventory-ui-colors.mjs re-run                                 → 0 untriaged literals in global area
```
