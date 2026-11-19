**Topic:** Scanner Chart View  
**Topic Slug:** scanner-chart-view  
**Thread:** Bar-Count Range Pills  
**Thread Slug:** bar-count-range-pills  
**Issue:** #1617  
**Thread Parent:** #1616  
**Topic Parent:** #1232  
**Domain:** CHART-REVIEW  
**Type:** PRD  
**Status:** Approved  
**Created:** 2026-11-18  
**Last Updated:** 2026-11-18  

# PRD: Bar-Count Range Pills — Per-Chart Visible Window Control

## Problem Statement

The Chart View page's range pills (`Recent | 6M | 1Y | 5Y | All`) are calendar-based presets, and one shared selection drives every chart at once. Two problems follow:

- **The starting window is too wide.** Every chart opens on 'Recent' — 365 bars on daily — so the trader's first move on every symbol review is zooming or switching range. The page's job is evaluating setups, and a year of daily bars is the wrong opening frame for it.
- **One selection can't serve three charts.** In the triple (D/W/M) layout a trader who wants a tight daily window must also squeeze the weekly and monthly panes, because `selectedRange` is a single shared value. There is no way to say "show the last N bars" directly — the mental unit of chart review is bars, not calendar months.

## Solution

- **Bar-count pills** — `25`, `50`, `100` join the range group ahead of the calendar presets: `25 | 50 | 100 | 6M | 1Y | 5Y | All`. Selecting one sets the chart's visible window to that many bars of the chart's own interval.
- **`Recent` retires** — its per-interval well-known counts (365d / 104w / 60m) are covered by the new bar pills and the remaining presets.
- **Per-chart selection** — a range choice applies only to the *active* chart: the selected D/W/M interval in single-chart mode, the last-clicked cell in the triple layout (the existing `.active-chart` mechanism). Each chart remembers its own selection; the pill group's highlight follows the active chart — click a cell on 5Y and `5Y` highlights.
- **New defaults** — 50 bars on every chart on every page visit. *(Owner revised D/W 100 → 50 during #1623 UI verification.)*

## System Context

```mermaid
flowchart LR
    subgraph Toolbar["Merged toolbar (chart-view-toolbar)"]
        PILLS["Range pills<br/>25 50 100 6M 1Y 5Y All"]
    end
    CELL["Triple cell click<br/>(setActiveChart)"] --> ACT["activeChartInterval<br/>single mode: selectedInterval"]
    PILLS -->|setRange(range)| STATE["ChartToolbarStateService<br/>range selection PER CHART"]
    ACT -->|targets| STATE
    STATE --> RBF["signal-detail rangeBarsFor<br/>(interval, that chart's range)"]
    RBF -->|visibleBars| DFC["Daily Flex Chart"]
    RBF -->|visibleBars| WFC["Weekly Flex Chart"]
    RBF -->|visibleBars| MFC["Monthly Flex Chart"]
```

## User Stories

### US-1 — Bar-count range pills

As a trader, I want 25/50/100 bar pills in the range group, so that I can size a chart's window in the unit I actually think in — bars.

*Acceptance criteria:*

- The range pill group renders `25 | 50 | 100 | 6M | 1Y | 5Y | All`; `Recent` no longer appears.
- Selecting `100` on the daily chart renders the last 100 daily bars; `25` renders 25; same for any interval the active chart renders (bar counts are interval-agnostic — 100 weekly ≈ 2 years).

### US-2 — Per-chart range state

As a trader reviewing D/W/M side by side, I want each chart to keep its own range, so that a tight daily window doesn't squeeze the weekly and monthly context panes.

*Acceptance criteria:*

- In triple layout, setting daily to `100`, then activating the weekly cell and selecting `5Y`, leaves daily at 100 bars while weekly shows 5 years.
- The three charts may display three different ranges simultaneously.

### US-3 — Active-chart targeting

As a trader, I want the pills to act on the chart I've marked active, so that there is never ambiguity about which chart a range applies to.

*Acceptance criteria:*

- In triple layout, clicking a chart cell marks it active (existing `.active-chart` styling) and the pill group's highlight updates to show that chart's current range.
- In single-chart mode the active chart is the selected D/W/M interval; switching intervals shows that interval's own range selection on the pills.

### US-4 — Tighter defaults

As a trader, I want the charts to open on compact windows — 50 bars on every chart — so that a review starts zoomed-in instead of a year wide.

*Acceptance criteria:*

- On every page visit the charts open at their defaults (50 bars on every chart); no chart opens on 'recent' — the value no longer exists.
- The `50` pill is highlighted for whichever chart is active, matching each chart's rendered window.

### US-5 — Selection lifecycle

As a trader stepping through a scan list, I want my range choices to survive symbol changes but reset on my next visit, so that review flow stays consistent within a session without stale state across sessions.

*Acceptance criteria:*

- Changing the selected symbol does not reset any chart's range.
- Navigating away and returning (or reloading) restores the defaults — state remains page-scoped, as today.

### US-6 — Short histories

As a trader charting a recent IPO or thin history, I want a bar count larger than the available data to render gracefully, so that nothing errors on short series.

*Acceptance criteria:*

- A symbol with 30 daily bars on a `100` selection renders all 30 — no empty chart, no error state.

### US-7 — Toolbar parity

As a maintainer, I want the hidden inner toolbar (`chart-toolbar` inside `signal-detail`, currently disabled) to carry the same pill set, so that re-enabling it can't surface a stale or inconsistent range group fed values it can't highlight.

*Acceptance criteria:*

- Both toolbar templates render the identical pill set and route through the same shared state.

## Implementation Decisions

### State model

- `ChartRange` (the shared union in `flex-chart.types.ts`) gains bar-count members (`'25' | '50' | '100'` — token form is an implementation detail) and loses `'recent'`.
- `ChartToolbarStateService.selectedRange` (one shared signal) becomes a **per-chart selection map** keyed by chart interval — the same pattern the service already uses for `selectedIdsByInterval`. `setRange` writes to the *active* chart: `selectedInterval` in single mode, `activeChartInterval` in triple mode.
- `signal-detail.rangeBarsFor` gains cases returning literal bar counts; the `RECENT_*_BARS` constants and `'recent'` case are removed; the `ALL_BARS_MAX` sentinel for `'all'` is unchanged.

### UI

- Both pill groups — `chart-view-toolbar` (live) and `chart-toolbar` (hidden inside `signal-detail` when `showToolbar`) — render the identical set `25 | 50 | 100 | 6M | 1Y | 5Y | All`.
- Pill highlight reads the *active chart's* range, so the group always reflects whichever chart a click would affect.
- Defaults are the initial per-chart map: `{ daily: '50', weekly: '50', monthly: '50' }`.

## Testing Decisions

### ChartToolbarStateService spec

Per-chart map defaults; `setRange` targets active chart in each layout mode; active-chart switching moves the write target.

### signal-detail spec

`rangeBarsFor` maps each new member to its literal count per interval; `'recent'` gone from both union and switch; per-chart `rangeBars{Daily,Weekly,Monthly}` computeds read independent selections.

### Toolbar specs

Pill set renders the new order; `Recent` absent; `.active` class tracks the active chart's range; hidden `chart-toolbar` parity pinned.

## Out of Scope

- **Persisting range selections across page visits** — the toolbar-state service is page-scoped today and stays that way.
- **Per-symbol range memory** — selections are chart-scoped, not symbol-scoped.
- **Changes to zoom/pan brush behavior** — `visibleBars` semantics unchanged; only what feeds it.
- **Other surfaces** — `contract-list-picker`'s `applyChartRange` (a brushed date bound) and the options contract viewer are unrelated concepts, untouched.
- **The `Recent` label as a concept elsewhere** — `RECENT_LIST_ID` in `spread-list.service` is a symbol-list id, unrelated.

## Technical Context

- State resets per visit by design (existing page-scoped service); there is no persisted 'recent' value anywhere — removal is migration-free.
- A bar count exceeding available history degrades to all available bars (US-6); `visibleBars` already tolerates overshoot (`ALL_BARS_MAX` = 99999 precedent).

## Further Notes

### Prior art

- **Per-interval map pattern** — `selectedIdsByInterval` in `ChartToolbarStateService` is the established shape for per-chart toolbar state.
- **Active-chart mechanism** — `activeChartInterval` + `setActiveChart` + `.active-chart` cell styling already implement "which chart is active" for the indicator badge; this thread reuses it as the range target.
