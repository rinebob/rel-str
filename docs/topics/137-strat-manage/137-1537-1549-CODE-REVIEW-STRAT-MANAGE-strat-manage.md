# Code Review — #1549 FE: Results summary popup + analysis link

**Topic:** Strategy Builder UI  
**Topic Slug:** strat-manage  
**Thread:** OpsStrat Manage Page Overhaul  
**Thread Slug:** strat-manage-page-overhaul  
**Issue:** #1537  
**Thread Parent:** #1510  
**Topic Parent:** #137  
**Task:** #1549  
**Domain:** FE  
**Type:** CODE-REVIEW  
**Status:** Complete  
**Created:** 2026-11-22  
**Last Updated:** 2026-11-22  

## Summary

Three parallel axes over the #1549 diff: a new
`manage-results-dialog.component.{ts,scss,spec.ts}` (per-instance stats
block, open-position summary, SVG equity sparkline, analysis action) plus
Results-button wiring in `strategy-manage.component.{ts,html,spec.ts}`.

- **Standards** — ds-dialog conventions, callable request shapes,
  `PaperStats.equityCurve` contract, `takeUntilDestroyed()` constructor
  precedent: all verified. 1 major + 6 minors found; majors and the
  in-scope minors remediated in-gate.
- **Spec** — all three acceptance criteria MET. The plan's
  `getStrategyEquityCurve` reference is stale (callable retired by
  #1564/#1565); the `getPaperStats({scope:'inst-{id}'})` substitution was
  verified end-to-end — the per-instance stats doc carries `equityCurve`,
  and `inst-{instanceId}` is the canonical scope
  (`statsScopeInstance` in `@paper-trading/ids`). Analysis route verified
  semantically: the BE writes contract-list docs at
  `st-options-contract-lists/{instanceId}` and analysis-result docs keyed
  by `contractListDocId = instance.id`, so the link resolves per-instance.
- **Thermo-nuclear** — subscription lifecycle, races, null hazards,
  sparkline math, `window.open` injection (id grammar is `[A-Z0-9.-]`;
  path-prefixed, no scheme injection). 1 major (loading-state flash) +
  6 minors + 3 nits; remediated as below.

## Findings and dispositions

### Major — remediated in-gate

- **M1 — `fmt()` crash on increment-minted stats docs.** `inst-*` scopes
  are minted by blind `FieldValue.increment` merge-sets and carry no
  `totalUnrealizedPnl`/`maxDrawdown`/`equityCurve` until the nightly
  recompute (`stats-increments.ts:17-21`). `fmt(undefined)` →
  `undefined.toFixed is not a function` during change detection.
  Fixed: `fmt` widened to `number | undefined` → `Number.isFinite`
  guard returning `'—'`; count cells use `?? '—'`; new spec mounts the
  increment-minted doc shape.
- **M2 — False-empty flash while callables in flight.** `stats()===null`
  and `positions()===[]` collided with the empty-state conditions, so
  "No results yet" / "No open positions" rendered for the full round-trip
  — a false negative. Fixed: `statsLoaded`/`positionsLoaded` signals set
  on next AND error; explicit `stats-loading`/`positions-loading`
  branches ahead of the empty states; pending-observable (`NEVER`) spec.

### Minor — remediated in-gate

- Hardcoded `inst-${id}` → `statsScopeInstance(id)` from
  `@paper-trading/ids` (canonical builder; same class flagged in a prior
  review of the dashboard store).
- Hardcoded analysis route literal →
  `AppRoutes.STRATEGY_BACKTEST_ANALYSIS.replace(':listDocId', …)` +
  `encodeURIComponent` (sibling precedent in
  `options-replay-run-list.component.ts`).
- Type-erased `as PaperStats` fixture → complete literal (the remaining
  cast in the new increment-doc spec is intentional — it expresses the
  partial-doc shape under test).
- US-6 spec gap — added `totalPremiumCollected` stat and position
  status + leg count to the position rows.
- Non-finite `cumulativePnl` points filtered before sparkline mapping;
  1px inset so a flat curve doesn't sit on the viewBox border.
- `data.instance?.id` guards in constructor and `openAnalysis`.
- `@task #1549` page-header line; per-instance `aria-label` on the
  Results button.

### Flagged — deferred / not #1549 scope

- **`SCOPE_RE` dot gap (pre-existing BE):** `getPaperStats` validates
  scope against `/^[a-zA-Z0-9-]{1,128}$/` — no dots — so a
  `BRK.B`-class symbol's `inst-{id}` scope is rejected and the dialog
  shows "Failed to load results" for stats (positions still load).
  The constraint predates this task; this is its first manage-id
  consumer. Tracked for the BE blueprint owner; not fixed here.
- **Real-mode rows keep an enabled Results button** — start/stop is
  disabled but Results is not; both data sources are paper-only so the
  dialog honestly shows the empty states. Consistent with the AC;
  flag for UAT disposition.
- Service-level synchronous-throw nit (`paper-trading.service.ts` eager
  `httpsCallable` evaluation) — out of scope.

## Test results

- Focused: 132/132 strategy-manage specs green (11 new dialog specs +
  6 added edge-state specs + 1 page wiring spec).
- Full suite: 6,183/6,183 green.
- `tsc -p tsconfig.app.json --noEmit`: clean.

## Pass log

- First pass — 3 axes: 2 majors (fmt crash, loading flash), ~12 minors.
  Majors and in-scope minors remediated in-gate; flagged items deferred
  with rationale.
- Second pass — serial coverage check over the remediation diff: every
  axis finding accounted for, all error paths re-examined, new specs
  cover the remediated edges. No new findings.

## Verdict

**PASS** — all majors/minors in scope remediated and verified; deferred
items are pre-existing or out-of-scope with owner-visible rationale.
