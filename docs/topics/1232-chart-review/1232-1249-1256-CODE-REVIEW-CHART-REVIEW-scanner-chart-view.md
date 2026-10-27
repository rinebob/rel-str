**Topic:** Scanner Chart View  
**Topic Slug:** scanner-chart-view  
**Thread:** Chart View Extension  
**Thread Slug:** chart-view-extension  
**Issue:** #1249  
**Thread Parent:** #1233  
**Topic Parent:** #1232  
**Task:** #1256  
**Domain:** CHART-REVIEW  
**Type:** CODE-REVIEW  
**Status:** Complete  
**Created:** 2026-10-26  
**Last Updated:** 2026-10-26  

# Code Review: FE-IMPL — ChartView page + merged toolbar + route/nav

Pre-commit gate for Task #1256 (Phase 1 / F2 of the FE Blueprint). Three
axes ran in parallel (Standards, Spec, Thermo-nuclear/Dr. Reed), followed by
a full-suite test run. The first pass found four majors; all were
remediated in-flight and both axes re-verified the final state before this
verdict.

## Scope reviewed

- New: `pages/chart-view/` (component, html, scss, spec),
  `components/chart-view-toolbar/` (component, html, scss, spec),
  `services/chart-view-viewport.service.ts` (+ spec).
- Modified: `common/constants.ts` (`scan:` source helpers),
  `rh-select-menu` (`disabled` input), `signal-list` (`dimmedSymbols` +
  `.viewed`), `indicator-menu` scss (flex-shrink label fix),
  `core-routes.ts`, `interfaces.ts` (`AppRoutes.CHART_VIEW` + PAGE_INFO),
  `common/constants.ts` nav entry rename, route/nav specs,
  `symbol-list.service.spec.ts` (`:`-collision pin), `AGENTS.md`
  (jest.mock + signal-mock pitfall).

## Round 1 findings → remediation

| Severity | Finding | Disposition |
|---|---|---|
| major | `select()` didn't clear `manualSymbol` — prev/next/advanceQueue/auto-select left a stale manual value; pane flips to history mode and the stale symbol resurrects via `activeSymbol` fallback | Fixed — `select()` is now the single funnel that clears manual; `onSymbolSelected` delegates; new spec pins the manual→next→list-head transition |
| major | Filing spec mutated the catalog synchronously inside the `toggleSymbolInList` mock — impossible world (store has no optimistic update); `advanceQueue` saw `idx=-1` → `select(undefined)`, expected value arrived via effect rescue | Fixed — spec asserts the pre-echo advance on the unchanged viewport, then mutates to simulate the echo; `advanceQueue` gained an `idx === -1` guard for the real stale-selection case |
| major | `Collection.ST_SYMBOLS` read (deprecated) contradicted its own comment ("st-symbols doc") | Accepted deviation — comment now names the real `savant-trader/data/symbols` path and cites #1019; spec pins the `doc()` path contract. Root switch deferred: `name` on merged `st-symbols` docs is unverified, and #1019 owns the cutover |
| major | ~120 lines ported verbatim from chart-review | Accepted — docstring now documents bounded duplication pending chart-review's deletion in #1260 ("if #1260 slips and a third surface needs this, extract then") |
| minor | `symbolKeydown` output leaked DOM objects across the boundary | Fixed — `(keydown.enter)="loadSymbol.emit(symbolInput.value)"`; page handler deleted |
| minor | `getDoc` name lookup had no rejection path | Fixed — `.catch` caches null |
| minor | Provider test asserted nothing about `ChartToolbarStateService` | Fixed — asserts `TestBed.inject` throws (not root-provided) + toolbar/detail child injectors share one instance |
| minor | Dead `signal-detail` bindings (nav inputs/outputs feeding the hidden inner toolbar) | Fixed — removed; `[listCatalog]` stays (required input), commented |
| minor | Toolbar spec missing range/zoom/log/layout/fullscreen mutation coverage (TEST-F2) | Fixed — added mutation assertions + Enter-key load test |
| nit | `:`-collision convention (`scan:` prefix) unasserted (TEST line 47) | Fixed — `createList('scan:quality-large')` → `scan-quality-large` pinned in `symbol-list.service.spec.ts` |

## Round 2 — fresh-eyes re-review of the remediated state

A second full pass (all three axes, new agents, no shared context) ran
against the post-remediation code. It produced **one new major** —
introduced by the round-1 CSS remediation — plus minors/nits:

| Severity | Finding | Disposition |
|---|---|---|
| major | `.symbol-block` flex-shrink contradiction: the `> *` guard exempted it as "the only shrinkable item" but the block declared `flex-shrink: 0` on itself — dead exemption, nothing could shrink, narrow viewports clipped the DOM-last controls (symbol input + Load) | Fixed — `.symbol-block` now `flex-shrink: 1` + `min-width: 0`; verified degradation order (company-name ellipsizes first, ticker can't truncate) |
| minor | `advanceQueue` empty-remaining branch described intent it can't deliver — the auto-select effect transiently re-selects the filed symbol against the stale pre-echo viewport | Documented honestly — comment now describes the transient re-select and the settled detached-chart state (chart-review parity) |
| nit | No regression test for the `idx === -1` guard added in round 1 (§10: bug fixes need coverage) | Fixed — spec drives the guard via a pre-shrunk viewport and asserts no `undefined` enters `viewedSymbols` |
| nit | `EMPTY_SET` comment claimed "frozen" (Sets can't be frozen) | Reworded |
| nit | Symbol input retained stale text after Load/Enter | Fixed — field clears after emit |

Delta verification (thermo-nuclear axis re-walked the changed regions):
all resolved, no new issues.

## Standing items (documented, non-blocking)

- `scanSourceRecipeId` has no production caller until #1258 — deliberate
  staging, spec-covered.
- Inert placeholders (disabled scan menu, New-only pill, Add stub) are
  spec'd Phase-1 behavior, ticketed to #1258/SA.
- `orderCount` duplicates `SignalReviewFacade.orderCount` (5 lines) — the
  facade survives retirement; lifting onto `OrderTicketStore` is a
  candidate refactor, not required here.
- Nav entry lives under "Signals" but routes to `trading/chart-view` —
  rename-in-place is what the IMPL plan prescribes.
- `isTrackedSymbol` is O(n) `.includes` — fine at tracked-universe scale.

## Test results

- Targeted: chart-view page (13), chart-view-toolbar (12), viewport
  service (8), signal-list, rh-select-menu, core-routes, nav-sections,
  symbol-list.service — all green.
- Full suite: 268 suites / 4,608 tests, 0 failures.
- Both tsconfigs clean (app + spec).
- Manual UI check on `/trading/chart-view` confirmed by user
  (toolbar layout verified; indicator-label containment fixed and
  confirmed).

## Verdict

**PASS** — all acceptance criteria met (Spec axis: 8/8 MET across both
rounds, deferrals correctly mapped to #1257/#1258/#1259/#1260); all
critical/major findings across two fresh-eyes passes remediated and
re-verified; full suite green.

Round 3 was consciously skipped: round 2's yield was one self-introduced
CSS contradiction and one semantics nit — the delta surface is now small,
verified, and the remaining risk (narrow-viewport toolbar rendering) is a
visual check owned by `/proj qa`, not another agent pass.

Next: `/proj qa 1232 1256`.
