> **Transition Note (Multi-Interval RS & Signals Activity):** This document describes a **daily-only** trader UI plan. The current canonical model is multi-interval RS with **Signals Activity** (per-pair + root) and archives (`archive-*`) plus `latestDaily/latestWeekly/latestMonthly` for RS series. Treat this file as a **legacy UI plan** and a source of UX ideas; new implementations should wire to `signals-activity` and archives/latest*.

# Trader UI Plan (Phaseable) — Decision Board, History, Analytics

Last updated: 2025-11-04

## Overview

Goal: Convert the existing RsSignalHistory backend (canonical signals, daily rollups, trades, analytics) into a practical trader UI that enables rapid pre-close decisions and evidence-based refinement of rules.

We will (legacy daily-only plan):
- Use a root activity mirror for cross-pair daily dashboards (in the current model, boards should read from `signals-activity/{YYYY}/days/{YYYY-MM-DD}`).
- Start with EMA(50) as the single external indicator, fetched via a backend-only callable (Alpha Vantage source).
- Introduce a server-computed confidence score to rank opens/holds/closes; begin with RS-only + EMA50 alignment and iterate.
- Deliver in phases, minimizing FE fan-out and keeping UX keyboard-first for speed.

Related docs:
- `docs/planning/RS_SIGNAL_HISTORY.md` — canonical schema, workflows, and APIs (see Signals Activity sections).
- `docs/planning/5_DATABASE_SCHEMA.md` — pairs-data, signals, signals-activity, positions, analytics.
- `docs/planning/12_USER_FLOW.md` — will be updated to reflect the flows in this plan

---

## Phases

### Phase 1 — Daily Decision Board + Pair Detail (Firestore-only, legacy)
- Daily board sections: New Opens, Holds, New Closes (in the current model, equivalent views should source from `signals-activity/{YYYY}/days/{YYYY-MM-DD}` plus positions).
- Pair Detail panel: RS latest sparkline, recent positions, threshold bands (for new work, prefer `latestDaily` + archives).
- Confidence score v0 (server-derived in callable):
  - Inputs available without external OHLCV: RS level, RS slope (N=3–5 days), proximity to thresholds.
  - Output: 0–3 badge (Low/Med/High).
- Keyboard-first interactions, density toggle, light/dark.

### Phase 2 — Trades Analytics + Rule Builder (canonical trades)
- Cross-pair analytics powered by `trades/*` and `analytics/summary`.
- Rule Builder (read-only first): apply filters to historical trades and recompute KPIs (win rate, avg PnL, totals).
- Filters limited to canonical data (direction, baseline, RS level/slope, holding period, price floor if stored).

### Phase 3 — Indicators (EMA50) and Enhanced Confidence
- Backend callable fetches EMA(50) from Alpha Vantage and returns indicator state (Above/Below EMA50, distance%).
- Confidence v1 combines RS features + EMA50 alignment; badges drive sort order on the Daily Board.
- Optional caching/mirroring strategy if repeated indicator calls become a bottleneck.

### Phase 4 — Root Mirror Scale & Retention
- Keep the root daily dashboard mirror on by default (in the current model, this is the root Signals Activity view for the selected interval).
- Add retention policy (TTL or scheduled cleanup) for old days (e.g., > 90 days) if cost grows.

---

## UI Surfaces

### 1) Daily Decision Board (Home)
- Sections: New Opens, Holds, New Closes.
- Columns: Pair, Direction, RS y→t (delta), Price snapshot (per PRE/POST policy), Confidence badge, Quick link to Pair Detail.
- Actions: bulk select, mark-as-acted (local UX state), filter drawer, keyboard nav.
- Data: daily root mirror plus `pairs-data/{PAIR}` latest snapshot for freshness during PRE.

### 2) Pair Detail Panel
- RS sparkline from daily RS series (e.g., `archive-YYYY` + `latestDaily`) with threshold overlays.
- Latest snapshot (PRE/POST) and recent positions table (limit N from `signals`).
- Later: EMA50 alignment indicator, distance%.

### 3) Signals History View
- Collection group `signals` with facets: baseline, symbol, direction, status, source, day range.
- Timeline or compact table mode, open Pair Detail on click.
 - Data source: canonical open/close signals emitted by the RS engine (`rs-signals-engine.detectRsEvents`) and written by the events consumer (`rs-events-consumer.applyRsEventsForPair`).

### 4) Trades Analytics View
- KPIs: total/win rate/avg PnL/total PnL; breakdowns by baseline, direction, regime.
- Rule Builder panel to filter trades and recompute KPIs.
- Drill into outliers → Pair Detail.

---

## Data & Read Patterns (legacy)

- Canonical positions: `pairs-data/{PAIR}/signals/{positionId}` (one doc per position lifecycle).
- Activity rollup (pair): `pairs-data/{PAIR}/signals-activity/{YYYY}/days/{YYYY-MM-DD}`.
- Activity rollup (root): `signals-activity/{YYYY}/days/{YYYY-MM-DD}`.
- Latest RS for UI: `pairs-data/{PAIR}.latest` (or `latestDaily` in the multi-interval design) plus archives.
- Trades: `trades/{positionId}`; summary: `analytics/summary`.

