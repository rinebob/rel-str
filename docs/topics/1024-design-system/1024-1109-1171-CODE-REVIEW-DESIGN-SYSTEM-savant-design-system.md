# Code Review — #1171 foundation-mixin consumer migration

**Topic:** Savant Design System  
**Topic Slug:** savant-design-system  
**Thread:** Widget Layer  
**Thread Slug:** widget-layer  
**Issue:** #1109  
**Thread Parent:** #1101  
**Topic Parent:** #1024  
**Task:** #1171  
**Domain:** DESIGN-SYSTEM  
**Type:** CODE-REVIEW  
**Status:** Complete  
**Created:** 2026-10-21  
**Last Updated:** 2026-10-21  

## Verdict: PASS — two rounds: R1 remediated banner markup + `.neg`
specificity; R2 re-attacked the post-remediation diff, adopted the three
plain `<table>`s (the R1 dense-table deferral had been drawn too wide —
it applies to `mat-table` MDC DOM only), and fixed a missing MatIconModule
import the NG0304 spec warning exposed.

## Scope

- `error-banner` — paper-trading, strategy-builder,
  options-strategy-dashboard adopt `vl.error-banner` + canonical
  `mat-icon`/`error-text` markup; `#ffebee`/`#c62828` literals gone.
- `state-block` — 17 scss: the three above + analysis (split from the shared
  `.loading-container` rule), analysis-scatter/histogram, triage-report
  (`.error-state` too), flex-chart `.no-data`, order-queue, chart-review,
  chain-grid `.no-data`, backtest-run-list/-run-summary/-permutation-detail,
  signal-review (the mixin's own origin — zero-diff adoption),
  run-history-panel, and `heatmap-view__empty` (previously **unstyled**).
- `stat-strip` — order `.scoreboard` (pure include-swap, `.sb-sub` kept
  local), alloc-detail `.stats-strip`/`.pos-stats`, buckets-table
  `.expand-stats`; the two inline templates re-marked to canonical
  `sb-item`/`sb-label`/`sb-value` (+ `sb-sep` pipes on `.stats-strip`).
- Spinner dedupe — run-metrics-strip local `@keyframes spin` removed; the
  global `spin` in `src/styles.scss` is the single source (order-ticket and
  order.component already relied on it — verified `animation: spin`
  references survive unrenamed in compiled output).
- Literal sweep in the three banner files: secondary text →
  `on-surface-variant`, `.positive`/`.negative` → `vl.$up`/`vl.$down`,
  borders → `--ds-border-subtle`, card bg → `surface-container`,
  lifecycle badges → success/warning container pairs — these surfaces now
  respond to a token re-palette (the point of doing this before #1161).
- `dense-table` — plain `<table>`s adopted in R2: `.trades-table`
  (paper-trading), `.instances-table` (strategy-builder), `.positions-table`
  (options-strategy-dashboard). `mat-table` holdouts remain deferred — R1.
- Task #1171 relay + guide + run-all/README registration — 110 checks.

## Findings remediated in review

| # | Severity | Finding | Fix |
|---|---|---|---|
| R1 | MED | The two mat-table holdouts (`rs-table`, `spread-builder-dialog`) **cannot adopt `dense-table`** — MDC's `.mat-mdc-cell`/`.mat-mdc-header-cell` class selectors outrank the mixin's `tbody td`/`thead th` element rules, so `@include` would be a cosmetic no-op at best. Inventory's "mat-table override holdouts" framing was misleading: adoption requires markup conversion (mat-table→table), not CSS. | Deferred to #1163 De-Materify with documented rationale in the relay guide; `heatmap-view`'s mat-table was already gone (stale comments corrected) — its real holdout was the unstyled `__empty`, migrated. |
| R2 | MED | `.neg` accents on `sb-value` in both allocation components lose a specificity tie to the mixin's `.strip .sb-value` (0,2,0) — red drift/P&L values suppressed when the emitted rule lands later in source order (buckets-table `.expand-stats`). | Scoped `.expand-stats .sb-value.neg` / `.stats-strip .sb-value.neg` / `.pos-stats .sb-value.neg` compound rules (0,3,0, order-independent); compiled-CSS regression guards added to the relay. |
| R3 | LOW | Banner markup was bare text — the mixin's `.error-text` child (`flex:1`, 13px copy) never matched; inconsistent with canonical PD markup (`mat-icon` + `error-text` span). | All three banners re-marked to canonical form; relay guards assert `.error-text` + `mat-icon` presence. |

## Deliberate non-migrations (documented in guide)

- `alloc-detail .empty` — compact in-card empty block inside the position
  carousel; `state-block`'s 48px state padding is wrong for an in-card
  micro-state.
- `analysis .loading-container`, triage/signal-review `.loading-overlay` —
  spinner rows, not state blocks; kept local.
- `src/styles.scss --mat-sys-error-container: #ffebee` — that IS the token
  the banner reads; not a consumer.
- `rs-table`/`spread-builder-dialog` dense-table — see R1 (plain `<table>`s
  on the three banner pages *were* adopted in R2).

## Round 2 (post-remediation re-review)

Focused re-attack on the post-R1 diff. Two findings, both fixed:

| # | Severity | Finding | Fix |
|---|---|---|---|
| R2-1 | MED | **Dense-table deferral was over-broad.** R1 deferred `rs-table`/`spread-builder-dialog` because MDC classes outrank the mixin's element rules — but the three banner pages also carry *plain* `<table>`s (`.trades-table`, `.instances-table`, `.positions-table`) where the mixin binds cleanly. Leaving them meant the task's dense-table line shipped zero adoptions. | All three now `@include vl.dense-table`. Kept load-bearing locals: `trades-table` `border-collapse: separate` + th-level sticky (the reliable sticky pattern under `separate`); `instances-table` `tbody td` 24px dense rows (lifecycle-badge grid); per-table `nowrap`. |
| R2-2 | MED | `NG0304: 'mat-icon' is not a known element` — R3's canonical banner markup added `<mat-icon>` but options-strategy-dashboard never imported `MatIconModule`: the literal text "error" would have rendered instead of the icon. Spec console output caught it; the other two pages already imported it. | `MatIconModule` added to the component's imports. |

**Round 2 also checked:** `.pos` on `sb-value` (only `td.num` in
buckets-table — no collision); `state-block` markup compatibility on
bare-text hosts (scatter/histogram/chain-grid/flex-chart — text nodes in a
flex-column center fine); `@use` placement conventions; global `spin`
reference intact.

**Accepted, not fixed:** dense-table's `text-transform: uppercase` now
applies to `thead th` on the three adopted tables — canonical dense-table
convention (all PD tables render uppercase headers); flagged for the
visual pass.

## Minor visual deltas (standardization, intentional)

- Empty-state icons normalize to the mixin's 36px (were 32/40/48px across
  consumers); copy to `--ds-font-size-md`, hints to `sm`.
- `.scoreboard` separators lose their local `opacity: 0.6` — pipes render at
  full `--ds-border-subtle` now.
- `.stats-strip`/`.expand-stats` values gain bold monospace + `--ds-on-surface`
  (scoreboard convention) — labels dim, values pop.
- flex-chart `.no-data` gains the mixin's 48px padding inside its 100%-height
  host — verify against a small chart pane in the visual pass.
- Adopted dense tables: headers gain `uppercase` + `--ds-font-size-2xs`;
  td padding 5px 10px (was 0–3px × 6–8px); `instances-table` keeps 24px
  rows; `trades-table` sticky headers now on both thead and th.

## Test results

```text
#1171 relay          110/110  (R2: +dense-table guards)
#1115 relay           30/30   (regression)
#1114 relay           47/47   (regression)
ng build (dev)        pass
focused Jest          45/45 suites · 910/910 tests
R2 focused re-run     11/11 suites · 228/228 tests (3 banner pages + alloc
                    components; NG0304 resolved)
full Jest             252/252 suites · 4249/4249 tests
```

Compiled-output verification: `.expand-stats .sb-value.neg` and both dialog
`.sb-value.neg` compounds emit and outrank the mixin color; `animation: spin`
references resolve to the global keyframes (no scoped rename).
