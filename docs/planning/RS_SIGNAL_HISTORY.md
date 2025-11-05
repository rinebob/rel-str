# RsSignalHistory - Canonical Trade Signals (Design Spec)

## Overview

RsSignalHistory is the core value feature of the app. It persists canonical open/close trade signals derived from Relative Strength (RS) threshold crossings for each baseline–symbol pair. It supports:

- Historical backfill to reconstruct all signals from existing RS series
- Daily realtime updates (pre/post) to append signals for the current day
- Daily rollups of new opens, holds, and new closes
- Position lifecycle tracking (open → hold → close) with PnL metrics
- Configurable thresholds per environment and per baseline (defaults provided)

This document defines the thresholds, state machine, Firestore schema, processing workflows, APIs, and UI consumption patterns.

## As-built deltas (2025-11-04)

- Pair enumeration is sourced exclusively from `pair-registry/*`. Request-provided `pairs` are ignored for backfill.
- Position price fields are standardized:
  - `opened.openPrice` (was `opened.price`)
  - `closed.closePrice` (was `closed.price`)
- Daily rollups use kebab-case collection name `signals-daily` under each pair doc and an optional root mirror `signals-daily/` for cross-pair aggregation.
- Trades and analytics are written at top level collections:
  - `trades/{positionId}` with entry/exit timestamps and prices, plus human-readable `entryDay/exitDay` and `entryIso/exitIso`.
  - `analytics/summary` maintains `{ totalNetPnL, totalTrades, totalWinningTrades, totalLosingTrades, avgNetPnL, lastUpdated }`.
- Backfill is an admin-protected HTTP function, requires `Authorization: Bearer local-admin`, and processes only registry pairs over a requested day range.

## Thresholds and Semantics

Default thresholds (configurable):
- Open Long when RS crosses above open-long threshold (default 0.80)
- Close Long when RS crosses below close-long threshold (default 0.80)
- Open Short when RS crosses below open-short threshold (default 0.20)
- Close Short when RS crosses above close-short threshold (default 0.20)

Notes:
- Thresholds are compared using prior-day vs current-day RS to detect a crossing event.
- Crossing is directional: e.g., for open-long, require `rs_yesterday < thr` and `rs_today >= thr`.
- Long and Short are mutually exclusive positions. If a long is open, a new short cannot open until the long is closed, and vice versa.
- Source policy: All historical signals are POST-only (canonical). All realtime signals are PRE-only (intraday). Canonical PnL uses POST prices; PRE is for intraday visibility only.

## Position State Machine

States per pair (at most one open position):
- Flat → LongOpen → LongHold → LongClose → Flat
- Flat → ShortOpen → ShortHold → ShortClose → Flat

Daily evaluation order (per pair, per phase):
1) Close checks first (if a matching open position exists)
2) Open checks next (if flat)
3) Hold classification for positions that remain open

Edge cases:
- Same-day open and close can occur if both thresholds are crossed across PRE/POST; both events are recorded in the same position document with correct `opened.source` and `closed.source`.
- If both long-close and short-open qualify on the same day, close is processed first, then the new open.  And vice versa.

## Firestore Schema

Pair-centric location (canonical RS lives under `pairs-data/{BASE}-{SYMBOL}`):

- pairs-data/{PAIR}
  - latest, data[] (see schema doc)
  - signals (subcollection) — canonical position documents. Primary storage is per-pair; optionally maintain a root-level mirror (e.g., `signals-index`) for cross-pair dashboards.
    - {positionId}
      - pair: string ("BASE-SYMBOL")
      - baseline: string
      - symbol: string
      - direction: 'long' | 'short'
      - positionId: string — human-readable id `{PAIR}_{YYYYMMDD}_{DOW}_{direction}` (e.g., `SPY-NVDA_20251103_Mon_long`); the close is written to the same document
      - opened: {
          day: string (YYYY-MM-DD, UTC),
          t: number (epoch ms),
          source: 'pre' | 'post',
          openPrice: number,      // target close (post.target.price) or intraday (pre)
          basePrice: number,      // baseline corresponding price (for reference)
          rsYesterday: number,
          rsToday: number
        }
      - closed?: {
          day: string,
          t: number,
          source: 'pre' | 'post',
          closePrice: number,     // closing target price
          basePrice: number,
          rsYesterday: number,
          rsToday: number,
          change: number,         // closePrice - opened.openPrice (signed)
          pctChange: number       // change / opened.openPrice * 100 (signed)
        }
      - appPnl?: {               // PnL computed from app-derived prices (per source policy)
          openedPrice: number,
          closedPrice?: number,
          change?: number,
          pctChange?: number,
          sourceOpen: 'pre'|'post',
          sourceClose?: 'pre'|'post'
        }
      - tradeMeta?: {            // FE-owned overlay lives under users/{uid}/trades; see below for schema
          hasUserActuals?: boolean
        }
      - status: 'open' | 'closed'
      - createdAt: Timestamp
      - updatedAt: Timestamp

