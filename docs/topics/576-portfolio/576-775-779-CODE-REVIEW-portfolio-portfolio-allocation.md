# Code Review — Task #779: Allocation page shell

**Topic:** #576 Portfolio Allocation  
**Topic Slug:** portfolio-allocation  
**Thread:** #751 Portfolio Visual Consistency  
**Blueprint:** #775 (FE)  
**Issue:** #775  
**Thread Parent:** #751  
**Topic Parent:** #576  
**Task:** #779 — FE: Allocation page shell — header bar, inline account strip, single subtab row  
**Domain:** PORTFOLIO  
**Type:** CODE-REVIEW  
**Status:** Complete  
**Created:** 2026-10-07  
**Last Updated:** 2026-10-07  
**Reviewer:** Devin (three-axis: Standards / Spec / Thermo-nuclear sub-agents)  
**Verdict:** PASS  

## Scope reviewed

- `allocation-page.component.ts` — template rewritten onto the reference shell; `styles:` → external `styleUrl`
- `allocation-page.component.scss` — NEW; `@use`s `_pd-visual-language`
- `allocation-page.component.spec.ts` — 4 new structural tests + `accountsLoaded` mock
- `allocation-buckets-table.component.ts` — styles block only: retired-section + expando chrome tokenized
- `styles/_pd-visual-language.scss` — remediation added `bounded-tab-group`, `tab-scroll-pane`, `stat-strip` mixins
- `portfolio-dashboard.component.scss` — remediation: consumes the three new mixins (replaces a dead wrapper rule)
- `allocation.store.ts` — remediation: `accountsLoaded` state flag

## Standards

- **major → fixed** `routerLink="/portfolio"` literal → `AppRoutes.PORTFOLIO_DASHBOARD` binding (`portfolioRoute`), same convention as the dashboard's `allocationRoute`.
- **minor (documented)** `.strip-*` hand-rolled clone of `.sb-*` scoreboard → resolved via the shared `stat-strip` mixin (see Thermo).
- **nit** Spec file now ~340 lines — over the 300 soft target, well under 400.
- **nit** `template` inline + `styleUrl` external is a split unique in the feature; required for `@use` — acceptable.
- **non-issue** duplicate `data-testid="account-error"` in both tab bodies — lazy tab content means only one can render at a time; pre-existing.
- Verified: `@use` path/alias identical to dashboard; `animationDuration="0ms"`, `mat-stroked-button` on anchor, `mat-icon-button`, tooltip/aria all match reference; token vocabulary consistent; no `as any`/`as never` in tests; deterministic async only.

## Spec

Every #779 AC accounted for:

- Header bar with account toggle + refresh in header actions, toolbar row removed — **met**. The verbatim AC says "title"; per the #853 convention (title lives in the global `rs-header` — the dashboard's governing precedent) no local title is correct.
- Account-header strip inline below the header, compact tokenized strip — **met** (`surface-container` + `outline-variant` hairline + `|` separators, `as-of` pinned right).
- Single `mat-tab-group` with `animationDuration="0ms"` — **met** (`"0ms"` ≡ `"0"`; dashboard parity; pinned by spec).
- Retired-section chrome on tokens — **met** (`.retired-toggle`/`.retired` table on `--mat-sys-*`; expando inset also tokenized — slightly beyond the literal AC wording but explicitly justified by QA #839's "nested wrapper" complaint routed here).
- Loading/error/empty → shared mixins — **met after remediation**: `.alloc-state`/`vl.state-block`, `.alloc-error`/`vl.error-banner`, plus a true `accounts-empty` state (`accountsLoaded` flag added — previously zero-accounts rendered "Loading…" forever).
- Page shell bounds the tab chain so expandos scroll — **met after remediation** (see Thermo finding).
- Specs green — **met**: 371/371 feature tests.

## Thermo-nuclear (Dr. Reed lens)

- **major → fixed** The tab-body bound was *incidental*: it relied on Material internals (`overflow:hidden` auto-min-0 + active body's own `overflow-y:auto`) because `.mat-mdc-tab-body-wrapper` can't be reached by an encapsulated selector — verified in the compiled bundle that the dashboard's copy of that rule is dead code (`[_ngcontent]` on both segments; the unencapsulated second copy was the embedded sourcemap). Fixed the intended way: `vl.bounded-tab-group()` emits a `::ng-deep` wrapper rule (same technique as `backtest-report-dialog`), consumed by BOTH `.alloc-tabs` and `.pd-tabs`. Compiled output confirms the live rule: `.alloc-tabs[_ngcontent] .mat-mdc-tab-body-wrapper { flex:1; min-height:0 }`.
- **major → fixed** `.account-header`/`.strip-*` re-implemented `.pd-scoreboard`/`.sb-*` → `vl.stat-strip()` extracted; both pages consume it (markup renamed to shared `.sb-*` class names).
- **minor → fixed** `store.accounts().length` evaluated 3× → `@let accounts` alias.
- **minor → fixed** shell-chain test asserted class names only — now also pins the injected `.mat-mdc-tab-body-wrapper` rule, the exact link that was half-copied once.
- **minor — declined** collapsing the duplicated loading/error/else tri-state across both tabs: `ng-template` can't parametrize the component selector (`<app-allocation-buckets-table>` vs `<app-allocation-positions-table>`) without more machinery than the 12-line duplication costs. Hoisting the gate above the group would destroy/recreate it and reset `selectedIndex`.

## Test results

- `npx jest src/app/features/portfolio-dashboard` — **371/371 green** (24 suites).
- `npx ng build` — clean.
- Full suite `npx jest` — **3085/3086**; the one failure is `shared/screenshot-capture-contracts.spec.ts` (a spec asserting `PositionType` is stock-only while the user's in-flight #846 work expands the enum) — unrelated to this diff; user's parallel change, same class of caveat as the earlier gallery-spec drift.

## Verdict

**PASS** — all critical/major findings remediated and re-verified (compiled CSS evidence for the scroll bound; 371/371 tests; build clean). The remediation also repaired the dashboard's latent dead wrapper rule via the shared mixin — a bonus fix for #776's intent.
