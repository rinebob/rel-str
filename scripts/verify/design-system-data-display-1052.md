# Verification Guide — task #1052: savant-ds data-display mixins

## `design-system-data-display-1052.ts`

Graduates the remaining generic `_pd-visual-language.scss` mixins into
`savant-ds/styles/_data-display.scss`:

- **Graduated:** `dense-table` (8 call sites across 7 table stylesheets),
  `state-block`, `stat-strip` — verbatim semantics, `--ds-*` tokens where
  covered (`--ds-border-subtle`, `--ds-on-surface`, font-size/weight/space
  tokens); `var(--mat-sys-*)` reads stay for containers/variants with no
  `--ds-*` mirror
- **Stayed PD-local:** `bounded-tab-group` + `tab-scroll-pane` —
  Material-coupled (`::ng-deep .mat-mdc-tab-body-wrapper`,
  `--mat-tab-container-height`), two call sites, PD page shells only;
  not graduated while Material is being exited

### What it checks

1. `npm run verify` inside `../savant-ds` — the authoritative package
   checks (mixin-surface set-equality for `_data-display.scss`, index
   forward, fixture-compiled verbatim declarations both directions, no
   hex literals, no `:root`/stray-rule leakage, direct
   `@use 'data-display'` resolution, every public mixin exercised).
2. `ds-parity-probe` — compiles `dense-table`, `state-block`,
   `stat-strip` through BOTH the package index and the consumer shim
   (`@forward 'index'`), normalizes `var(--ds-*)` to the compiled
   `_tokens.scss` values on both sides, and diffs emitted declarations
   per selector (multiset — duplicate-decl counts must match).

### Usage

```powershell
npx tsx scripts/verify/design-system-data-display-1052.ts
```

### Prerequisites

- Sibling `../savant-ds` checkout with `npm install` run inside it
  (SKIPPED cleanly when absent).

### Pass criteria

`=== ALL CHECKS PASSED ===`, exit 0 — package verify green plus zero
parity diffs.