Selection rubric (RS):
- Historical days: POST only.
- Today: POST if present, else PRE.

---

## Backend API Sketches (Callables/HTTP)

- GetDailySignals({ day:string, useRoot:boolean=true, includePairsLatest?:boolean })
  - Returns { day, newOpens[], holds[], newCloses[], optional: pairsLatest map }.
  - Confidence scoring computed server-side for each item.

- GetPairSignalsWithActuals({ baseline, symbol, limit?:number, fromDay?:string, toDay?:string })
  - Returns recent positions merged with user overlays (when auth’d) for Pair Detail.

- GetPnLSummary({ from:string, to:string, type:'app'|'actual', uid?:string })
  - Aggregates KPIs for Trades Analytics; uses `trades/*` and `analytics/summary`.

- GetIndicators({ baseline, symbol, indicators:['EMA50'], day?:string | range })
  - Server-only fetch from Alpha Vantage; returns current EMA50 and alignment.

Notes
- Confidence is computed in GetDailySignals to ensure consistent ranking across clients.
- Indicators callable is optional for Phase 1; required for Phase 3.

---

## Confidence Score (Initial)

Scale: 0–3, surfaced as badges (Low/Med/High). Used for sort and quick triage.

Inputs (v0):
- RS level relative to thresholds (e.g., post-crossing magnitude).
- RS slope over last N=3–5 days (positive for long, negative for short).
- Proximity to threshold (closer moves can be less reliable; tweak based on data).

Inputs (v1, Phase 3):
- EMA50 alignment (Above for long, Below for short) (+1 point).
- Distance to EMA50 (%), penalize if stretched beyond band.

Policy
- Keep transparent: display contributing factors in tooltip.
- Recalibrate using Trades Analytics; treat as sorting aid, not a hard blocker.

---

## Filtering & Rule Builder

Available early (no external data):
- Baseline, Symbol, Direction, Status.
- RS level/slope buckets.
- Holding period buckets.

With EMA50 (Phase 3):
- EMA50 alignment filter; distance band filter.

Execution
- For historical analytics, compute filters on server to avoid FE fan-out.
- For Daily Board, compute lightweight filters/confidence on server; client applies display-only toggles.

---

## Testing Plan

- Unit (Jest): selectors for sections; confidence score computation; rule evaluation; sorting.
- E2E (Cypress/Playwright): PRE to POST transition on board; bulk actions flow; Pair Detail navigation; analytics filter KPIs update.

---

## Open Questions

- Confidence thresholds: where to cap RS slope windows and distance-to-EMA bands?
- Root mirror retention: default 90 days acceptable?
- EMA50 call limits: rate limiting & caching strategy (per baseline-symbol per day).

---

## Next Steps

1) Spec GetDailySignals and GetIndicators contracts precisely (types, error shapes).
2) Update `docs/planning/12_USER_FLOW.md` with these flows.
3) Add confidence scoring rubric and examples to `RS_SIGNAL_HISTORY.md` UI Consumption.
4) Define indexes needed for collection-group `signals` queries and board queries.

---

## Decision Board — Multi-day Support (Scope for v1)

Implementation goals:
- Show multiple days of transactions (New Closes, Holds, New Buys) grouped by day (UTC), most-recent first.
- Avoid per-pair fan-out; use Signals Activity.
- Keep implementation lean (no indicators, no scoring in v1).

Backend callable (existing): `getDailySignals`
- Parameters:
  - `day?: string` — single day, `YYYY-MM-DD` (UTC)
  - `fromDay?: string` — inclusive start day, `YYYY-MM-DD` (UTC)
  - `toDay?: string` — inclusive end day, `YYYY-MM-DD` (UTC)
  - `limitDays?: number` — number of recent days to return when range is not specified (default 30; v1 UI uses 7)
- Response shape:
  - `{ days: Array<{ day: string; items: { newOpens: Item[]; holds: Item[]; newCloses: Item[] } }> }`
  - `Item = { positionId: string; direction: 'long'|'short'; /* may include pair in Signals Activity */ }`
  - Note: Signals Activity entries include `pair` so the Decision Board can render per-pair items without additional lookups; UI requires `pair`.

UI behavior (DecisionBoardView):
- Date presets: Today, 7d, 14d, 30d, Custom (v1: Today & 7d).
- Group by day (UTC). For each day, render three collapsible sections: New Closes, Holds, New Buys.
- Sort within each section alphabetically by `pair`.
- Pagination: default `limitDays = 7`. "Load more" appends +7 older days by calling `getDailySignals({ limitDays: current + 7 })`.
- Empty states: hide day headers with no items.

