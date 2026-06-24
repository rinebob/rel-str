# RH Agent — Signal Grouping & Symbol-Centric Persistence Plan

**Status:** Planning  
**Created:** 2026-06-22  
**Goal:** Reorganize signal storage from a flat opportunity list into a symbol-centric structure with company metadata, enabling grouped review by sector/industry/market-cap and multi-day signal history tracking.

---

## Problem Statement

Current state:
- Signals are flat docs in `rh-agent-opportunities` with no structural relationship to the symbol that generated them.
- Each run overwrites or appends independently — no cross-run history per symbol.
- No company metadata (sector, industry, market cap) anywhere in the system.
- The review page is a single sorted list — cognitively expensive to prioritize across 700+ symbols.

Desired state:
- Signals live inside their symbol's doc hierarchy.
- Each symbol has SA company overview data (sector, industry, market cap, etc.) enabling multi-dimension grouping.
- The review page groups symbols into collapsible sections — initially by sector/industry, sortable by market cap within a group.
- **By default, only symbols with a signal today are shown** (gated by `lastWeeklySignalDate` or `lastDailySignalDate`). A **"Show Full Group" toggle** reveals all symbols in the group — including those with no signal today — so the user can see the broader sector/industry context.
- **No-signal symbols are full citizens:** same chart, same signal history panel (shows older signals if any). Only ACR triage buttons are disabled.
- **Weekly and daily signals are reviewed separately** — weekly signals are higher conviction and drive the primary review pass. Daily signals are reviewed second, informed by the weekly picture.
- Signals are not evenly spaced; a symbol might fire 2–5 times over several weeks, then nothing, then fire again. The user reads the pattern, the system just provides the history.

---

## Architecture Decisions

### 1. Signal Persistence: `signal-dates` subcollection under symbol doc

**New structure:**

```
rh-agent-symbols/{SYMBOL}                    ← symbol config + company overview
  signal-dates/                              ← subcollection, one doc per date
    {YYYY-MM-DD}                             ← doc ID is the bar date (not run date for W/M)
      signals: {                             ← map field — all signals for that date
        D_ZONE_V1_UPTICK: { status, direction, barDate, runId, indicators, ... }
        W_ZONE_V1_UPTICK: { status, direction, barDate, runId, indicators, ... }
      }
```

**Why `signal-dates` with a map field:**
- One doc per date is far less noisy in Firestore than one doc per signal occurrence.
- The map key is `signalType` — reading all signals for a date is a single doc fetch.
- Signal history drill-down ("show me all signals for AAPL") is a simple subcollection query on one symbol.
- `collectionGroup('signal-dates')` is available as a secondary tool for admin queries.
- Re-runs are idempotent — writing to a map key with `merge: true` overwrites only that key.
- Reversals are handled by deleting the specific map key (`FieldValue.delete()`).

**Doc ID = bar date, not run date:**
- Daily signals: bar date === run date === `marketDate`. No difference.
- Weekly signals: bar date = last weekly bar's date (e.g. `2026-06-20`). The same weekly bar fires on Mon-Fri of the following week — they all write to the same doc, preventing duplicates.
- Monthly signals: same pattern — bar date = last monthly bar's date.

**INTERIM vs CONFIRMED status:**
- All daily signals are always `CONFIRMED` (bar is closed).
- Weekly/monthly signals within the current open period are `INTERIM` — price action could reverse.
- A signal becomes `CONFIRMED` when the bar period closes (Friday for weekly, month-end for monthly).
- `CONFIRMED` signal map entries are **never overwritten or deleted**.
- When a W/M signal reverses intraperiod, the worker deletes the `INTERIM` map key.

**Migration of `rh-agent-opportunities`:**
- No backward compat requirement — this is a prototype.
- Worker writes exclusively to `signal-dates` from the start.
- **Do not delete `rh-agent-opportunities`** — leave untouched until explicitly confirmed safe to remove.

---

### 2. Company Overview Data: Enrich `rh-agent-symbols/{SYMBOL}`

