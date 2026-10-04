**Topic:** Portfolio Allocation  
**Topic Slug:** `portfolio-allocation`  
**Thread:** Portfolio Visual Consistency  
**Thread Slug:** `visual-consistency`  
**Issue:** #782  
**Thread Parent:** #751  
**Topic Parent:** #576  
**Task:** #776  
**Domain:** PORTFOLIO  
**Type:** UAT  
**Status:** Complete  
**Created:** 2026-10-03  
**Last Updated:** 2026-10-03  

---

## Scope

Task #776 delivers `src/app/features/portfolio-dashboard/styles/_pd-visual-language.scss` — the feature-scoped shared SCSS partial holding the common visual blocks for the Thread #751 migration. It renders nothing on its own; downstream tasks #777–#781 consume it. Acceptance is structural: the file exists, exports the contracted mixin surface, compiles, uses token colors, and stays feature-internal.

## Prerequisites

- Repo checkout with `node_modules` installed (`sass` bundled via Angular build).
- No dev server, accounts, or credentials needed.

## Scenarios

| # | Scenario | Steps | Expected | Result |
|---|----------|-------|----------|--------|
| 1 | File exists at contracted path | `ls src/app/features/portfolio-dashboard/styles/_pd-visual-language.scss` | File present | PASS |
| 2 | Mixin surface complete | Read file; confirm exports | `page-shell`, `content-column`, `header-bar`, `dense-table`, `state-block`, `error-banner` mixins + `$up`, `$down` vars | PASS |
| 3 | Compiles under `@use` | Create a scratch `.scss` that `@use`s the partial and includes every mixin + both vars; run `npx sass scratch.scss out.css` | Compiles with no errors, emits CSS | PASS — 152 lines emitted |
| 4 | Token-only colors | `grep -nE "rgba\(|#[0-9a-fA-F]{3,6}"` the file | Only `$up: #4caf50` / `$down: #f44336` literals; no `rgba()`, no grey hexes | PASS |
| 5 | Feature-internal boundary | `grep -rn "pd-visual-language" src/app --include="*.scss" -l` | Only files under `features/portfolio-dashboard/` | PASS — only the partial itself |

## Traceability

| AC | Scenario |
|---|---|
| `page-shell`/`content-column`/`header-bar`/`dense-table`/`state-block`/`error-banner` mixins | 2, 3 |
| P&L accent tokens in the partial | 2, 3 |
| All `--mat-sys-*` colors, no rgba/hex greys | 4 |
| Feature-internal only | 5 |

## Regression / smoke

- `npx jest --runInBand src/app/features/portfolio-dashboard` → 22 suites / 344 tests PASS (file unconsumed; zero regression surface).

## Refinement pass

Not applicable — no user-facing surface.