- pairs-data/{PAIR}/signals-daily (subcollection)
  - {day} (YYYY-MM-DD)
    - newOpens: Array<{ positionId:string, direction:'long'|'short' }>
    - holds: Array<{ positionId:string, direction:'long'|'short' }>
    - newCloses: Array<{ positionId:string, direction:'long'|'short', change:number, pctChange:number }>
    - pnlSummary?: {
        long: { count:number, sum:number, sumPct:number },
        short: { count:number, sum:number, sumPct:number },
        total: { count:number, sum:number, sumPct:number }
      }
    - appPnLSummary?: { long:{ count:number, sum:number, sumPct:number }, short:{ count:number, sum:number, sumPct:number }, total:{ count:number, sum:number, sumPct:number } }
    - cumulativePnL?: {  // running totals up to and including this day (pair-scoped)
        long: { count:number, sum:number, sumPct:number },
        short: { count:number, sum:number, sumPct:number },
        total: { count:number, sum:number, sumPct:number }
      }
    - updatedAt: Timestamp

Indexes:
- Collection group `signals`: `status`, `baseline`, `symbol`, `opened.day desc`, `closed.day desc`
- Collection group `signals-daily`: by `day`, and optionally composite `(baseline, day)` via a root mirror if a cross-pair dashboard is needed

## Data Sources for Prices

- Canonical PnL uses POST prices (`ac` for target) aligned by `closed.day` and `opened.day`.
- PRE events compute provisional prices from `ip`; if a position is opened PRE and later closed POST, PnL uses the POST closing price.
- Store `basePrice` for reference and audit; PnL uses the target security price only.

## Processing Workflows

### Historical Backfill (admin)

Input: existing POST RS series from per-year archives under `pairs-data/{PAIR}/archive-YYYY/*`.
Process:
- Enumerate pairs from `pair-registry/*` (ignore request `pairs`).
- Iterate days in ascending order (POST only)
- Maintain current position state per pair (flat/long/short)
- For each day, evaluate close-then-open rules vs thresholds and write signals accordingly
- For open/hold positions with no closing event, add to `signals-daily/{day}.holds`
- Compute PnL at close and update the same position document
- Idempotency: re-running backfill should upsert by deterministic `positionId` (e.g., `{PAIR}_{YYYYMMDD}_{DOW}_{direction}`) and overwrite with consistent data

### Daily Realtime (PRE/POST)

Per `partner-data-ready` phase:
- For each pair updated that day, load yesterday/ today RS (phase-aware selection rubric)
- Apply close-then-open rules
- If opening: create new position doc and append to `signals-daily/{today}.newOpens`
- If holding: append to `signals-daily/{today}.holds`
- If closing: update the existing position doc and append to `signals-daily/{today}.newCloses`; compute app PnL using current source price (per source policy, PRE for realtime), update `appPnl` and `pnlSummary`
- Update `cumulativePnL` running totals for the pair on the `{today}` document
- Guarantee at-most-one open position per pair

Notes on App vs Actual PnL
- App PnL (aka RS PnL) is computed from app-derived prices and stored on the position doc as `appPnl` and summarized under `signals-daily` (pair-scoped, backend-owned). This is immutable aside from normalizing when POST is used for historical closes.
- Actual PnL reflects the user's own brokerage execution. We do not mutate app PnL when a user provides actuals; instead, user-confirmed values live under a per-user overlay (see below). UI can toggle between App PnL and Actual PnL views.

## User Actual Trades Overlay (Per-User)

User confirmations and execution status are stored under the authenticated user's namespace (not in backend-owned `pairs-data/*`).

