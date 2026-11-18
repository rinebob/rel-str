**Topic:** ST Firestore Reorg  
**Topic Slug:** st-firestore-reorg  
**Thread:** Pass Family Consolidation  
**Thread Slug:** pass-family-consolidation  
**Issue:** #1601  
**Thread Parent:** #987  
**Topic Parent:** #984  
**Task:** #1564  
**Domain:** DATA-PIPELINE  
**Type:** UAT  
**Status:** Complete  
**Created:** 2026-11-18  
**Last Updated:** 2026-11-18  

# UAT — #1564 FE-IMPL: strategy dashboard on getPaperStats + population selector

## Scope

The options strategy dashboard's stats card + equity curve read the
canonical `getPaperStats` callable instead of the deleted
`getStrategyEquityCurve`, with a two-select scope UX: a new **Population**
select (All / Strategies / Signals) plus the existing instance select,
enabled only under Strategies. Acceptance criteria covered:

- `getPaperStats$` wrapper in `PaperTradingService` via `GET_PAPER_STATS`
- `selectedPopulation` (default `'STRATEGY'`) + derived scope
  (`inst-{id}` / `all` / `src-STRATEGY` / `src-SIGNAL`)
- Stats card + curve bound to `response.stats[0]` — no shape adapter
- Population select in header; instance select disabled + retained under
  non-Strategies
- `getStrategyEquityCurve$` + `GET_STRATEGY_EQUITY_CURVE` + legacy types
  deleted
- `stats: []` → empty state without error
- Position tables unchanged (strategy-only)

## Prerequisites

- Dev server already running at `http://localhost:4200` (`ng serve`,
  watch mode — the build includes this task's changes)
- Signed-in user with access to the deployed `getPaperStats` callable
- Prod stats docs verified present (probed 2026-11-18 via ADC):

  | Scope doc | openTradeCount | closedTradeCount | equityCurve pts |
  |-----------|---------------:|-----------------:|----------------:|
  | `stats-all` | 168 | 235 | 26 |
  | `stats-src-STRATEGY` | 60 | 0 | 3 |
  | `stats-src-SIGNAL` | 110 | 228 | 3 |
  | `stats-src-MANUAL` | — absent — | | |

- Note: `getPaperStats` must be deployed to prod functions (exported
  from `functions/src/index.ts`). If scenario S1 shows an error banner,
  run `firebase deploy --only functions` — that is a deploy gap, not a
  code bug.

## Getting to the feature

1. Open `http://localhost:4200/options-strategy-dashboard` directly.
   Or: app nav → **Options Strategy Dashboard**.
2. You land on the dashboard: stat strip (Open / Closed / Max DD) top
   left; **Population** + **Strategy** selects top right; positions
   tables left; equity curve right.

## Automated evidence

- Store spec (`options-strategy-dashboard.store.spec.ts`) — scope
  derivation pinned for all four scope forms; `stats[0]` binding; empty
  `stats: []`; superseded in-flight request can't overwrite newer state.
- Service spec (`paper-trading.service.spec.ts`) — `getPaperStats$`
  sends `{scope}` to `CallableName.GET_PAPER_STATS`.
- Component spec — population select fires `selectPopulation`; instance
  select disabled iff population ≠ STRATEGY.
- Full suite: **5918/5918 green**; `tsc` clean.
- Code review: `984-1561-1564-CODE-REVIEW-DATA-PIPELINE-st-firestore-reorg.md` — PASS.

## Scenarios

### S1 — Default load (Strategies population)

**Confirms:** default `selectedPopulation = 'STRATEGY'` → `src-STRATEGY`
scope; stats card + curve from `stats[0]`.
**Steps:** Open the route. Wait for load.
**Expected:** Population select shows **Strategies**. Stat strip reads
the `stats-src-STRATEGY` doc — at time of writing **Open = 60,
Closed = 0**; Max DD from doc. Equity curve renders (doc has 3 points).
Strategy select enabled. Position tables show strategy positions.
**Result:** PASS — user click-through 2026-11-18.
### S2 — Population → Signals

**Confirms:** `src-SIGNAL` scope + instance select disabled.
**Steps:** Population select → **Signals**.
**Expected:** Stat strip switches to `stats-src-SIGNAL` values — at time
of writing **Open = 110, Closed = 228**; curve re-renders (3 points).
Strategy select is **disabled** but still shows the previously selected
instance (selection retained). No error banner.
**Result:** PASS — Open ≈110 / Closed ≈228; Strategy select disabled, value retained. User click-through 2026-11-18.
### S3 — Population → All

**Confirms:** `all` scope.
**Steps:** Population select → **All**.
**Expected:** Stat strip switches to `stats-all` — **Open = 168,
Closed = 235**; curve re-renders (26 points). Strategy select still
disabled.
**Result:** PASS — Open ≈168 / Closed ≈235; curve noticeably longer (~26 pts). User click-through 2026-11-18.
### S4 — Instance scope under Strategies

**Confirms:** `inst-{id}` scope derivation; instance select re-enabled.
**Steps:** Population → **Strategies** (select re-enables). Pick
`260819-QQQM-CSP-020-30-D` (or the first listed option) from the
**Strategy** select.

**Instance options verified in prod:** the select is **position-derived**
— options are the unique `strategyInstanceId` values on loaded strategy
trades, NOT `st-strategy-instances` docs. The four values present:
`260819-QQQM-CSP-020-30-D`, `260819-QQQM-CSP-030-30-D`,
`260819-SCHB-CSP-020-30-D`, `260819-SCHB-CSP-030-45-D`; canonical
`stats-inst-{id}` docs exist for all four. Instances created via the
Manage-page Create New Instance dialog (`QQQ-CDS-30-50-40-ALL` style)
will NOT appear — they have no positions; recorded under Findings.

**Expected:** Stats card + curve request `inst-260819-QQQM-CSP-020-30-D`
scope — counts narrow to that instance's subset (or 0s if the doc were
absent — designed empty state, not an error). Position tables filter to
the chosen instance.
**Result:** PASS — `260819-QQQM-CSP-020-30-D` selected: Open ≈16 / Closed ≈0, ~18-pt curve, tables filtered to that instance. All four prod instance ids present in the select. User click-through 2026-11-18.
### S5 — Empty scope doc (pre-nightly state)