**Why here:**
- Already one doc per symbol.
- Config fields (`enabled`, `priority`, `addedAt`) and metadata fields (`sector`, `industry`, `marketCap`) coexist naturally — when you load the symbol list for the review page you get everything in one read.
- Doc size: ~2KB of SA overview fields × 761 symbols ≈ 1.5MB total — trivial.

**Fields to store from SA Company Overview:**

| Field | Stored As | Used For |
|---|---|---|
| `Sector` | `sector` (string) | Primary group dimension |
| `Industry` | `industry` (string) | Secondary group dimension |
| `MarketCapitalization` | `marketCap` (number) | Sort within group |
| `Name` | `name` (string) | Display |
| `Exchange` | `exchange` (string) | Filter option |
| `AssetType` | `assetType` (string) | Filter option |
| `Beta` | `beta` (number) | Risk sort |
| `PERatio` | `peRatio` (number) | Valuation filter |
| `ForwardPE` | `forwardPe` (number) | Valuation filter |
| `52WeekHigh` | `week52High` (number) | Context |
| `52WeekLow` | `week52Low` (number) | Context |
| `200DayMovingAverage` | `ma200` (number) | Trend context |
| `50DayMovingAverage` | `ma50` (number) | Trend context |
| `AnalystTargetPrice` | `analystTarget` (number) | Upside context |
| `AnalystRatingBuy` + `StrongBuy` | `analystBuys` (number) | Sentiment |
| `AnalystRatingSell` + `StrongSell` | `analystSells` (number) | Sentiment |
| `DividendYield` | `dividendYield` (number) | Filter option |
| `overviewFetchedAt` | timestamp | Freshness check |

**Market cap tier derivation (computed from `marketCap`):**

| Tier | Range |
|---|---|
| `mega` | > $200B |
| `large` | $10B–$200B |
| `mid` | $2B–$10B |
| `small` | $300M–$2B |
| `micro` | < $300M |

---

### 3. Signal Schema (under `rh-agent-symbols/{SYMBOL}/signal-dates/`)

**Collection constant:** `RH_AGENT_SIGNAL_DATES_SUBCOLLECTION = 'signal-dates'`