- users/{uid}/trades/{positionId}
  - positionId: string (matches `pairs-data/{PAIR}/signals/{positionId}`)
  - executed: boolean   // whether the user actually took the trade in their account
  - opened?: {
      price?: number,        // user-supplied actual open fill (from brokerage)
      day?: string,          // human-readable day (YYYY-MM-DD, UTC)
      dow?: string,          // day-of-week label (Mon/Tue/...)
      t?: number,            // optional epoch ms for precise timestamp
      note?: string
    }
  - closed?: {
      price?: number,        // user-supplied actual close fill (from brokerage)
      day?: string,          // human-readable day (YYYY-MM-DD, UTC)
      dow?: string,          // day-of-week label (Mon/Tue/...)
      t?: number,
      note?: string
    }
  - actualPnl?: {
      openedPrice?: number,
      closedPrice?: number,
      openedDay?: string,    // YYYY-MM-DD (UTC)
      closedDay?: string,    // YYYY-MM-DD (UTC)
      change?: number,
      pctChange?: number
    }
  - updatedAt: Timestamp
  - appSnapshot?: {
      openedPrice?: number,
      closedPrice?: number,
      sourceOpen?: 'pre'|'post',
      sourceClose?: 'pre'|'post',
      takenAt?: number  // epoch ms when snapshot captured
    }

Optional per-user daily aggregates

- users/{uid}/pnlDaily/{day}
  - actualPnLSummary?: { long:{ count:number, sum:number, sumPct:number }, short:{ ... }, total:{ ... } }
  - updatedAt: Timestamp

Rules
- Backend never writes user actuals into `pairs-data/*`.
- UI computes/updates `actualPnl` when the user edits their `trades/{positionId}` and may request a callable to persist derived summaries under `users/{uid}/pnlDaily/*`.

## Linking Canonical Signals to Per-User Actuals

Canonical RS-generated trades are stored once per pair under `pairs-data/{PAIR}/signals/{positionId}` and are the same for all users. User-specific fills and actual PnL are stored under `users/{uid}/trades/{positionId}`. We link these via the deterministic `positionId = {PAIR}_{YYYYMMDD}_{DOW}_{direction}`.

Read patterns:
- Panel view (single position): read `pairs-data/{PAIR}/signals/{positionId}` and `users/{uid}/trades/{positionId}` in parallel and merge client-side.
- List view (many positions): prefer a callable to return merged results in one response (see below) to minimize client fan-out and to apply server-side guards.

Write patterns:
- Backend writes only canonical signals and app PnL; never writes into `users/{uid}` overlays.
- UI writes only the per-user overlay in `users/{uid}/trades/*` and recomputes `actualPnl` client-side; optional callable can persist per-user daily aggregates.

Advantages:
- No duplication of RS/app prices across users.
- Simple, reliable join via human-readable `positionId`.
- Clear ownership boundaries for security and rules.

## APIs (Backend)

Callables (sketch):
- `GetPairSignals({ baseline, symbol, limit?:number, source?:'pre'|'post', type?:'open'|'close' })`
  - Returns recent position documents (flattened into events if requested)
- `GetDailySignals({ day?: string, fromDay?: string, toDay?: string, limitDays?: number })`
  - Reads the root mirror 'signals-daily/{YYYY-MM-DD}' (no per-pair fan-out).
  - Request semantics:
    - day: return a single day (UTC).
    - fromDay + toDay: inclusive range (UTC).
    - limitDays: when no range is provided, return the last N days (UTC; default bounded by server, e.g., 30; UI may use 7).
  - Response shape:
    {
      days: Array<{
        day: string,
        items: {
          newOpens: Array<{ positionId: string; direction: 'long'|'short'; pair: string }>,
          holds: Array<{ positionId: string; direction: 'long'|'short'; pair: string }>,
          newCloses: Array<{ positionId: string; direction: 'long'|'short'; pair: string }>,
        }
      }>
    }
  - Notes:
    - Day boundaries are UTC.
    - The root mirror contains 'pair' on each entry when built via rebuildSignalsDailyMirrorImpl; the Decision Board requires 'pair' to group/sort.
- `GetPnLSummary({ from, to, type:'app'|'actual', uid?:string })`
  - Returns PnL over a range grouped by direction and baseline. For `type:'app'`, reads backend summaries. For `type:'actual'`, requires `uid` and reads from `users/{uid}` overlays.