**Confirms:** `stats: []` → empty state, no error.
**Steps:** Any scope whose doc doesn't exist — e.g. a freshly minted
instance with no trades, or verify via devtools that a `stats: []`
response leaves stats null. (No MANUAL option exists, so
`stats-src-MANUAL` can't be reached via the UI.)
**Expected:** Stat cards show 0, curve panel shows "No equity curve
data yet." — **no error banner**.
**Result:** N/A — not reachable via UI (no MANUAL option; all four `inst-*` docs exist). Empty-state behavior is spec-pinned (`stats: []` → null stats, zero cards, "No equity curve data yet", no error).
### S6 — Retained instance across population switches

**Confirms:** selection retained; scope ignores it under non-STRATEGY.
**Steps:** Under Strategies, pick `260819-QQQM-CSP-020-30-D` →
Population → Signals → back to Strategies.
**Expected:** Instance select re-enables **with the same instance still
selected**; stats return to `inst-260819-QQQM-CSP-020-30-D` scope.
Position tables kept the instance filter throughout (strategy-only by
design).
**Result:** PASS — instance retained across Signals→Strategies; select re-enabled with `260819-QQQM-CSP-020-30-D` still selected, stats returned to 16/0. User click-through 2026-11-18.
## Manual UI/UX refinement pass

- [x] Population + Strategy selects sit cleanly in `header-actions`
  alongside the Manage Strategies button at desktop width
- [x] Disabled Strategy select visibly reads as disabled
  (greyed/cursor) while retaining the selected value
- [x] Loading spinner / error banner / empty states behave on scope
  switches

## Findings

- **Gap (not a #1564 defect, likely rework scope):** the Strategy select
  derives its options from loaded positions' `instanceId`
  (`availableInstances` = unique `strategyInstanceId` on open/closed
  position rows) — it does NOT read `st-strategy-instances`. Instances
  created via the Manage-page Create New Instance dialog
  (`QQQ-CDS-30-50-40-ALL` style) are unpickable here until they produce
  positions, and their id space is disjoint from the engine-era
  `260819-*` ids that have trades + `inst-*` stats docs today.
  Raised by user during QA (2026-11-18): "I can't pick an instance in
  the dashboard or the new instance dialog."
- If the position tables are populated but the select shows only
  "All Strategies (Combined)", that would be a real defect — pending
  user confirmation.

## Traceability

| Acceptance criterion | Scenario |
|---|---|
| `getPaperStats$` via `GET_PAPER_STATS` | S1 (live call succeeds) |
| `selectedPopulation` default STRATEGY + derived scope | S1–S4 |
| Stats card + curve from `stats[0]`, renames applied | S1–S3 (counts match prod docs) |
| Population select; instance disabled + retained | S2, S3, S6 |
| `getStrategyEquityCurve$` + constant deleted | spec pin + no error on load (S1) |
| Specs updated; `stats: []` → empty state | S4/S5 |
| Position tables unchanged | S1, S4, S6 |

## Regression / smoke

- [x] Position tables still load open/closed rows (S1)
- [x] Equity curve chart still renders + sorts points
- [x] Manage Strategies link still routes to `/options/strategy/manage`
- [x] Error banner on failed callable (can simulate by going offline)

## Verdict

**PASS** — user click-through 2026-11-18: S1–S4 and S6 confirmed
against the prod values above; S5 not reachable via UI (spec-pinned).
Implementation was additionally spec-verified (46 dashboard specs) and
prod stats docs were confirmed present before the pass. The one finding
(instance select is position-derived, not registry-derived) is recorded
above and is deferred to the planned dashboard rework — it does not
block this task's acceptance criteria.

## Results log

- 2026-11-18 — User click-through: ALL UAT PASS. S1 (60/0), S2 (110/228,
  disabled+retained select), S3 (168/235, ~26-pt curve), S4
  (`inst-260819-QQQM-CSP-020-30-D` → 16/0, ~18-pt curve, filtered
  tables), S6 (retained selection). Finding: instance select is
  position-derived — dialog-created instances unpickable until they
  have positions (rework scope).
- 2026-11-18 — Prod probe (ADC): `stats-all` open=168/closed=235/curve=26;
  `stats-src-STRATEGY` 60/0/3; `stats-src-SIGNAL` 110/228/3;
  `stats-src-MANUAL` absent; `stats-inst-260819-*` all present (open=16 closed=0 curve=18). Full suite 5918/5918.
- 2026-11-18 — User smoke: page loads fine, no errors.
