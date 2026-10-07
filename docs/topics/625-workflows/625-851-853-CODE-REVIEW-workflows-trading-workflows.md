**Topic:** #625 — Navigation and Workflows  
**Topic Slug:** trading-workflows  
**Thread:** #823 — App-wide Header Unification  
**Thread Slug:** header-unification  
**Issue:** #853  
**Thread Parent:** #823  
**Topic Parent:** #625  
**Task:** #853  
**Domain:** WORKFLOWS  
**Type:** Code Review  
**Status:** Complete  
**Created:** 2026-10-07  
**Last Updated:** 2026-10-07  

# Code Review — rs-header page-identity zone (#853)

## Verdict: **PASS** (2 rounds)

Round 1: Standards **PASS** · Spec **PASS** · Adversarial **FAIL** — one CRITICAL + two MINORs remediated in-loop.
Round 2: Standards **PASS** · Adversarial **PASS** — all r1 findings verified closed + blast-radius audit (no other spec can hit the Router-mock crash); one residual minor (`redirectTo` literal → `AppRoutes.RUN_DASHBOARD`) fixed post-verdict.

## Round 1 — axes

### Standards — PASS

Verified: signals/`toSignal`-as-trigger pattern, OnPush, zero per-page code, `@if` control flow, `flexboxLayout` mixin, literal breakpoints (720px precedent), jest conventions (no `any`, real-Router seam, `jest.fn`), JSDoc + issue-ref comments.

Minors: enum-key fixture paths, `#823`/`#853` comment mismatch, dead `?.` on `routerState.snapshot`, EOF newline, fixture-shape comment, one literal title pin. All remediated below.

### Spec conformance — PASS (1 MEDIUM)

All 6 Impl ACs + test cases 4–10 verified against code. MEDIUM: `<h1>` inside `<nav>` landmark + permanent duplicate-h1s on pages keeping control-bearing headers post-sweep → demoted to `<span>`.

### Adversarial — FAIL → remediated

| # | Sev | Finding | Disposition |
|---|---|---|---|
| 1 | CRITICAL | `core.component.spec.ts` Router mock lacks `events`/`routerState` → `undefined.pipe` TypeError; 7 specs fail | **FIXED** — mock extended (`EMPTY` events + empty `pathFromRoot` stub) |
| 2 | MINOR | `<h1>` in `<nav>` → duplicate/contradictory h1s (header "Log in" vs page "Sign in") | **FIXED** — `<span class="page-title">` |
| 3 | MINOR | `.page-title` ellipsis dead — flex `min-width:auto` blocks shrink; long titles could push auth buttons off narrow screens | **FIXED** — `min-width: 0` + comment |
| 4 | MINOR | Fixture route tree flatter than prod; equivalence rests on `filter(Boolean)` | **FIXED** — `IDENTITY_ROUTES` wrapped in `''` parent mirroring prod shape |
| 5 | INFO | Non-'' ancestor segment would silently blank identity app-wide | Noted — `''` mount is implicit in the route contract; prefix-trim is the documented mechanism |
| 6 | INFO | `firstChild` walk assumes primary outlet | **FIXED** — comment noting the no-aux-outlets assumption |
| 7 | INFO | Verified non-issues: NavigationEnd-vs-snapshot ordering (snapshot commits in activation, before the event), cancelled/skipped navs, param-only changes, redirect leaves, fullscreen unmount/re-mount (`toSignal` teardown + live read on re-eval), injection context, `Object.hasOwn` | No action |

## Round 2 — remediation verification

- `npx jest core.component.spec header.component.spec core-routes.spec` — **99/99 pass** (2026-10-07).
- CRITICAL closed: all 7 `CoreComponent` specs green.
- Also applied: `withDisabledInitialNavigation()` (NG04002 console noise), `Sign up` assertion (case-9 self-containment), literal `'Signal Review'` pin (registry-drift guard).
- Re-review verdicts: Standards PASS (all six minors verified fixed; one new residual — `redirectTo` literal — fixed after verdict), Adversarial PASS (blast-radius audit: only `header.component.spec`/`core.component.spec` mount `rs-header`; aux-outlet, signal/CD, redirect semantics all verified clean). Remaining items are LOW/INFO — recorded below.

## Deferred / noted for later tasks

- **Icon ligature validity** — some registry names (`lab_profile`, `screenshot_monitor`, `receipt_long`, `inventory_2`, `view_kanban`, `query_stats`, `manage_history`, `stacked_line_chart`, `candlestick_chart`) are unverified against the legacy Material Icons font; an invalid name renders raw text. Deferred to the #854 sweep's visual pass, per the test plan's explicit deferral.
- **Stale identity during in-flight navigation** — the previous page's identity persists between `NavigationStart`→`NavigationEnd`. Judged correct (avoids a blank flash); no change.
- **Empty zone unreachable in prod today** — `**` redirects to `/` → portfolio; only future unkeyed routes blank. Defensive behavior is correct as-is.
- **''-mount invariant** — a future non-'' ancestor segment would blank identity app-wide; the resolver's prefix semantics are the documented contract.

## Full-suite flag (pre-existing, unrelated)

`screenshot-capture-contracts.spec.ts` — "PositionType is limited to stock" still fails; stale against #844's `vertical-debit-spread`/`calendar`/`option-single` enum additions. Same failure flagged in the #852 review — belongs to that thread.