**Doc ID:** `{YYYY-MM-DD}` — the bar date (daily = run date; weekly/monthly = last bar's date).

**Signal type enum** — signal types are finite and fully knowable from the strategy implementations.

```typescript
enum StSignalType {
  D_ZONE_V1_UPTICK   = 'D_ZONE_V1_UPTICK',
  D_ZONE_V1_DOWNTICK = 'D_ZONE_V1_DOWNTICK',
  D_ZONE_V2_UPTICK   = 'D_ZONE_V2_UPTICK',
  D_ZONE_V2_DOWNTICK = 'D_ZONE_V2_DOWNTICK',
  W_ZONE_V1_UPTICK   = 'W_ZONE_V1_UPTICK',
  W_ZONE_V1_DOWNTICK = 'W_ZONE_V1_DOWNTICK',
  W_ZONE_V2_UPTICK   = 'W_ZONE_V2_UPTICK',
  W_ZONE_V2_DOWNTICK = 'W_ZONE_V2_DOWNTICK',
}
```

**Signal date doc** — one doc per bar date, signals stored as a map keyed by `signalType`:

```typescript
interface RhAgentSignalDateDoc {
  symbol: string;                // denormalized
  barDate: string;               // YYYY-MM-DD — doc ID, the bar's date
  runId: string;                 // last run that wrote/updated this doc
  updatedAt: Timestamp;
  signals: {
    [signalType: string]: RhAgentSignalEntry;
  };
}

interface RhAgentSignalEntry {
  signalType: StSignalType;
  timeframe: 'D' | 'W';
  direction: StSignalDirection;  // LONG | SHORT
  status: 'INTERIM' | 'CONFIRMED';
  barDate: string;               // YYYY-MM-DD — the bar that triggered
  marketDate: string;            // YYYY-MM-DD — the run date (may differ from barDate for W)
  indicators: Record<string, number | string | null>;
}
```

**Status rules:**
- Daily signals → always `CONFIRMED` (daily bar is closed by the time the agent runs).
- Weekly/monthly signals → `INTERIM` if `marketDate` is within the bar's open period; `CONFIRMED` once the period closes (worker checks if `marketDate >= barDate + 7 days` for weekly, month-end for monthly — meaning the next bar has started).
- `CONFIRMED` entries are never overwritten or deleted.
- When a W/M signal reverses intraperiod, worker uses `FieldValue.delete()` to remove the `INTERIM` entry from the map.

**`lastWeeklySignalDate` / `lastDailySignalDate` on symbol doc** now stores the bar date (not run date), so the grouped review query correctly finds symbols with a recent bar-level signal.

---

### 4. Updated `rh-agent-symbols/{SYMBOL}` Doc Schema

```typescript
interface RhAgentSymbolDoc {
  // Existing config fields
  symbol: string;
  enabled: boolean;
  addedAt: Timestamp;
  lastAnalyzedAt?: Timestamp;

  // Company overview (from SA)
  name?: string;
  sector?: string;
  industry?: string;
  exchange?: string;
  assetType?: string;
  marketCap?: number;
  marketCapTier?: 'mega' | 'large' | 'mid' | 'small' | 'micro';
  beta?: number;
  peRatio?: number;
  forwardPe?: number;
  week52High?: number;
  week52Low?: number;
  ma200?: number;
  ma50?: number;
  analystTarget?: number;
  analystBuys?: number;
  analystSells?: number;
  dividendYield?: number;
  overviewFetchedAt?: Timestamp;

  // Signal gates — one per timeframe, drives which review mode surfaces this symbol
  lastDailySignalDate?: string;    // YYYY-MM-DD — symbol appears in Daily review if this === today
  lastWeeklySignalDate?: string;   // YYYY-MM-DD — symbol appears in Weekly review if this === today
  // Monthly signals not tracked — too coarse for trading
}
```

---

## Implementation Phases

### Phase 1 — Backend: Company Overview Sync

**Goal:** Populate `rh-agent-symbols/{SYMBOL}` with SA overview data.

Tasks:
1. Create `rh-agent-overview-sync.ts` Cloud Function (admin callable + optional scheduled).
2. For each symbol in `rh-agent-symbols`, call the SA company overview endpoint (auth via Firebase/GCP — no API key).
3. Map SA fields → normalized `RhAgentSymbolDoc` fields, compute `marketCapTier`.
4. `merge: true` upsert — never overwrites config fields (`enabled`, `addedAt`).
5. Store `overviewFetchedAt` timestamp for freshness checks.

**Refresh cadence:** SA checks company data weekly. Set up a Pub/Sub notification or scheduled function to trigger the sync weekly. Sector/industry/market cap rarely change but beta and analyst ratings do — weekly refresh covers both.

---

### Phase 2 — Backend: Worker writes signals to `signal-dates` subcollection

**Goal:** Worker stores signals under `rh-agent-symbols/{SYMBOL}/signal-dates/{barDate}` instead of (or in addition to) `rh-agent-opportunities`.

Tasks:
1. Strategy `execute()` must return `barDate` in each `StrategyOutput` — the date of the bar that fired (last bar in the trimmed array passed to the strategy).
2. Update worker to write to `signal-dates/{barDate}` using a map merge: `{ signals: { [signalType]: RhAgentSignalEntry } }` with `merge: true`.
3. Determine `status` in worker: daily → `CONFIRMED`; weekly → `CONFIRMED` if `marketDate >= barDate + 7 days` (next week started), else `INTERIM`.
4. On reversal (no signal for a W/M bar that previously had an INTERIM entry): worker reads existing doc, deletes INTERIM keys via `FieldValue.delete()` for signal types that did not fire.
5. After signal write, update gate field on symbol doc using `barDate` (not `marketDate`):
   - Daily signal → `lastDailySignalDate = barDate`
   - Weekly signal → `lastWeeklySignalDate = barDate`
6. `rh-agent-opportunities` left in place, cleaned up in Phase 6.

---

### Phase 3 — Backend: Signal query callables

**Goal:** Provide efficient query paths for the frontend.

**Primary query model is symbol-first:** The review page does NOT query signals directly. It loads the symbol list with overview + summary fields, then groups and renders. Signals are loaded lazily per symbol on demand.

New/updated callables:
- `rhAgentGetSymbolsWithSignals({ marketDate, timeframe: 'W' | 'D' })` — primary review query. Returns enabled `rh-agent-symbols` docs where `lastWeeklySignalDate == marketDate` (weekly mode) or `lastDailySignalDate == marketDate` (daily mode). Filtering happens server-side.
- `rhAgentGetSymbolSignalHistory(symbol, timeframe: 'W' | 'D', days?: number)` — subcollection query under one symbol filtered by `timeframe`, ordered by `marketDate` desc. Returns signals from the last `days` trading days (default: 5). Timeframe is required — D and W histories are always reviewed separately.
- `rhAgentGetSignalsForDate(marketDate)` — collectionGroup query across all symbols for a given date. Secondary/admin use only — not part of the main review flow.

---

### Phase 4 — Frontend: Symbol-centric data model

**Goal:** Frontend loads symbol docs (with overview + summary fields) and builds grouped structure. Signals are a secondary load, fetched per-symbol on demand.

Tasks:
1. Add `RhAgentSymbolProfile` interface to `rh-agent.service.ts` mirroring the Firestore doc.
2. Update `RhAgentService`: add `getSymbolsWithSignals(marketDate)` calling the Phase 3 callable. Existing `getSignalHistory` stays for legacy compat during transition.
3. Update `RhAgentStore`: primary state is `symbols: RhAgentSymbolProfile[]` + `activeTimeframe: 'W' | 'D'` (defaults to `'W'`). No monthly mode.
4. Add computed `symbolsWithTodaySignal` — filters on `lastWeeklySignalDate === today` or `lastDailySignalDate === today` depending on `activeTimeframe`. This is what gets grouped and rendered.
5. Add computed `groupedByDimension(dimension)` — produces `SignalGroup[]` from `symbolsWithTodaySignal`.
6. On demand: when user selects a symbol row, fetch its signals subcollection via `rhAgentGetSymbolSignalHistory(symbol)`. Cache in store keyed by symbol. Signals are shown as child rows under the symbol in the detail panel.

**Grouping structure:**

```typescript
interface SignalGroup {
  key: string;             // e.g., 'HEALTHCARE'
  label: string;           // display name
  subGroups?: SignalGroup[];  // e.g., industries within sector
  symbols: SymbolWithSignals[];
  signalCount: number;
}

interface SymbolWithSignals {
  symbol: string;
  profile: RhAgentSymbolProfile;      // overview + config fields
  signals?: RhAgentSignalDoc[];       // loaded on demand from subcollection, shown as child rows
}
```

---

### Phase 5 — Frontend: Grouped review UI

**Goal:** Replace flat signal list with grouped expansion panel list, with D/W mode switching and full-group context view.

**Two grouping sources (both supported, user selects):**
1. **Static sector ETF grouping** — based on SPDR ETF membership (XLK, XLV, XLF, etc.) from `BaselineRegistryService`. Available immediately, no Phase 1 dependency. Groups are well-known market sectors. ETF member symbols not in `rh-agent-symbols` shown as context-only (view chart, no ACR).
2. **SA company overview grouping** — based on `sector`/`industry` fields populated by Phase 1. Groups derived from the actual `rh-agent-symbols` universe. More accurate to the trading universe. Available after Phase 1.

Both modes support the **"Signals Only / Full Group" toggle** described below.

**Review workflow (two-pass):**
1. **Weekly pass (default):** Start here. Groups as expansion panels. Default view shows only symbols with `lastWeeklySignalDate === today`. This is the primary triage surface.
2. **Daily drill-down:** When a weekly signal is interesting, the user drills into that symbol's daily signals from within the detail panel — not a separate top-level mode switch.

**Triage actions (ACR) on symbol rows:**
Users can act directly from the grouped list without going to the full review page. Each symbol row has inline action buttons:

```typescript
enum RhReviewStatus {
  PENDING   = 'PENDING',    // default — not yet triaged
  PROMOTE   = 'PROMOTE',    // take a closer look — interesting but not yet committed
  ACCEPT    = 'ACCEPT',     // high conviction — ready to act
  CONSIDER  = 'CONSIDER',   // on radar but not urgent
  REJECT    = 'REJECT',     // not interesting
}
```

- **PROMOTE** is the new middle tier: "worth a closer look" — most symbols that previously would have been accepted should land here first, then graduate to ACCEPT after review.
- **ACCEPT** means ready to act — user is confident.
- Users can skip straight to ACCEPT if they want. The status tiers are guidance, not a required workflow.
- ACR status is stored on the signal doc (or locally in UI state for now — Phase 5 decides).
- The full review page (`rh-agent-review`) is where the user goes after initial triage to do deep review on PROMOTED/ACCEPTED symbols.

**List structure (within each mode):**
- **Groups as expansion panels** — each group (e.g. sector) is a collapsible expansion panel.
- **Panel header** shows: group name, signal count badge (`N signals today`), total symbol count, **"Signals Only / Full Group" toggle**, **"Review Group" button** (navigates to `rh-agent-review` scoped to group).
- **"Signals Only" (default):** panel body shows only symbols with a signal today. These rows have ACR buttons enabled.
- **"Full Group":** panel body shows all symbols in the group. Signal symbols visually distinguished (e.g. highlighted row or signal badge). No-signal symbols show same ticker/name/market cap badge but ACR buttons disabled.
- **Every symbol row** (signal or not) is clickable: loads that symbol's bar data + signal history from subcollection (last 5 trading days, filtered by active timeframe), opens detail panel with chart. No-signal symbols will show an empty or sparse signal history — that's fine and expected.
- **From the detail panel**, a **"Show Daily"** button loads the daily signal history alongside the weekly view.
- **Sort within group:** Market cap descending by default; toggle to sort by signal date or triage status.

**Quick chart placeholders (future):**
- Hover targets on symbol rows will eventually show a zoomed mini chart (W or D) for rapid visual glance without opening the full detail panel.
- **Placeholder:** reserve the hover interaction slot in the symbol row component now. Implement as a tooltip or popover shell with a "coming soon" stub so the layout is already correct when charts are wired in.

**Group dimension selector** (pill toggle per existing pattern):
- Sector/Industry (default)
- Market Cap Tier
- Direction (Long / Short)
- Exchange

---

### Phase 6 — Cleanup

- Remove dual-write, deprecate `rh-agent-opportunities` flat collection.
- Migrate signal history component to read from subcollection.
- Add Firestore composite indexes for all new query patterns.
- **Migrate `StrategyOutput.action` from `'OPEN_LONG' | 'OPEN_SHORT'` string literals to `StSignalDirection` enum** — eliminates the mapping in `createSignalDoc()` and makes the type consistent from strategy execution through to Firestore persistence.

---

## Firestore Index Requirements

| Collection | Fields | Query | Usage |
|---|---|---|---|
| `rh-agent-symbols` | `enabled` ASC, `sector` ASC, `marketCap` DESC | Grouped symbol list | **Primary — review page load** |
| `rh-agent-symbols/{S}/signal-dates` | `barDate` DESC | Symbol signal date history | Detail panel drill-down |
| `signal-dates` (collectionGroup) | `barDate` ASC | All signal dates across symbols | Admin use only |

---

## What We Are NOT Doing (Yet)

- Persisting review decisions (`ACCEPTED`/`REJECTED`) to Firestore — still local UI state for now.
- Multi-strategy grouping (one strategy at a time).
- Real-time signal streaming — still callable-based fetch on page load.
- The actual UI group rendering (Phase 5) — backend phases first.
- "All signals for a run" as a first-class query — this is the flat random list we are explicitly replacing. Run-level stats (count, status) are fine on the run doc; the signal list itself must be symbol-grouped.

---

## Open Questions

- **SA overview endpoint:** Confirm the exact SA endpoint path and GCP auth mechanism for company overview data before Phase 1.
- **Pub/Sub for weekly overview refresh:** Determine whether to trigger via Cloud Scheduler → Pub/Sub → callable, or a direct scheduled function.
- **collectionGroup security rules:** `rh-agent-symbols` is admin-only. Verify the `signals` subcollection inherits those rules correctly (should by default).
