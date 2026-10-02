**Topic:** Navigation and Workflows  
**Topic Slug:** trading-workflows  
**Thread:** Journey Navigation  
**Thread Slug:** journey-navigation  
**Issue:** #698  
**Task:** #699  
**Topic Parent:** #625  
**Domain:** WORKFLOWS  
**Type:** CODE-REVIEW  
**Status:** Complete — PASS (1 round, findings fixed in-round)  
**Created:** 2026-09-29  
**Last Updated:** 2026-09-29  

# Code Review — #699 FE Canonical route tree

Three-axis review (Standards / Spec / Thermo-nuclear) on the canonical route-tree change. Scope: `interfaces.ts` enum renames, `core-routes.ts` redirects, `constants.ts` nav hrefs, literal `navigate()` sweep in 4 files, new `core-routes.spec.ts`, 5 spec assertion updates, plus review-round fixes (below).

## Standards

- **MAJOR (fixed)** — `prototype-today.data.ts:30-35` held 6 stale literal routes (`/portfolio-dashboard`, `/signal-review`, …) that fell through `**` → `/`. Now derives from `AppRoutes` (`'/' + AppRoutes.X`). Throwaway surface, but the sweep is mandated to leave no stale literals.
- **MINOR (accepted)** — `signal-history` / `signal-action-report` remain unprefixed (`interfaces.ts:45,48`) — **deliberate**: user deferred both to future scope; PRD documents them unchanged.
- **NIT (fixed)** — stale `URL:` doc comments: `order.component.ts:8` → `/trading/live`, `chart-review.component.ts:6` → `/signals/charts`, `signal-review.component.ts:6` → `/signals/review`.
- **NIT (fixed)** — `option-chain-pct-change.component.ts:611` comment falsely claimed routerLink needs one element per segment.
- **NIT (noted, T2 scope)** — nav `name:` fields keep old slugs; harmless identifiers, restructured in #700.
- **Noted** — two concat flavors (`'/' + X` vs `` `/${X}` ``) coexist; both resolve identically, not churned.

## Spec

5/6 criteria MET; jest verified by parent. Per-criterion evidence in axis output:

- Canonical leaf paths: all 21 registered + auth-gated, row-by-row vs IMPL §1 ✓
- Redirects `''`→`portfolio`, `signals`→`signals/runs`, `options`→`options/chain` ✓
- No literal `navigate(['/…'])` for renamed routes — grep clean ✓ (post-fix incl. prototype-today)
- 13 legacy routes still registered, unchanged paths ✓
- Route-table spec exists, follows the #644 spec precedent ✓
- TOPIC_VIEWER reconciliation: `tools/topic-viewer` — consistent with the domain-prefix scheme ✓

## Thermo-nuclear

- **Key question answered:** `'/' + AppRoutes.X` is safe for multi-segment values — `createUrlTree` splits string commands on `/`; identical UrlTree either way. Existing convention, now uniform.
- Spec quality verified — literal assertions (independent source of truth), `keyof`-typed enum map gives compile-time exhaustiveness.
- **MINOR (fixed)** — spec hardening added: duplicate-path uniqueness guard, `**` → `/` wildcard assertion, nav href↔`AppRoutes` parity for the 5 renamed items + topic-viewer.
- **Advisory (fixed)** — `auth.store.ts` post-sign-in/sign-up landed on `DASHBOARD_V2` (a nav-removed legacy surface). Now navigates to `PORTFOLIO_DASHBOARD` (`/portfolio`) — consistent with the landing decision. ×3 methods.
- **Info** — retired paths hard-fall through `**` → `/` (no aliases — explicit user decision; no nav history to support).

## Test results

`npx jest --coverage=false` — **161 suites, 2240 tests, all green** (58 → 66 route-table assertions).

## Verdict

**PASS** — major finding fixed in-round; minors fixed or documented as deliberate scope deferrals.