- `UpdatePositionActuals({ positionId, executed:boolean, openedPrice?:number, closedPrice?:number, openedTime?:number, closedTime?:number, noteOpen?:string, noteClose?:string })`
  - Auth-required: upserts `users/{uid}/trades/{positionId}` and returns updated `actualPnl`.
- `GetPositionWithActuals({ positionId, uid?:string })`
  - Returns a merged view of the canonical position (`pairs-data/{PAIR}/signals/{positionId}`) and, if `uid` provided and authenticated, the user overlay (`users/{uid}/trades/{positionId}`), including appPnl and actualPnl.
- `GetPairSignalsWithActuals({ baseline, symbol, uid?:string, limit?:number, fromDay?:string, toDay?:string })`
  - Returns a list of merged positions for a pair (within optional range), attaching user overlays when available.

Admin HTTP (secured):
- `backfillSignalsHistory` — Body: `{ from, to, openLong, closeLong, openShort, closeShort, mirror, verbose, dryRun }`. Auth: `Authorization: Bearer local-admin`. Pairs are sourced from `pair-registry` only.

## UI Consumption

- Dashboard integration
  - From heatmap/dashboard row actions, clicking the 'History' button opens the Signal History panel for that baseline–symbol pair.

- Pair Signal History Panel
  - Show last N events for the current pair (default 30), with filters (type/date/source) and link to open in `rs-chart`

- Daily Signals Dashboard
  - For selected baseline/list: show three lists for the current day — New Opens, Holds, New Closes
  - Provide totals and App PnL summary for the day; when a user is signed in, allow toggling to view per-user Actual PnL (built from `users/{uid}/trades/*`).
  - Multi-day Decision Board: fetch and display signals for a range of days (e.g., last 7 days) using `GetDailySignals` with `fromDay` and `toDay` parameters.

### Decision Board (Multi-day) — UI Consumption

- Call `GetDailySignals` with one of:
  - `{ day: 'YYYY-MM-DD' }` for a single day (UTC)
  - `{ fromDay: 'YYYY-MM-DD', toDay: 'YYYY-MM-DD' }` for an inclusive UTC range
  - `{ limitDays: 7 }` to fetch the last N UTC days when no range provided (UI default 7)
- Group results by `day` (descending, UTC). For each day, render three sections: New Closes, Holds, New Buys.
- Sort items within each section alphabetically by `pair`.
- Hide day header if a day has no items.

Minimal response example (2 days):
```json
{
  "days": [
    {
      "day": "2025-11-05",
      "items": {
        "newOpens": [ { "positionId": "SPY-AAPL_20251105_Wed_long", "direction": "long", "pair": "SPY-AAPL" } ],
        "holds": [ { "positionId": "QQQ-NVDA_20251101_Sat_long", "direction": "long", "pair": "QQQ-NVDA" } ],
        "newCloses": []
      }
    },
    {
      "day": "2025-11-04",
      "items": {
        "newOpens": [],
        "holds": [ { "positionId": "SPY-MSFT_20251031_Fri_short", "direction": "short", "pair": "SPY-MSFT" } ],
        "newCloses": [ { "positionId": "SPY-AAPL_20251028_Tue_long", "direction": "long", "pair": "SPY-AAPL" } ]
      }
    }
  ]
}
```

- Signal History Panel – Actuals Input (UI treatment)
  - When authenticated, the panel shows an "Executed" toggle and two input rows:
    - Open: price input, date picker (YYYY-MM-DD), time input (optional), note field
    - Close: price input, date picker (YYYY-MM-DD), time input (optional), note field
  - On save, the app upserts `users/{uid}/trades/{positionId}` with the user-supplied open/close values and recomputes `actualPnl` client-side; a callable may persist per-user daily aggregates.
  - The panel provides a toggle to switch between viewing App PnL and Actual PnL. When Actuals are incomplete, show a gentle hint to provide missing values.

## Testing Strategy

- Unit tests for crossing detection, state machine transitions, idempotent backfill
- Integration tests with emulators: verify PRE/POST runs generate expected signals and daily rollups
- E2E: flows for viewing Signal History and the Daily Signals dashboard

## Open Questions / Future Work

- Baseline-specific thresholds and optimization/tuning loop
- Short borrow/fee modeling (out of scope for MVP)
- Deprecation path for `pairs-data/{PAIR}.data[]`: prefer archive shards for full history; retain `latest` (and optional short mirrors) only for fast reads
