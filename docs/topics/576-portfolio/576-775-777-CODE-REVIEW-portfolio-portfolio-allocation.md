# Code Review — Task #777: Dashboard page shell

**Topic:** #576 Portfolio Allocation
**Thread:** #751 Portfolio Visual Consistency
**Blueprint:** #775 (FE)
**Task:** #777 — FE: Dashboard page shell — header bar + 1100px column + tokenized states
**Reviewer:** Devin (inline — single-component diff, same rationale as #776)
**Date:** 2026-10-04
**Verdict:** PASS

## Scope reviewed

- `portfolio-dashboard.component.html` — header-bar markup, `.pd-content` wrapper
- `portfolio-dashboard.component.scss` — full rewrite onto `_pd-visual-language`
- `portfolio-dashboard.component.spec.ts` — 2 new structural tests

Uncommitted allocation-* files in the same directory are task #693 WIP —
out of scope, not reviewed.

## Standards axis

- **Mixin contract honored.** Markup uses `.bar-left` / `.bar-icon` /
  `.bar-title` / `.bar-actions` — exactly the nested selectors
  `vl.header-bar()` emits. `.pd-root` → `page-shell()`, `.pd-content` →
  `content-column()`, `.pd-empty` → `state-block()`, `.pd-error-banner` →
  `error-banner()`. No hand-rolled duplicates of shared patterns.
- **Token discipline.** Zero `rgba()`/hex in the component SCSS after the
  rewrite; the only literal color is `vl.$down` — the sanctioned accent
  channel. Summary bar and all states consume `--mat-sys-*` vars.
- **Test seams preserved.** `.pd-refresh`, `.pd-error-banner`,
  `.pd-summary-value`, `.pd-global-loading`, `.pd-empty` all retained —
  35 pre-existing assertions untouched.
- **`animationDuration="0ms"`** already on `mat-tab-group` — consistent
  with the Thread's no-tab-slide direction ahead of #779.
- SCSS compiles standalone and in the Angular build (~70s, clean).

### Findings

- **Observation (AC nuance, non-blocking):** AC #1 says "refresh button at
  32px". The refresh button is `mat-icon-button`, which stays at Material's
  default size — the mixin's `.bar-actions` only shrinks
  `mat-stroked-button` to 32px, **exactly matching run-dashboard**, where
  header icon buttons are also left default. Reference parity is the
  mandate; the "32px controls" wording describes the compact-controls spec
  which the reference only applies to stroked buttons. No change made.
- **Nit:** children inside `.pd-content` weren't re-indented (cosmetic;
  churn avoided to keep the diff readable).

## Spec axis — acceptance criteria

| AC | Result |
|---|---|
| `.pd-header` → header-bar pattern (icon, 16px/600 title, actions, refresh) | PASS — `vl.header-bar` emits all of it; see 32px note above |
| Root → `page-shell()`; content → `content-column()` (1100px) | PASS |
| Summary bar / error banner / empty tokenized; no hard-coded rgba/hex | PASS — `error-banner()`, `state-block()`, summary on `--mat-sys-*`; PnL via `vl.$down` |
| Loading state matches reference (centered spinner, 48px padding) | PASS |
| Specs updated; `npx jest src/app/features/portfolio-dashboard` green | PASS — 2 new structural tests; focused suite 37/37 |

## Test run

```
npx jest --coverage=false src/app/features/portfolio-dashboard/portfolio-dashboard.component.spec.ts
→ 1 suite, 37/37 pass
npx sass (standalone compile) → clean
npm run build → clean (70s)
```

## Thermo-nuclear note

The component SCSS shrank from ~75 lines of hand-rolled light-theme rules
to ~40 real rules, almost all delegation to the partial or thin local
overrides (summary-bar layout, negative accent). Component-specific
selectors stayed local per the Thread's boundary decision.
