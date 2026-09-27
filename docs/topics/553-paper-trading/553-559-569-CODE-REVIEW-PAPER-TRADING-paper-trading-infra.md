**Topic:** Paper Trading Infra
**Topic Slug:** paper-trading-infra
**Thread:** Core Infra
**Thread Slug:** core-infra
**Issue:** #559
**Task:** #569
**Topic Parent:** #553
**Domain:** PAPER-TRADING
**Type:** CODE-REVIEW
**Status:** Final
**Created:** 2026-09-27
**Last Updated:** 2026-09-27

# Code Review — #569 Paper trading dashboard

**Verdict: PASS** (3 axes × 2 rounds; round 2 CONFIRMED CLEAN)

## Summary

New `paper-trading` route + `PaperTradingComponent` — the generalization
of the options dashboard onto the paper ledger. Account header (cash /
equity / realized / unrealized / capital-required / open, negative
values in red), group-by repivots (all/instance/cohort/variant/
expression/symbol), cohort drill-down with per-expression trades and
variant-run outcomes (governing badge + shadow exit date/price/P&L), and
a per-scope Syncfusion equity curve over `statsByScope`.

## Spec compliance — all criteria met

- Renders via `listPaperTrades`/`getPaperStats`/`getPaperAccount`
  (`store.loadAll()` on init).
- Group-by repivots the table; the scope-jump button couples a group to
  the equity curve (`inst-`/`cohort-`/`var-`/`sym-` scope keys).
- Cohort view → expression groups + legs + last mark + variant outcomes.
- Negative cash visible (`.negative` class, spec-covered).
- Specs cover grouping, cohort view, empty state, error path.

## Round 1 — findings → resolution

- **[HIGH] `Object.entries` over a `Map`** — `tradesBy*` computeds return
  `Map`s; the component iterated `Object.entries`, yielding empty groups
  in production while plain-object spec mocks passed green. →
  `[...map.entries()]` + real-Map spec mocks.
- **[MED] `capitalRequired` summed closed trades** — margin is released
  on close → filtered to OPEN/PENDING; spec added.
- **[MED] open-count inconsistency** — header (`store.openTrades`, OPEN
  only) vs group line (OPEN+PENDING). → `openCount` = OPEN; PENDING
  rendered separately.
- **[LOW] curve not coupled to group-by** (AC ambiguity) — scope-jump
  button per group sets the stats scope via `@paper-trading/ids`
  helpers (same keys the nightly stats pass writes).
- **[LOW] stale `statsScope`** → `effectiveScope` falls back to `all`.
- **[LOW] IMPL "legs + marks" gap** → drill-down now renders a legs
  summary + last mark per trade.
- **[LOW] duplicated loads / hardcoded route literal** → `store.loadAll()`
  + `appRoutes.PAPER_TRADING`.

## Round 2 — CONFIRMED CLEAN

All remediations verified in code; `'none'` scope-jump edge closed
(button hidden). Remaining nits are non-blocking.

## Test results

- Dashboard spec: **14/14** (real-Map mocks, Syncfusion stubbed via
  `overrideComponent`).
- Full Jest **2042/2042** (149 suites); `ng build` clean, zero warnings.
- `order.component.spec` needed `provideRouter([])` + a real `Router`
  (spy on `navigate`) after the header gained a `routerLink`.

## Notes

- `loadExitVariants` not invoked here — that surface is for the
  strategy-builder task (#568).
- Multi-key variant grouping intentionally shows a trade under every
  variant it runs (per-group totals overlap by design; no grand total).
- BE-side pagination per grouping deferred — client-side regroup is fine
  at current ledger scale; stats docs carry the heavy aggregates.
