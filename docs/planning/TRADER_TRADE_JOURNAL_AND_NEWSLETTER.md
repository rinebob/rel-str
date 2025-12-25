# Trade Journal & Newsletter Feature

## 1. Overview & Goals

This document defines a new **view-level feature** for the rel-str app that lets a trader:

- **Record and review individual trades** with rich, multi-timeframe context.
- **Persist indicator events and trade triggers** derived from proprietary indicators (Trend Bands and Trend Meter), using CSV exports from TradingView.
- **Capture structured notes and screenshots** across the lifecycle of a trade (open  updates  close).
- **Curate trades into a PDF newsletter** in a later phase.

The feature is intentionally designed to sit on top of the existing RS/positions and partner data pipeline, without disturbing the RS engine or positions model.


## 2. Conceptual Model

### 2.1 Trading System Recap

The discretionary trading system uses three chart timeframes:

- **Monthly**: Primary trend and campaign identifier.
- **Weekly**: Pullback identifier within the active monthly trend.
- **Daily**: Entry / hold / exit management.

Two proprietary indicators drive trade decisions:

- **Trend Bands**
  - Smoothed, vertically thick bands similar to moving averages.
  - Two bands for the chart timeframe, and two bands for a higher timeframe (typically 3x the chart TF).
  - The lower timeframe pair plus the fast higher timeframe band define **zones**:
    - `+3, +2, +1, -1, -2, -3` from highest to lowest.
  - Each **zone transition** (e.g. `-1  +1`, `+1  +2`) is an **event**.
  - Events are tracked separately for **LONG** and **SHORT** sides.

- **Trend Meter**
  - Histogram below price, measures trend strength and direction.
  - Values typically range from about `-50` to `+50` but are technically unbounded.
  - Reference lines at `-10`, `0`, and `+10`.
  - Each time the meter value crosses one of these lines (on the LONG or SHORT side), it generates an **event**.

Each indicator therefore produces **independent event streams per side** (LONG and SHORT) for each timeframe.


### 2.2 High-Level Entities

This feature introduces or relies on the following conceptual entities:

- **Indicator Event**
  - Canonical, normalized event derived from TradingView CSV exports.
  - Used for event history views and later analytics.

- **Trade**
  - A specific discretionary trade in a symbol, with direction, prices, and multi-timeframe context.
  - Contains curated **trade triggers**, a **notes timeline**, and **screenshots**.

- **Campaign** (future-friendly)
  - A long-lived sequence of trades aligned with a major monthly trend in a particular symbol.
  - Optional grouping mechanism that ties multiple trades to a common monthly trend event.

- **Newsletter Draft** (later phase)
  - A curated set of trades, with layout metadata, used to generate a PDF newsletter.


## 3. Indicator Events & CSV Ingestion

### 3.1 CSV Inputs

- There is **one TradingView CSV per timeframe**:
  - `Daily` CSV.
  - `Weekly` CSV.
  - `Monthly` CSV.
- Each CSV:
  - Contains **historical data by date**.
  - Encodes all necessary numeric/zone information in **columns**, not per-event rows.
  - The app must **derive events** (zone changes, line crossings) by comparing adjacent rows.

#### 3.1.1 Filename Structure

TradingView CSV filenames encode both the **symbol (with exchange)** and the **chart timeframe**. Example:

- `BATS_QQQ, 1M_32b1f`

General pattern:

- `exchange_symbol, timeframe_hash`
  - `exchange_symbol` → e.g. `BATS_QQQ`
    - `exchange` = `BATS`
    - `symbol`   = `QQQ`
  - `timeframe_hash` → e.g. `1M_32b1f`
    - `tfToken` = `1M` (or `1D`, `1W`, `2D`, `3W`, etc.)
    - `hash`    = opaque ID (ignored by this feature).

Initial mapping for this feature:

- `1D` → DAILY
- `1W` → WEEKLY
- `1M` → MONTHLY

TradingView also supports composite chart timeframes like `2D` or `3W`. The importer should:

- Be written to recognize `tfToken` generically.
- Initially **accept only** `1D`, `1W`, and `1M` (rejecting or ignoring unsupported tokens).
- Allow future extension to treat `2D`, `3W`, etc. as additional timeframes if we decide to support them.

### 3.2 Event Detection

For each CSV row:

- Determine the **timeframe** from the file (Daily, Weekly, Monthly).
- For each `symbol` and logical **side** (LONG / SHORT) and for each indicator, derive events from the concrete columns.

#### 3.2.1 Trend Bands (Zones)

Relevant columns:

- Plotting bands (for context only, not for event detection):
  - `CTF smHA fast (Open|High|Low|Close)`
  - `CTF smHA slow (Open|High|Low|Close)`
  - `HTF smHA fast (Open|High|Low|Close)`
  - `HTF smHA slow (Open|High|Low|Close)`
- Zone state columns (primary source of zone information):
  - `zonePlusThree`  → zone `+3`
  - `zonePlusTwo`    → zone `+2`
  - `zonePlusOne`    → zone `+1`
  - `zoneMinusOne`   → zone `-1`
  - `zoneMinusTwo`   → zone `-2`
  - `zoneMinusThree` → zone `-3`

Interpretation:

- On any given bar, one or more of the `zone*` columns may contain a numeric value.
- The **presence** of a value in a column indicates that price overlaps that zone on that bar; the numeric value itself is just the y-axis plotting coordinate.

Event detection strategy:

- For each row, derive a **set of active zones** from the non-empty `zone*` columns.
- For each adjacent pair of rows (`t-1`, `t`) for the same `symbol + timeframe`:
  - Let `prevZones` be the set of active zones at `t-1`.
  - Let `currZones` be the set of active zones at `t`.
  - For each zone in `currZones` that was **not** present in `prevZones`, emit an **enter event** for that zone.
  - For each zone in `prevZones` that is **no longer** present in `currZones`, emit an **exit event** for that zone.
- For trade- and analytics-friendly consumption, we will primarily model **zone transitions**:
  - When the **primary zone** for the bar (heuristically the highest-priority zone, e.g. the one closest to price or a configured ordering such as `+3 .. -3`) changes between `t-1` and `t`, emit a `ZONE_CHANGE` event with `fromZone` and `toZone`.

Notes:

- Multiple active zones on a bar (thin bands overlapping) are expected; the event model must handle sets rather than a single zone flag.
- We may later expose both **"primary zone" changes** (for triggers) and **"zone overlap" enter/exit events** (for deeper diagnostics).

#### 3.2.2 Trend Meter (Histogram Crossings)

Relevant columns:

- `DI Histogram` → numeric trend strength (can be positive or negative, typically in the range ~[-50, +50]).
- `Zero line` → helper/reference column; not strictly required for crossings but may be useful for validation.

Event detection strategy:

- For each bar, bucket the `DI Histogram` value into one of four ranges:
  - `< -10`
  - `[-10, 0)`
  - `[0, +10)`
  - `>= +10`
- For each adjacent pair of rows (`t-1`, `t`) for the same `symbol + timeframe`:
  - Compute `prevBucket` and `currBucket` from the histogram values.
  - If `prevBucket != currBucket`, emit a `METER_CROSS` event representing the transition between ranges.
- This captures crossings of `-10`, `0`, and `+10` without relying on intra-bar data (we only have end-of-bar CSV values).

Extensibility:

- Future TradingView exports may add additional indicator-specific columns (e.g. more band sets, oscillator states, flags).
- The ingestion pipeline should be written to allow **pluggable detectors** that can:
  - Read a configuration for which columns constitute a given indicator.
  - Register new event types (e.g. additional histogram thresholds, pattern flags) without breaking existing Trend Bands / Trend Meter logic.

### 3.3 Event Persistence

Each detected event is stored in a normalized **event stream** (backend design TBC when we wire Firestore/Functions):

- `eventId`
- `symbol`
- `timeframe` (MONTHLY | WEEKLY | DAILY)
- `indicator` (TrendBands | TrendMeter)
- `side` (LONG | SHORT)
- `eventType` (e.g. ZONE_CHANGE, METER_CROSS)
- `fromValue` / `toValue`
  - Zones (e.g. `-1`  `+1`) for bands.
  - Bucketed or numeric values for the meter.
- `timestamp` / `eventDate`

Events are **not embedded in trades**; they are stored in shared series for querying across symbols and time.

### 3.4 Incremental Ingestion

Because the CSVs contain historical data:

- The importer must **only process data after the last known ingested date** for each `symbol + timeframe`.
- High-level strategy:
  - Track per `symbol + timeframe` the **last ingested date**.
  - On CSV import, skip rows  last ingested date, and process only new rows.
  - Optionally support a **full re-import** operation for maintenance.

(Exact technical implementation of incremental state is deferred to the backend design phase.)


## 4. Trade Model

Each **Trade** represents a single discretionary position that the trader wants to track and potentially publish.

### 4.1 Core Fields

- **Identity & Ownership**
  - `tradeId`
  - `userId`

- **Symbol & Direction**
  - `symbol`
  - `direction` (LONG | SHORT)
  - `status` (PLANNED | OPEN | CLOSED | CANCELED)

- **Timing**
  - `entryDate` (calendar date, possibly with time)
  - `createdAt`
  - `updatedAt`
  - `closedAt` (optional until closed)

