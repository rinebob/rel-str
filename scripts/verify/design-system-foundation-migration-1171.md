# #1171 — foundation-mixin consumer migration relay

`design-system-foundation-migration-1171.ts` — sweeps the remaining
hand-rolled duplicates of the foundation mixins onto `savant-ds` via the
`pd-visual-language` shim. Pure adoption: no package changes.

## Scope

| Mixin | Consumers |
|---|---|
| `error-banner` | paper-trading, strategy-builder, options-strategy-dashboard |
| `state-block` | those three + analysis, analysis-scatter, analysis-histogram, triage-report (`.error-state`), flex-chart (`.no-data`), order-queue, chart-review, chain-grid (`.no-data`), backtest-run-list, backtest-run-summary, backtest-permutation-detail, signal-review (`.error-state`), run-history-panel, heatmap-view (`__empty` — previously unstyled) |
| `stat-strip` | order.component (`.scoreboard`), allocation-bucket-detail-dialog (`.stats-strip`, `.pos-stats`), allocation-buckets-table (`.expand-stats`) — the latter two also re-marked to canonical `sb-item`/`sb-label`/`sb-value`/`sb-sep` |
| `dense-table` | paper-trading `.trades-table`, strategy-builder `.instances-table`, options-strategy-dashboard `.positions-table` — plain `<table>`s, direct adoption. `trades-table` keeps `border-collapse: separate` + th-level sticky; `instances-table` keeps its 24px dense-row override on `tbody td` |
| spinner dedupe | run-metrics-strip local `@keyframes spin` removed — global in `src/styles.scss` is the single source |

Also: `strategy-builder` `.lifecycle-badge.stopped` retokenized to
`--mat-sys-error-container`/`on-error-container`.

## Deliberately out of scope

- `rs-table`, `spread-builder-dialog` (`<table mat-table>`): `dense-table`
  emits `thead`/`tbody`/`td` element rules that lose specificity to MDC's
  `.mat-mdc-cell`/`.mat-mdc-header-cell`. Real migration = mat-table→table
  conversion — belongs to #1163 De-Materify. (Round-2 review note: the
  R1 deferral covered these two only — the plain `<table>`s on the three
  banner pages were subsequently adopted, above.)
- `heatmap-view` "mat-table holdout": the mat-table no longer exists (div
  matrix); only the stale comment remained — corrected.
- `src/styles.scss --mat-sys-error-container: #ffebee`: that IS the token
  definition `error-banner` consumes — stays.

## What it verifies (~110 checks)

1. Every migrated SCSS imports the shim and `@include`s the right mixin.
2. Canonical `sb-*` markup present in the two inline templates.
3. Dead literals gone: `#ffebee`, `#c62828`, `rgba(0,0,0,0.54)`, local
   `@keyframes spin`; `analysis` `.empty-state` split from the shared
   `.loading-container` rule.
4. Preserved locals: `.sb-sub` (order), `--fc-no-data-text` (flex-chart),
   `flex:1`/`justify-content` layout retains.
5. Every migrated SCSS compiles against the vendored package; compiled
   error-banner emits `--mat-sys-error-container`, compiled state-block
   emits `--mat-sys-on-surface-variant`.
6. Relay registered in `run-all.ts` + this index.

```bash
npx tsx scripts/verify/design-system-foundation-migration-1171.ts
```
