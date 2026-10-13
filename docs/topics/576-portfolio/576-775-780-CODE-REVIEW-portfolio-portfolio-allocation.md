# Code Review — Task #780: Tables → dense-table convention

**Topic:** #576 Portfolio Allocation  
**Topic Slug:** portfolio-allocation  
**Thread:** #751 Portfolio Visual Consistency  
**Blueprint:** #775 (FE)  
**Issue:** #775  
**Thread Parent:** #751  
**Topic Parent:** #576  
**Task:** #780 — FE: Tables → dense-table convention (buckets+expando, positions, equity, options, orders, history)  
**Domain:** PORTFOLIO  
**Type:** CODE-REVIEW  
**Status:** Complete  
**Created:** 2026-10-12  
**Last Updated:** 2026-10-13  
**Reviewer:** Devin (three-axis: Standards / Spec / Thermo-nuclear sub-agents)  
**Verdict:** PASS (after in-loop remediation)

## Scope reviewed

- `styles/_pd-visual-language.scss` — `dense-table()` gained a `tfoot` block (totals density + `.num`) and `thead` z-index 1→2
- `allocation-buckets-table.component.{ts,scss}` — inline `styles:` → NEW `styleUrl` scss consuming `vl.dense-table` on `.alloc-table` + `.mini-table`; all colors tokenized
- `allocation-positions-table.component.{ts,scss}` — same swap; `bulk-error`/`selection-bar`/`link-icon` tokenized
- `components/{equity-positions,option-positions,open-orders,order-history}-table.component.{html,scss}` — `.pd-table` → `vl.dense-table`; `.num` classes added to numeric columns; P&L → `vl.$up`/`vl.$down`; state blocks tokenized
- Six spec files — appended `dense-table num class` assertions
- **Foreign in-flight code in the same files was scoped out** (DEV SHIM `rowShim`/`localShim`/`.pd-shim-*`, sort machinery `.pd-sort`/`table-sort.util`, `showClosed`/`cancelOrder`/`protectedSymbols` work — Topic #219/#887 session's uncommitted changes)

## Standards

- `@use` architecture correct at both directory depths; `styleUrl` swap complete; zero residual `styles:` on the six tables.
- Real consolidation — no hand-rolled dense spec survives; mixin is the single source.
- Residual per-table styles justified (totals pinning, actions density, mini-table static thead).
- Token discipline clean in-scope; no dead selectors left behind.

## Spec

All five ACs MET against current file state:

| AC | Verdict |
|---|---|
| All six tables (incl. expando mini-table + totals) use dense-table spec | MET — `@include vl.dense-table` on all six; `.mini-table` + mixin `tfoot` |
| Right-aligned numerics, expando mechanics, column sets preserved | MET — `.num` on every numeric th/td incl. tfoot; expando testids/`aria-expanded` intact |
| Colors tokenized, no hard-coded greys/reds | MET — only literals are foreign `.pd-shim-*` + the partial's designated `$up`/`$down` tokens |
| P&L accents via `vl.$up`/`vl.$down` | MET |
| Specs green | MET — see below |

## Thermo-nuclear

Cascade-math audit of the mixin's emitted selectors vs per-table overrides. One critical + two major findings, all fixed in-loop (below); border-collapse/sticky interplay and nested-table overrides verified sound. Firefox note: `thead` sticky is Chrome/Safari-only — same trait as the signal-table reference; accepted.

## Findings (all remediated in-loop)

1. **CRITICAL — P&L accents dead.** Mixin `tbody td`/`tfoot td` emitted `color: on-surface` at specificity (0,1,2), beating single-class `.neg`/`.pos`/`.pd-positive`/`.pd-negative` (0,1,0). PnL% cells and all totals accents rendered black; specs couldn't see it (they assert class presence). **Fix:** deleted `color` from `td`/`tfoot td` — cells inherit `on-surface` from the page shell; comment added explaining why the rule must not return.
2. **MAJOR — warn-banner pink.** `tertiary-container` is `#f8bbd0` in this theme; the banner was amber. `styles.scss` already defines the purpose-built `--mat-sys-warning-container`/`on-warning-container` (`#fff3e0`/`#e65100`). **Fix:** swapped.
3. **MAJOR — expando padding dead.** `.expand-row td` (0,1,1) lost to the mixin's `tbody td` (0,1,2); intended 8px padding never applied. **Fix:** nested under `.alloc-table` (0,2,1 wins).
4. **MINOR — z-index comment misattributed mechanism.** Actual leak is stroked/text `.mdc-button` internals (root `z-index:auto`, no stacking context); `mat-icon-button` self-contains via `z-index:0`. **Fix:** comment corrected.
5. **MINOR — equity P&L rules redundant.** **Fix:** consolidated to `.pd-pnl.pd-positive, .pd-positive` form matching options.
6. **Accepted nits:** `.pd-totals td` block duplicated equity↔options (2 consumers, pinning stays local by design); hover `surface-container-low` invisible on cash/expando rows (cosmetic); `.num` tests pin counts not column names (sanctioned by TEST doc's class-presence proxy); 24px dense-button recipe emitted 3× (straddles the foreign boundary — defer until #887's work settles).

## Tests

- `npx jest src/app/features/portfolio-dashboard` — **516/516 green** (re-run post-remediation).
- `ng build` — clean; SCSS partial compiles for all consumers.
- Full `npx jest` — 3565 pass, **43 failures in 2 suites, all foreign to this task**: `shared/screenshot-capture-contracts.spec.ts` (PositionType enum grew beyond its pinned contract — other session's option work) and `order.component.spec.ts` (`No provider found for Functions` — other session's OrderExecutionService→ScreenshotService dep). Zero overlap with the reviewed change-set.
- `tsc --noEmit` — two pre-existing errors in `scripts/bulk-swing-sweep.ts` + indicator-config dialog; not this task's files.

## Review pass 2 (post-remediation re-review)

Both code axes re-ran on the post-remediation diff. All pass-1 fixes verified correct. New findings, all remediated:

1. **HIGH — `outline-variant`/`surface-container-low` tokens never defined.** The M2 `indigo-pink` prebuilt emits zero `--mat-sys-*` vars; the hand-rolled `:root` block in `src/styles.scss` (purpose-built for this — comment at line 5) defined 27 tokens but not these two. Every `var()` ref was invalid-at-computed-value → all table hairlines, hover tint, row tints silently dropped app-wide (~100 refs, incl. the signal-table reference). **Fix:** added `--mat-sys-outline-variant: #c7cbda` and `--mat-sys-surface-container-low: #f8f9fd` to the `:root` block, matched to the existing indigo ramp. Repo-wide repair, not just this task.
2. **MEDIUM — `.expand-row td` descendant selector overshot into `.mini-table`** (my pass-1 padding fix introduced it): 8px padding beat the mixin's 5px/10px on every mini-table cell, and the 3px left border would have landed on all of them once the token went live. **Fix:** child combinator `.expand-row > td`.
3. **MINOR — dead `--mdc-*` button tokens** (renamed in Angular 20; carried verbatim from old inline styles). **Fix:** 5 renames to verified AM20 names — `--mat-icon-button-state-layer-size`, `--mat-icon-button-icon-size`, `--mat-button-outlined-container-height`. Note: icon-button icons now render 16px inside the 28px button (the originally intended size; previously dead config left them at 24px).
4. **MINOR — `.empty-row` mixin block unused in-feature.** **Fix:** positions-table `@empty` td now carries `class="dim empty-row"`.

Accepted/left: vestigial `.qty` class on a mini-table tfoot cell (pre-existing, no styles); `.pd-pnl` compound selectors kept as defensive specificity; sticky-`tfoot` + `border-collapse` paint check is a visual item now that the border token resolves.

Pass-2 verification: 6/6 focused suites (86 tests) green, `ng build` clean.

## Verdict

**PASS** — two review passes; all critical/major findings found and fixed in-loop; ACs verified against file state. Ship-blocker awareness for `/proj ship`: the four section-table files interleave #780 hunks with foreign uncommitted work — stage hunk-level at ship time. `src/styles.scss` also carries a #780-owned hunk (the two token definitions) that must ship with this task.
