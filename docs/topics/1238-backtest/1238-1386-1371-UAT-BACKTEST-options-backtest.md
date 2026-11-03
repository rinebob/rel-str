**Topic:** Options Backtest  
**Topic Slug:** options-backtest  
**Thread:** Backtest Analytics  
**Thread Slug:** backtest-analytics  
**Issue:** #1386  
**Thread Parent:** #1266  
**Topic Parent:** #1238  
**Task:** #1371  
**Domain:** BACKTEST  
**Type:** UAT  
**Status:** Complete  
**Created:** 2026-11-03  
**Last Updated:** 2026-11-03  

# UAT — #1371 Exit evaluators (pure)

## Scope

`functions/src/options-analysis/exit-evaluators.ts` — `evaluateExit(series,
entryMark, rule, expiration)` pure per-kind exit evaluator: fires
`{fired:true, exitDate, exitPrice, dayIndex, mae, mfe}` or scans to the
last live bar `{fired:false, mae, mfe}`. All 5 registry kinds; inclusive
boundaries; internal post-expiry clip; independent per-rule scans; MAE/MFE
over the entry→exit window.

No UI surface, no callable, no Firestore — acceptance is entirely the
automated spec suite + static checks. The module has no production caller
yet (worker is #1372).

## Prerequisites

- Repo `C:\aa\projects\rel-str`, branch `prod`
- `NODE_OPTIONS=--require C:\Users\bob\.config\node\ipv4-only.cjs` (standard env)

## Scenarios executed

| # | Scenario | Command / check | Expected | Result |
|---|---|---|---|---|
| 1 | Evaluator spec suite — 21 specs: all 5 kinds inclusive boundaries, never-fire cases, non-termination, MAE/MFE window discipline, post-expiry clip, tie-break, EPS guard, same-day exit, empty series | `npm --prefix functions run test:options-analysis` | 34 pass (21 evaluator + 13 start) | **PASS** — 34/34 |
| 2 | Sibling regression — options-replay suite (shares `calendarDaysBetween` import graph, registry seeds) | `npm --prefix functions run test:options-replay` | all pass | **PASS** — 65/65 |
| 3 | Typecheck | `cd functions && npx tsc --noEmit` | clean | **PASS** |
| 4 | Lint touched modules | `npx eslint src/options-analysis/exit-evaluators.ts src/options-analysis/start.ts` | 0 warnings | **PASS** |
| 5 | Functions bundle | `cd functions && npm run build` | esbuild clean | **PASS** — 1.9mb |
| 6 | Boundary inclusivity (AC1) | specs: target-90 `0.2` vs `0.1999…96` threshold fires (EPS path); `0.200001` does NOT; `$1.00`/`$0.50` fire, `$1.01` doesn't; `4.0` stop fires, `3.99` doesn't; remaining-21 fires, remaining-23 doesn't | per assertions | **PASS** — spec-pinned |
| 7 | Post-expiry clip (review-round-1 Major fix) | specs: price-50 with only post-expiry qualifying marks → `fired:false`; dte-21 same; expiry bar itself IS in-window (strict `>`); tail marks excluded from mae AND mfe | per assertions | **PASS** — spec-pinned |
| 8 | Non-termination (AC2) | spec: all 6 seed rules over one series; price-100 fires early, dte-21 still fires, expiry scans full window | per assertions | **PASS** — structural (independent scans) |
| 9 | MAE/MFE window (AC3) | spec: marks beyond exit bar excluded from fired rule, visible to expiry scan; entry mark seeded; first-occurrence ties pinned | per assertions | **PASS** — spec-pinned |

## Traceability

| Task AC | Scenarios |
|---|---|
| Each kind fires correctly at boundaries (inclusive) | 1, 6, 7 |
| Non-termination: early fire doesn't truncate other scans | 1, 8 |
| MAE/MFE entry→exit only | 1, 7, 9 |
| Unit specs per TEST doc | 1 (all TEST-BE evaluator-matrix rows + clip row) |

## Refinement pass

Not applicable — no user-facing surface (pure backend module).

## Regression notes

- Full jest suite last run at review: 287/287 suites, 4,978/4,978 — no
  production-code path depends on this module yet, so blast radius is the
  spec suite itself.
- `pt-date-utils` import is type-safe canonical reuse already in this
  domain's graph; zero bundle impact (module not yet wired to index.ts).

## Verdict: **PASS** — ship-eligible.