Notes:
- Timezone: All day boundaries are UTC to match backend archives and mirrors.
- Future (optional): attach `pairs-data/{PAIR}.latest` to display PRE/POST tags. Not required for v1.

---

## Trade Chart Overlay (Extend sync-chart)

Purpose: Visualize historical positions directly on the price chart with standard trade annotations so traders can see entries/exits in context and quickly assess what worked.

Scope: Extend the existing `sync-chart` view (price with RS overlay) to render canonical positions and (optionally) user actuals.

### Data Sources
- Canonical positions per pair: `pairs-data/{PAIR}/signals/{positionId}` (open/close, app PnL, sources PRE/POST).
- Flat trades list: `trades/{positionId}` (entry/exit timestamps/prices, netPnL, percentReturn).
- Indicators: EMA50 via `GetIndicators` callable (Phase 3+).
- Prices/OHLCV: server callable that fetches from partner for the selected range.
- Optional per-user actuals: `users/{uid}/trades/{positionId}` (merge with canonical for display toggles App vs Actual).

Recommended API shape (server)
- `GetPairChartWithTrades({ baseline, symbol, from, to, indicators:['EMA50'], sourcePolicy:'post'|'prepost' })`
  - Returns: `{ ohlcv: OHLCV[], indicators:{ ema50?: number[] }, positions: PositionDto[], rsMini?: RsPoint[] }`
  - Enforces selection rubric for RS (POST for historical days; today uses POST if present else PRE).

Types (sketch)
- `PositionDto = { id: string; direction: 'long'|'short'; opened: { day: string; t: number; source: 'pre'|'post'; price: number }; closed?: { day: string; t: number; source: 'pre'|'post'; price: number }; change?: number; pctChange?: number; appPnl?: {...}; actualPnl?: {...} }`
- `OHLCV = { t: number; o: number; h: number; l: number; c: number; v?: number }`
- `RsPoint = { t: number; rs: number }`

### Rendering Primitives
- Open marker: upward (long) or downward (short) triangle at the entry bar’s price.
- Close marker: opposing triangle at the exit bar’s price.
- Position connector: line segment connecting open→close across the time axis.
  - Color: green for profit, red for loss, neutral gray if open/undetermined.
  - Style: solid for POST-derived prices, dashed if any endpoint is PRE (intraday) for clarity.
- Hover/tooltip:
  - Show positionId, direction, opened day/price/source, closed day/price/source, change, pctChange, RS(y→t) at open/close, EMA50 alignment at open (if available).
- Legend and toggles:
  - Show/hide trades.
  - Show App vs Actual (if user actuals present).
  - Show EMA50.

### Multiple/Overlapping Positions
- Stacking: vertically offset lines by a small pixel delta when multiple positions overlap in time to reduce occlusion; cap stacks and reduce opacity beyond the cap.
- Clipping: only render segments within the current view window; compute entry/exit coordinates against visible range for performance.
- Compact mode: render endpoints-only (no connectors) when >N positions are visible (e.g., N=150).

### Filters (Chart-level)
- Direction: long, short, both.
- Result: winners, losers, all.
- Source: PRE-only, POST-only, both.
- Date range quick picks: 1m, 3m, 6m, 1y, YTD, custom.
- Confidence bucket (Phase 3+): filter by Low/Med/High to validate impact visually.

### Interactions
- Click marker/segment → open Position Detail drawer (canonical doc + optional user actuals).
- Brush/zoom on chart updates the server request range for prices and trims rendered trades.
- Keyboard navigation: n/p for next/previous visible position; Enter opens details.

### Indicators (Phase 3+)
- EMA50 overlay as a line on the price chart; tooltip shows value and distance%.
- Trade tooltips note EMA50 alignment at entry (Above/Below) when available.

### Performance Considerations
- Server-side join: return only trades/positions within the requested range.
- Downsample OHLCV for wide windows; compute indicators server-side.
- Virtualize rendered segments; prefer Canvas/SVG batching in the existing renderer.
- Use theme tokens for colors/styles (Sass variables/mixins): profit, loss, neutral, dashed.

### Accessibility & Theming
- High-contrast mode toggle for trade annotations.
- Respect global light/dark theme.

### Testing
- Unit: mapping from positions → primitives (coordinates, colors, dashed logic), winner/loser logic.
- Integration (emulators): API returns expected positions and indicators for a fixed range; rendering count matches.
- E2E: zoom/brush updates, clicking a trade opens details, filter toggles alter visible annotations.

### Open Questions
- Max visible positions before compact mode default? (Proposed 150)
- Same-day open/close rendering: overlapping markers + short segment vs combined glyph?
- Show ghost to last price for open positions to indicate unrealized PnL?

### Next Steps
- Finalize `GetPairChartWithTrades` response contract and add to `RS_SIGNAL_HISTORY.md` UI Consumption.
- Add chart-level filters list to `12_USER_FLOW.md` under `sync-chart` extension.
- Define Sass tokens for profit/loss/neutral colors and dashed styles.