- **Price & Risk Fields**
  - `entryPrice`
  - `initialStopLoss`
  - `initialTarget`
  - `exitPrice` (optional)
  - `realizedPnL` / `realizedPct` (can be derived or stored explicitly)

- **Narrative Summary**
  - `currentOutlook` (short summary of the big picture)
  - `actionsToTake` (bullet-like free text for planned actions)

### 4.2 Multi-Timeframe Context Snapshot

At or near the time of entry, the trader wants to record a **snapshot of indicator state** across Monthly / Weekly / Daily.

For each timeframe (`MONTHLY`, `WEEKLY`, `DAILY`) we track:

- `timeframe` (MONTHLY | WEEKLY | DAILY)
- **Trend Bands**
  - `zone` (`+3, +2, +1, -1, -2, -3`)
  - `zoneEnteredAt` (date/time when price entered the current zone)
- **Trend Meter**
  - `currentStrength` (numeric value at entry snapshot)
  - `lastZeroCrossAt` (date/time when meter last crossed zero)
- **Dominant Trend**
  - `dominantDirection` (LONG | SHORT | NEUTRAL)
  - Optional textual `dominantReason` for human explanation.

This snapshot can be **pre-populated from the event streams** or TradingView-derived state, then confirmed/edited manually in the UI.


### 4.3 Trade Triggers

Indicator events are the **triggers that justify a trade**. We want to persist these inside the trade for:

- Clear narrative documentation.
- A stable reference even if event streams are later compacted or re-imported.
- Future analytics by trigger type and outcome.

Each trade contains a curated list of **Trade Triggers**:

- `triggers[]`:
  - `triggerId` (local to the trade)
  - `linkedEventId` (reference to the canonical Indicator Event, if available)
  - `timeframe` (MONTHLY | WEEKLY | DAILY)
  - `role`
    - Examples: `monthlyTrend`, `weeklyPullback`, `dailyEntry`, `dailyHold`, `dailyExit`.
  - `indicator` (TrendBands | TrendMeter)
  - `eventType` (e.g. ZONE_CHANGE, METER_CROSS)
  - `description` (human explanation of why this event matters for the trade)
  - `timestamp`

Example roles:

- Monthly Trend trigger: marks the start or confirmation of a long-term campaign.
- Weekly Pullback trigger: identifies a high-probability pullback within the monthly trend.
- Daily Entry / Hold / Exit triggers: finer-grained intra-campaign management.


### 4.4 Notes Timeline (with Screenshots)

The trader needs **structured note taking** with explicit notes for open, close, and multiple updates while a trade is open. Notes should also support **screenshots**.

Represent this as a timeline of notes:

- `notes[]`:
  - `noteId`
  - `noteKind`: `open` | `update` | `close`
  - `timestamp`
  - `text` (freeform commentary)
  - `attachments[]` (optional, e.g. screenshots related to this note)
    - `attachmentId`
    - `type` (e.g. `screenshot`)
    - `url` or storage reference
    - `label` / `caption`

Lifecycle expectations:

- **Open Note**
  - Captured when the trade is first created.
  - Documents the initial rationale and expectations.

- **Update Notes**
  - Added while the trade is OPEN.
  - Can include screenshot attachments for mid-trade context.
  - May be tagged conceptually (e.g. adjustment, risk, emotional, review) later.

- **Close Note**
  - Captured when the trade transitions to CLOSED.
  - Summarizes what happened, what worked, and what to improve.


### 4.5 Screenshots (Standalone + in Notes)

Screenshots can be modeled in two complementary ways:

1. **Standalone screenshot list** on the trade:
   - `screenshots[]` with
     - `screenshotId`
     - `timeframe` (optional, e.g. DAILY | WEEKLY | MONTHLY)
     - `url`
     - `label`
     - `caption`
     - `createdAt`

2. **Per-note attachments**:
   - Each note can have zero or more attachments, which may link to screenshots.

The UI will likely:

- Expose an **"Add Screenshot"** action either in a dedicated panel or within note editors.
- Let the user optionally associate screenshots directly with notes or keep them as general trade assets.


### 4.6 Campaigns (Conceptual)

To capture long-lived sequences of trades under the same monthly trend:

- Optional `campaignId` on the trade.
- Optional separate `campaign` entity (future):
  - `campaignId`
  - `symbol`
  - `direction` (LONG | SHORT)
  - `startedAt` (often aligned with a key Monthly Trend event)
  - `endedAt` or `stillActive`
  - `rootTriggerEventId` (the monthly event that kicked off the campaign)

This will support later analytics such as:

- How often a particular type of monthly event leads to profitable campaigns.
- Aggregate performance across all trades in a given campaign.


