# CODE-REVIEW — #1108 savant-ds widget mixins

**Topic:** Savant Design System  
**Topic Slug:** savant-design-system  
**Thread:** Widget Layer  
**Thread Slug:** widget-layer  
**Issue:** #1106  
**Thread Parent:** #1101  
**Topic Parent:** #1024  
**Task:** #1108  
**Domain:** DESIGN-SYSTEM  
**Type:** CODE-REVIEW  
**Status:** Complete  
**Created:** 2026-10-18  
**Last Updated:** 2026-10-18  

## Scope

`savant-ds` working-tree diff — 4 files:

- `styles/_widgets.scss` (new, ~330 lines) — 9 mixins
- `styles/_index.scss` — `@forward 'widgets'`
- `scripts/verify.mjs` — manifests + `WIDGETS_FIXTURE` + widget assertion
  block (~120 new checks)
- `README.md` — mixin list + status line

Reviewed against #1108 ACs, `1024-1101-1104-IMPL-SHARED`, and
`1024-1101-1104-TEST-SHARED`.

## Verdict: PASS

## Standards axis — PASS

- Partial follows package conventions exactly: provenance header block,
  retired-scope exclusion notice, `///` doc contract per mixin,
  `--ds-*`/`--mat-sys-*`-bound values, no `@use`/`@forward` hops, no
  `@function`/`%placeholder`, no `@import`, no `//`-in-string literals.
- 9 mixins in one partial matches the `_data-display.scss` granularity
  precedent; file is cohesive (all small interactive/display chrome).
- `verify.mjs` extension mirrors the existing section structure
  (manifest → fixture → probeRe stray-guard → `expectDecls` both
  directions → no-hex guard → direct-partial resolution) — no drift.
- Emitted decls asserted *verbatim both directions* per selector — a
  much stronger contract than the prior partials needed, and it caught
  zero undocumented emissions.

## Spec axis — PASS

| AC | Status |
|---|---|
| 9 mixins emitted (`pill-toggle`, `pill-btn`, `badge`, `icon-btn`, `toolbar-row`, `nav-stepper`, `field-input`, `toggle-chip`, `dir-edge`) | MET — manifest set-equal check |
| `_index.scss` forwards `widgets` | MET — forward manifest check |
| Compile probe renders clean | MET — `WIDGETS_FIXTURE` compiles all 9 via `@use 'index' as ds` |
| No new tokens; all values `--ds-*`/`--mat-sys-*` | MET — zero literals, zero hex in emitted CSS |
| Zero `verdict`/`acr`/`expansion`/`--ds-verdict` | MET — retired-scope guard check |
| `.review`/`.accept` pill-btn variants absent | MET — selector-scan guard |

Test plan coverage: T1 (compile), T2–T10 (emitted decls per mixin),
T11 (retired-scope) — all mapped to verify.mjs checks.

## Thermo-nuclear axis — PASS (1 minor, 3 nits)

- **Minor — `.emph` cursor semantics.** Source `.signals-total` emitted
  `cursor: default` (non-interactive count display); `&.emph` inherits
  `cursor: pointer` from the base. Migration (#1114) renames
  `signals-total` → `emph` on a non-interactive element — pointer
  cursor on a display pill would be wrong. Options: emit
  `cursor: default` under `&.emph`, or add `.static` modifier. Decide
  at migration; doesn't block (nit-level visual, one-line change).
- **Nit — `field-input` fixed `width: 120px`.** Verbatim from
  `header-filter`; a param (`$width`) is a trivial add if a second
  consumer needs a different width. Defer until needed.
- **Nit — `.nav-btn` vs `.icon-btn` shape overlap.** ~8 shared decls at
  different sizes (22px vs 28px); kept separate deliberately — merging
  via a size param would couple two independently-evolving contracts.
- **Nit — `.title` under `toolbar-row`** is a generic class name;
  container-scoped so collision-free in practice.
- `color-mix` for dir-badge tints — browser support documented in IMPL
  §7 with tint-token fallback; contract identical either way.
- `dir-edge` uses `border-left` on `tr` — same technique as the source
  (`signal-table`), parity preserved under `border-collapse: collapse`.
- `.flat` variant (added during impl for chart-toolbar's borderless
  toggles) — now documented in IMPL §3 as-built.

## Test results

`npm run verify` (savant-ds) — **all green, 0 FAIL**: every prior
section (tokens, page, dialog/feedback, data-display, coverage) plus
the new widgets block. No rel-str code touched, so the jest suite is
unaffected.

## Findings summary

- Critical: 0 · Major: 0 · Minor: 1 (`.emph` cursor) · Nits: 3
