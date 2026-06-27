# RH Agent — Signal Grouping & Symbol-Centric Persistence Plan

**Status:** Phases 1–6 complete  
**Created:** 2026-06-22  
**Updated:** 2026-06-27  
**Goal:** Reorganize signal storage from a flat opportunity list into a symbol-centric structure with company metadata, enabling grouped review by sector/industry/market-cap and multi-day signal history tracking. Connect triage decisions to the deep-review and trade execution surface.

---

## Problem Statement

Original state (resolved):
- Signals were flat docs in `rh-agent-opportunities` with no structural relationship to the symbol that generated them.
- Each run overwrote or appended independently — no cross-run history per symbol.
- No company metadata (sector, industry, market cap) anywhere in the system.
- The review page was a single sorted list — cognitively expensive to prioritize across 700+ symbols.

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

**Migration of `rh-agent-opportunities`:** ✅ Complete (2026-06-27)
- Worker writes exclusively to `signal-dates`.
- All frontend reads removed; `rh-agent-opportunities` collection is now dead code in production.
- `RH_AGENT_OPPORTUNITIES_COLLECTION`, `RhTradeOpportunity`, `RhOpportunityStatus`, `RhOpportunityAction` removed from `rh-agent-config.ts`.
- `rhAgentGetSignalHistory` and `rhAgentGetOpportunities` callables deleted.

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
6. ✅ `rh-agent-opportunities` reads fully removed in Phase 6.

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
2. ✅ `RhAgentService`: `getSymbolsWithSignals(marketDate)` added. `getSignalHistory`, `getSignalsForRun`, `watchRecentOpportunitiesRealtime`, `normalizeSignals`, and `RhTradeSignal` removed in Phase 6.
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

### Phase 5B — Frontend: Triage → Review → Order Pipeline

**Goal:** Wire PACR decisions from Grouped Review through chart review to trade execution via a shared triage state service.

**Four-page pipeline:**

```
Dashboard (/rh-agent)                      → Operate: runs, sync, admin
Grouped Review (/rh-agent-grouped-review)  → Triage: scan 200+ signals, rapid PACR
Review (/rh-agent/review)                  → Chart analysis for PROMOTED symbols
Order (/rh-agent/order)                    → Final trade params + prompt generation
```

Flow: **Operate → Triage → Review → Order**.

**PACR semantics:**

| Status | Meaning | Set where | Consequence |
|--------|---------|-----------|-------------|
| **PROMOTE** | "Looks good — needs chart review before committing" | Grouped Review | Flows to Review page |
| **ACCEPT** | "One-glance yes — signal is so strong I'm confident without a chart" | Grouped Review (rare) or Review page (after chart analysis) | Flows to Order page |
| **CONSIDER** | "Not now, not never" — soft skip for this session | Grouped Review | Hidden from current session, no permanent consequence |
| **REJECT** | "Untradable" — bad chart setup, unfavorable conditions | Review page (primarily) | Removed from session. Future: global exclusion list |
| **PENDING** | Default — not yet triaged | — | Visible in Grouped Review |

**Key flow rules:**
- ACCEPT on Grouped Review = skip chart review, go directly to Order page.
- PROMOTE on Grouped Review = send to Review page for chart analysis.
- On Review page: PROMOTE → ACCEPT (chart confirms) or PROMOTE → REJECT (chart disqualifies).
- CONSIDER = "I saw it, not interested today." Clears from view without consequence.
- The chart is the gating function. No chart, no trade — except for rare one-glance accepts.

---

#### 5B.1 Triage State Store (Single SOT)

`RhAgentTriageStore` — NgRx signal store (`providedIn: 'root'`), **the only owner** of PACR state. All pages read from and write to this store. Same pattern as `RhAgentGroupStore`.

```
File: src/app/features/rh-agent/rh-agent-triage.store.ts
```

**State:**
- `statuses: Record<string, RhReviewStatus>` — per-symbol PACR status
- `timeframe: 'W' | 'D'` — active timeframe (carried from Grouped Review)
- `marketDate: string` — active market date (YYYY-MM-DD)

**Computed:**
- `promotedSymbols` — symbols with status PROMOTE (feeds Review page)
- `acceptedSymbols` — symbols with status ACCEPT (feeds Order page)
- `promotedCount` / `acceptedCount` — for button badges