## 5. Views & UX Flows

### 5.1 Trade List View

A high-level overview of all recorded trades, with filtering by date, symbol, direction, status, and newsletter inclusion.

Core elements:

- **Filters**
  - Date range (e.g. last 30 days, this month, custom).
  - Status (PLANNED, OPEN, CLOSED, CANCELED).
  - Symbol search.
  - Direction (LONG, SHORT).
  - Flag: `includeInNewsletter` (later phase).

- **Table/List**
  - Columns:
    - Symbol
    - Direction
    - Entry Date
    - Status
    - PnL (if closed)
    - Short context summary (e.g. a compressed D/W/M snapshot).

- **Actions**
  - `+ New Trade` button opens the Trade Create flow.
  - Selecting a row opens the Trade Detail view.

### 5.2 Trade Detail View

The core experience for documenting and reviewing a trade.

#### Layout Concept

- **Header**
  - Symbol, direction badge, status chip.
  - Entry price, stop, target (and exit price if closed).
  - Quick PnL summary when available.

- **Left Column** (Trade + Notes)
  - Trade summary form fields (prices, direction, status).
  - `currentOutlook` and `actionsToTake` text fields.
  - **Notes Timeline**:
    - OPEN note at top.
    - UPDATE notes in chronological order.
    - CLOSE note at end when trade is closed.
    - Inline or modal editors with screenshot attachments.

- **Right Column** (Context + Events)
  - **Timeframe Snapshot Tabs**
    - Tabs for `Daily`, `Weekly`, `Monthly`.
    - Each tab shows the snapshot fields for that timeframe:
      - Zone, `zoneEnteredAt`.
      - Trend strength, `lastZeroCrossAt`.
      - Dominant direction.
  - **Indicator Event History Panel**
    - Controls:
      - Timeframe toggle: `D / W / M`.
      - Window selector: `Last day`, `Last week`, `Last month`, or custom range around entry date.
    - Event list:
      - Chronological list of events in the chosen window.
      - Per event action: e.g. `Mark as Trigger` to add to `triggers[]`.
  - **Trade Triggers Section**
    - Grouped by role (Monthly Trend, Weekly Pullback, Daily Entry/Hold/Exit).
    - Shows summarized trigger information and description.


### 5.3 Indicator Event History UX

The event history panel is backed by the canonical event streams from CSV ingestion:

- The user can:
  - Toggle between **Daily / Weekly / Monthly**.
  - Change the time window (e.g. `Last week` for Daily events around entry, `Last month` for Weekly, `Current + previous month` for Monthly).
  - View a compact list of events by date/time.
  - Promote specific events into the trade's `triggers[]` with an explicit role and description.

This design balances:

- Avoiding overwhelming daily event noise.
- Providing enough context for review and journaling.
- Supporting later analytics by storing both the full event stream and curated triggers.


### 5.4 Newsletter Builder View (Later Phase)

A separate view will allow the trader to build a PDF newsletter from selected trades.

High-level behavior:

- Filters to select eligible trades (e.g. CLOSED trades within a date range, with `includeInNewsletter` flagged).
- Trade selection list on the left, newsletter draft outline on the right.
- For each trade in the draft:
  - Choose a **primary screenshot**.
  - Provide or override a **short public summary** (derived from open/close notes and triggers).
  - Reorder trades via drag-and-drop.
- Provide global newsletter metadata:
  - Title.
  - Publish date.
  - Intro paragraph.
- Trigger PDF generation via backend (implementation defined later).


## 6. Phasing & Future Work

This document focuses on **conceptual design**. Implementation will be phased:

1. **Phase 1: Trade Journal + Notes + Screenshots**
   - Trade creation/editing.
   - Notes timeline with screenshot attachments.
   - Manual entry or basic prefill of D/W/M snapshot fields.

2. **Phase 2: CSV Ingestion + Indicator Event Streams**
   - Import Daily/Weekly/Monthly CSVs.
   - Derive and persist canonical Indicator Events.
   - Track incremental ingestion by last ingested date.

3. **Phase 3: Event History & Trade Triggers**
   - Event history panel in Trade Detail.
   - Ability to promote events into trade-level triggers.
   - Optional campaign identifiers and basic campaign grouping.

4. **Phase 4: Newsletter Builder & PDF Generation**
   - Newsletter draft entity and builder UI.
   - PDF generation and download flow.
   - Optional analytics surfaces (e.g. outcome by trigger type, outcome by campaign).

Further planning documents (backend, frontend, API, schema) will specify:

- Exact Firestore collections and document shapes.
- Angular views, stores, and routes.
- Cloud Functions (or Cloud Run) for CSV processing and PDF generation.