**Methods:**
- `setStatus(symbol, status)` — set one symbol's PACR status
- `setGroupStatus(symbols[], status)` — set all symbols in a group
- `setTimeframe(tf)` / `setMarketDate(date)` — context setters
- `clear()` — reset all state (called on timeframe or date change)

**Design rules:**
- `RhAgentGroupStore.reviewStatuses` is **removed**. The group store reads PACR state from the triage store. One source, one owner.
- Session-scoped. Page refresh clears state. No Firestore persistence (yet).
- Changing timeframe or market date calls `clear()` automatically — stale selections from a previous scan don't carry over.

---

#### 5B.2 Grouped Review Integration

Update `RhAgentGroupedReviewComponent` and `RhAgentGroupStore`:

1. **Remove `reviewStatuses` from group store state.** Replace with reads from `RhAgentTriageStore.statuses`.
2. **PACR button handlers** call `triageStore.setStatus(symbol, status)` directly. UI reactivity comes from the triage store's signal — no local copy.
3. **Group-level actions** in expansion panel headers: "Promote Group" / "Accept Group" buttons that call `triageStore.setGroupStatus(group.signalSymbols, status)`.
4. **"Review Promoted (N)"** button in page toolbar:
   - Badge shows `triageStore.promotedCount()`.
   - Disabled when count is 0.
   - Navigates to `/rh-agent/review`.
5. **"Order Accepted (N)"** button in page toolbar:
   - Badge shows `triageStore.acceptedCount()`.
   - Disabled when count is 0.
   - Navigates to `/rh-agent/order`.

---

#### 5B.3 Review Page Integration

The review page already has a working master-detail layout with charts, signal detail, and ACR buttons. **Don't rewrite it.** Feed promoted symbols into the existing left panel alongside or instead of the current run-based signals.

**Data source addition:** When `triageStore.promotedSymbols` is non-empty, the left panel (signal list) shows those symbols. Each symbol fetches its signal history via `rhAgentGetSymbolSignalHistory(symbol, timeframe, days)`. The existing chart + indicator overlays in the detail panel work as-is.

**Actions per symbol (already exist in the review page):**
- **Accept** — chart confirms the signal. Moves symbol from PROMOTE → ACCEPT in triage store. Symbol disappears from left panel, appears in Order page list.
- **Reject** — chart disqualifies. Moves symbol to REJECT. Disappears from left panel. Future: adds to global exclusion list.

**Integration approach:** ✅ Complete. `SignalListComponent` refactored to read directly from `RhAgentTriageStore.reviewSymbols()` and serves as the left panel in `rh-agent-review.component`. `RhAgentDashboardStore` is now runs-only (no signal triage state). `rh-agent-dashboard` page is ops/admin only.

---

#### 5B.4 Order Page (New)

**Route:** `/rh-agent/order`

**Purpose:** Final trade parameter configuration and prompt generation for ACCEPTED symbols. This is where the Claude RH MCP prompt is built.

**Data source:** Reads `triageStore.acceptedSymbols`.

**Existing code to build on:**
- `RobinhoodTradeService` — already generates `TradePrompt` and `TradeBatch` objects, handles clipboard copy.
- `RobinhoodTradePanelComponent` — already renders trade prompts in a dialog. Currently opened from the review page via `openTradeDialog()`.
- `RhAgentDashboardStore.generateBatchTrade()` / `generateTradeBatchFromAccepted()` — batch prompt generation from accepted signals.

The Order page extracts this existing functionality from the dialog into a full-page view with additional trade parameters.

**Per-symbol fields (editable table row):**

| Field | Default | Notes |
|-------|---------|-------|
| Symbol | from triage | Read-only |
| Direction | from signal (LONG/SHORT) | Read-only |
| Entry type | Market | Market / Limit |
| Position size | $100 | Editable, per-symbol |
| Stop loss % | 8% | Editable, per-symbol |
| Stop loss price | computed from entry − 8% | Auto-calculated |
| Options strategy | Stock | Stock / Call / Put / Spread (future) |
| Go/No-Go | ✓ | Toggle — final gate before prompt inclusion |

**Actions:**
- **Generate Prompt** — builds batch trade prompt text from all Go symbols via `RobinhoodTradeService.generateBatchPrompt()`.
- **Copy to Clipboard** — one-click copy via `RobinhoodTradeService.copyToClipboard()`.
- **Remove** — moves symbol back to PROMOTE (returns to Review page list) or drops entirely.

**Minimal first version:** Table of accepted symbols with position size + stop loss fields. "Generate All" button. Copy to clipboard. Options strategy and limit orders are future.

---

#### 5B.5 Implementation Order

1. Create `RhAgentTriageStore` (NgRx signal store) — state, computed, methods.
2. Remove `reviewStatuses` from `RhAgentGroupStore`. Wire PACR buttons to triage store.
3. Add "Review Promoted (N)" and "Order Accepted (N)" buttons to Grouped Review toolbar.
4. Add group-level Promote/Accept buttons in expansion panel headers.
5. Integrate Review page — signal list reads promoted symbols from triage store, existing chart/detail unchanged.
6. Build Order page — accepted symbols table, stop/size fields, prompt generation (building on existing `RobinhoodTradeService`).

---

### Phase 6 — Cleanup ✅ Complete (2026-06-27)

- ✅ Removed all `rh-agent-opportunities` reads from frontend (`RhAgentStore`, `RhAgentDashboardStore`, `rh-agent.service.ts`, `rh-agent-dashboard.component`).
- ✅ `RhAgentDashboardStore` simplified to runs-only UI state (expand/collapse, show-all toggle, run status helpers). No signal triage state.
- ✅ `RhAgentStore` no longer holds `signals` state or calls `getSignalHistory`.
- ✅ `rh-agent.service.ts`: removed `RhTradeSignal`, `normalizeSignals`, `getSignalHistory`, `getSignalsForRun`, `watchRecentOpportunitiesRealtime`, `opportunitiesCollection`.
- ✅ `rh-agent-dashboard.component.html` rewritten — runs-only, no filter panels or triage ACR columns.
- ✅ `SignalListComponent` refactored to display `triageStore.reviewSymbols()` and used as left panel in `rh-agent-review.component`.
- ✅ `signal-detail.component` removed dependency on `RhAgentDashboardStore`; Signals filter menu (which filtered by `rh-agent-opportunities` signal types) removed from chart toolbar.
- ✅ Backend: `rhAgentGetSignalHistory` and `rhAgentGetOpportunities` deleted from both callable files.
- ✅ `RH_AGENT_OPPORTUNITIES_COLLECTION`, `RhTradeOpportunity`, `RhOpportunityStatus`, `RhOpportunityAction` removed from `rh-agent-config.ts`.
- ✅ Dashboard page is now ops/admin only — run status, "Run Now", bars sync, Grouped Review link.
- ⏳ Firestore composite indexes — add when query patterns stabilize.
- ⏳ Migrate `StrategyOutput.action` from `'OPEN_LONG' | 'OPEN_SHORT'` string literals to `StSignalDirection` enum.

---

## Firestore Index Requirements

| Collection | Fields | Query | Usage |
|---|---|---|---|
| `rh-agent-symbols` | `enabled` ASC, `sector` ASC, `marketCap` DESC | Grouped symbol list | **Primary — review page load** |
| `rh-agent-symbols/{S}/signal-dates` | `barDate` DESC | Symbol signal date history | Detail panel drill-down |
| `signal-dates` (collectionGroup) | `barDate` ASC | All signal dates across symbols | Admin use only |

---

## What We Are NOT Doing (Yet)

- Persisting review decisions (`ACCEPTED`/`REJECTED`) to Firestore — still local UI state for now (Phase 5B uses session-scoped NgRx signal store).
- Multi-strategy grouping (one strategy at a time).
- Real-time signal streaming — still callable-based fetch on page load.
- "All signals for a run" as a first-class query — this is the flat random list we are explicitly replacing. Run-level stats (count, status) are fine on the run doc; the signal list itself must be symbol-grouped.

---

## Open Questions

- ~~**SA overview endpoint:** Confirm the exact SA endpoint path and GCP auth mechanism for company overview data before Phase 1.~~ **RESOLVED** — company overview data is persisted in RS.
- **Pub/Sub for weekly overview refresh:** Determine whether to trigger via Cloud Scheduler → Pub/Sub → callable, or a direct scheduled function.
- **collectionGroup security rules:** `rh-agent-symbols` is admin-only. Verify the `signals` subcollection inherits those rules correctly (should by default).
