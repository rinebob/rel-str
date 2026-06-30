# RH Agent PACR Persistence & Universe Management Plan

**Status:** Phase 1 implemented (store/service wiring and reporting page)  
**Updated:** 2026-06-29

## Goal
Move PACR (Promote / Accept / Consider / Reject) decisions from the session-only `RhAgentTriageStore` into Firestore, and extend the system to support symbol-level universe management:

1. Decisions survive page reloads and navigation.
2. Users can generate lists of all symbols by status and by market date.
3. Any page that exposes PACR buttons writes to the same persistent source.
4. The model is extensible for future designations/classifications beyond PACR.
5. Users can exclude, demote, or mark symbols as low-tradability from the chart review UI.
6. New symbols (including ETFs) can be added to the universe and tracked alongside existing stocks.
7. The grouped review can filter out excluded/demoted symbols and surface preferred universe members.

## Core Principles

- **Single source of truth:** `RhAgentTriageStore` remains the in-memory source of truth for components, but it is backed by Firestore.
- **Write-through:** Every status change is persisted to Firestore as it is made.
- **Symbol + date granularity:** A decision is keyed by `(symbol, marketDate)`. One status per symbol per date.
- **Extensible schema:** The status field is an open string, and a `metadata` map is reserved for future classifications without schema migrations.

## Proposed Firestore Schema

### Collection: `rh-agent-triage-decisions`

One document per symbol per market date.

**Document ID:** `{symbol}_{date}` (e.g., `AAPL_2026-06-25`)

**Fields:**

| Field | Type | Description |
|-------|------|-------------|
| `symbol` | string | Uppercase symbol (e.g., `AAPL`). |
| `date` | string | Market date in `YYYY-MM-DD` (ISO 8601). |
| `status` | string | One of `PENDING`, `PROMOTE`, `ACCEPT`, `CONSIDER`, `REJECT`, `EXCLUDE`, `LOW_TRADABILITY`, `WATCH`, `ELEVATE`. Open to future values. |
| `createdAt` | Timestamp | When the decision row was first created. |
| `updatedAt` | Timestamp | When the decision was last changed. |
| `userId` | string | Firebase Auth UID of the user who made the decision (for multi-user support). |
| `source` | string | Page/component that last changed the status (e.g., `grouped-review`, `review`, `order`). |
| `runId` | string | Optional agent run that produced the signal being reviewed. |
| `notes` | string | Optional free-text note. |
| `metadata` | map<string, any> | Extensible bucket for future designations (e.g., `strategy`, `confidence`, `tags`, custom classifications). |

### Indexes

- Composite: `date` ascending + `status` ascending (for "all ACCEPT on 2026-06-25" queries).
- Composite: `symbol` ascending + `date` descending (for per-symbol history).
- Composite: `userId` ascending + `date` descending (for user-scoped history).

### Collection: `rh-agent-symbol-meta`

Persistent symbol-level attributes, independent of any daily decision. One document per symbol.

**Document ID:** `{symbol}` (e.g., `AAPL`)

**Fields:**

| Field | Type | Description |
|-------|------|-------------|
| `symbol` | string | Uppercase symbol. |
| `universeStatus` | string | `IN_UNIVERSE`, `EXCLUDED`, `LOW_TRADABILITY`, `WATCHLIST`, `PREFERRED`. |
| `symbolType` | string | `STOCK`, `ETF`, `FUTURE`, `FOREX`, etc. |
| `tags` | string[] | User-defined tags (e.g., `liquid`, `tech`, `etf`, `high-beta`). |
| `tradeabilityScore` | number | Optional 0-100 score derived from manual review or heuristics. |
| `notes` | string | Free-text rationale for exclusion/demotion. |
| `source` | string | Where the symbol came from (e.g., `import`, `agent`, `manual`). |
| `createdAt` | Timestamp | When the meta record was first created. |
| `updatedAt` | Timestamp | When the meta record was last changed. |
| `userId` | string | Firebase Auth UID. |
| `metadata` | map<string, any> | Extensible bucket (e.g., `sectorOverride`, `liquidityFlags`). |

### Indexes for Symbol Meta

- Composite: `universeStatus` ascending + `symbol` ascending (for universe filtering).
- Composite: `symbolType` ascending + `universeStatus` ascending (for ETF/stock filters).

## Data Flow

```
+-------------+   setStatus(symbol, status, date)   +-----------------------+
|  Component  | -----------------------------------> | RhAgentTriageStore    |
+-------------+                                      | (in-memory signals)   |
       ^                                             +-----------+-----------+
       |                                                         |
       | read computed()                                           | write-through
       |                                                         v
       |                                             +-----------------------+
       |                                             | RhAgentTriageService  |
       |                                             | (Firestore I/O)       |
       |                                             +-----------+-----------+
       |                                                         |
       |                                                         v
       |                                             +-----------------------+
       |                                             | rh-agent-triage-decisions |
       |                                             +-----------------------+
       |                                                         |
       +---------------------------------------------------------+
                          onSnapshot / loadDecisions()
```

## Symbol Universe Management

The PACR buttons are used for both trade-entry decisions and long-term universe curation. A single symbol-level classification is not enough because:

- A symbol may be excluded from the universe permanently but still have a daily decision on an old date.
- A symbol may be demoted to "low tradability" and shown only when explicitly requested.
- A symbol may be added as an ETF and tagged separately from stocks.

Therefore, the system uses **two collections**:

1. `rh-agent-triage-decisions` — time-bounded daily decisions (`PROMOTE`, `ACCEPT`, `CONSIDER`, `REJECT`, `EXCLUDE`, `LOW_TRADABILITY`, `WATCH`, `ELEVATE`).
2. `rh-agent-symbol-meta` — persistent symbol-level attributes (`universeStatus`, `symbolType`, `tags`, `tradeabilityScore`).

When a user marks a symbol as `EXCLUDE` or `LOW_TRADABILITY` in the grouped review, the UI updates both:
- Writes a `status: EXCLUDE` decision to `rh-agent-triage-decisions` for the current date (audit trail).
- Writes or updates `universeStatus: EXCLUDED` in `rh-agent-symbol-meta` (persistent universe state).

This split keeps the daily audit trail intact while also allowing the universe to be filtered independently.

## Frontend Changes

### 1. New Service: `RhAgentTriageService`

`src/app/features/rh-agent/rh-agent-triage.service.ts`

Responsibilities:
- Load decisions for a date range or a single date.
- Persist a decision for `(symbol, date)`.
- Batch persist for group actions (`promote all`, `accept all`).
- Provide real-time listener (optional) for cross-tab sync.

Key methods:

```typescript
loadDecisionsForDateRange(startDate: string, endDate: string): Observable<RhTriageDecision[]>
loadDecisionsForDate(date: string): Observable<RhTriageDecision[]>
setDecision(decision: RhTriageDecisionInput): Observable<void>
setDecisionsBatch(decisions: RhTriageDecisionInput[]): Observable<void>
listenToDecisionsForDate(date: string): Observable<RhTriageDecision[]>
```

### 2. New Service: `RhAgentSymbolMetaService`

`src/app/features/rh-agent/rh-agent-symbol-meta.service.ts`

Responsibilities:
- Load and persist symbol-level meta records (`rh-agent-symbol-meta`).
- Provide observable streams for universe status, symbol types, and tags.
- Support importing new symbols/ETFs into the universe.
- Expose filters for grouped review.

Key methods:

```typescript
loadSymbolMeta(symbols: string[]): Observable<Record<string, RhSymbolMeta>>
setUniverseStatus(symbol: string, status: UniverseStatus, notes?: string): Observable<void>
setSymbolType(symbol: string, type: SymbolType): Observable<void>
addSymbol(symbol: string, type: SymbolType, tags?: string[]): Observable<void>
removeSymbol(symbol: string): Observable<void> // soft delete or hard delete based on rules
getUniverseSnapshot(): Observable<RhSymbolMeta[]>
```

### 3. Extend `RhAgentTriageStore`

`src/app/features/rh-agent/rh-agent-triage.store.ts`

- Add `persistedDecisionsLoaded` signal for loading state.
- `statuses` map keys become `symbol_date` or a nested `Record<symbol, Record<date, status>>`.
- On init, load the current market date's decisions (and optionally the last N days) into `statuses`.
- `setStatus(symbol, status)` writes through the service using the store's current `marketDate()`.
- `setGroupStatus(symbols, status)` uses the batch service method.
- Keep the existing `clear()` for local reset, but optionally add `clearDate(date)` to remove local decisions for a date without deleting Firestore (or add a `deleteDate` flag).
- Provide a `setUniverseStatus(symbol, status)` action that delegates to `RhAgentSymbolMetaService` and writes an audit decision for the current date.

### 4. New Store: `RhAgentSymbolMetaStore` (optional)

If the meta state needs to be reactive across components, add a lightweight signal store:

`src/app/features/rh-agent/rh-agent-symbol-meta.store.ts`

- Holds `metaBySymbol: Record<string, RhSymbolMeta>`.
- Provides computed signals: `excludedSymbols`, `preferredSymbols`, `lowTradabilitySymbols`, `etfSymbols`.
- Loads meta for the symbols currently in the grouped review on demand.
- Calls `RhAgentSymbolMetaService` for writes.

### 5. Update `RhAgentGroupStore`

- After loading symbols, enrich each row with its `universeStatus` from `RhAgentSymbolMetaStore` or `RhAgentSymbolMetaService`.
- Provide a `universeFilter` signal: `ALL`, `IN_UNIVERSE`, `EXCLUDED`, `LOW_TRADABILITY`, `WATCHLIST`, `PREFERRED`.
- Default grouped review hides `EXCLUDED` symbols and shows `IN_UNIVERSE` + `PREFERRED` + `WATCHLIST`.
- `LOW_TRADABILITY` symbols are shown in a muted style or collapsed by default.
- Add a toggle to show all universe statuses, including excluded.

### 6. Add `RhTriageDecision` and `RhSymbolMeta` Interfaces

`src/app/features/rh-agent/rh-agent-triage.store.ts` or a new `rh-agent.interfaces.ts`:

```typescript
export interface RhTriageDecision {
  symbol: string;
  date: string;
  status: RhReviewStatus;
  createdAt?: Timestamp;
  updatedAt?: Timestamp;
  userId?: string;
  source?: string;
  runId?: string;
  notes?: string;
  metadata?: Record<string, unknown>;
}

export type UniverseStatus = 'IN_UNIVERSE' | 'EXCLUDED' | 'LOW_TRADABILITY' | 'WATCHLIST' | 'PREFERRED';
export type SymbolType = 'STOCK' | 'ETF' | 'FUTURE' | 'FOREX' | 'CRYPTO' | 'OTHER';

export interface RhSymbolMeta {
  symbol: string;
  universeStatus: UniverseStatus;
  symbolType: SymbolType;
  tags: string[];
  tradeabilityScore?: number;
  notes?: string;
  source?: string;
  createdAt?: Timestamp;
  updatedAt?: Timestamp;
  userId?: string;
  metadata?: Record<string, unknown>;
}
```

### 7. Update All PACR Buttons

Pages/components that already use `triageStore.setStatus()` will continue to work once the store is wired to the service. Verified pages:

- `rh-agent-grouped-review.component` — per-symbol ACR buttons, reset, group-level Promote/Accept, plus new EXCLUDE/LOW_TRADABILITY/WATCH/ELEVATE actions.
- `rh-agent-review.component` — Accept/Reject for promoted symbols; may also add EXCLUDE/LOW_TRADABILITY.
- `rh-agent-order.component` — reads accepted symbols; may expose downgrade (e.g., reject from order) later.
- Future pages only need to inject `RhAgentTriageStore` and call `setStatus`.

### 8. New Reporting / List UI (Phase 2)

Add a page or side panel to list all decisions and manage the universe:

- **PACR Reports:** by status (PROMOTE, ACCEPT, CONSIDER, REJECT, EXCLUDE, LOW_TRADABILITY, WATCH, ELEVATE) and by date.
- **Universe Report:** by `universeStatus` — all excluded, low-tradability, watchlist, preferred, in-universe symbols.
- **Symbol Import:** simple input or CSV upload to add new symbols/ETFs to `rh-agent-symbol-meta` and optionally the agent universe.
- **Columns:** symbol, date, status, universe status, symbol type, tags, source, updatedAt.
- **Export:** copy to clipboard or CSV download.
- **Bulk actions:** multi-select symbols and set EXCLUDE, LOW_TRADABILITY, WATCH, ELEVATE, or re-enable.

Suggested routes:
- `/rh-agent-triage-report` — PACR decisions by status/date.
- `/rh-agent-universe` — universe management and symbol import.

## Backend / Firestore Rules

No Cloud Functions are required for basic persistence if the frontend uses AngularFire with Firestore security rules.

### Firestore Rules

```
match /rh-agent-triage-decisions/{decisionId} {
  allow read: if request.auth != null && request.auth.uid == resource.data.userId;
  allow create: if request.auth != null && request.auth.uid == request.resource.data.userId;
  allow update: if request.auth != null && request.auth.uid == resource.data.userId;
  allow delete: if request.auth != null && request.auth.uid == resource.data.userId;
}

match /rh-agent-symbol-meta/{symbol} {
  allow read: if request.auth != null && request.auth.uid == resource.data.userId;
  allow create: if request.auth != null && request.auth.uid == request.resource.data.userId;
  allow update: if request.auth != null && request.auth.uid == resource.data.userId;
  allow delete: if request.auth != null && request.auth.uid == resource.data.userId;
}
```

If the app is strictly single-user, the rules can be loosened to `request.auth != null`.

## Extensibility Design

- `status` is a string, so adding new statuses (e.g., `WATCH`, `SKIP`, `HOLD`) requires only enum updates and UI mapping.
- `metadata` is a `map<string, any>` for future classifications without a migration:
  - `strategy`: which strategy produced the signal
  - `confidence`: AI or manual confidence score
  - `tags`: user-defined tags
  - `portfolio`: portfolio assignment
- `universeStatus` is a string, so new tiers (e.g., `TIER_1`, `TIER_2`, `REVIEW_QUEUE`) can be added without schema changes.
- `tags` is a string array for open-ended classification.
- A separate `rh-agent-triage-classifications` collection can be added later for multi-designation tracking if a single status field becomes insufficient.
- The symbol meta collection can be used by the agent worker to filter the active universe before generating signals.

## Implementation Phases

### Phase 1: Schema & Service ✅ Complete
1. ✅ Add `RhTriageDecision` and `RhSymbolMeta` interfaces.
2. ✅ Create `RhAgentTriageService` with load/set/listen methods.
3. ✅ Create `RhAgentSymbolMetaService` for universe management.
4. ⏳ Add Firestore rules and indexes for both collections.
5. Unit-test services with Firestore emulator (optional).

### Phase 2: Store Wiring ✅ Complete
1. ✅ Update `RhAgentTriageStore` to load decisions on init and write-through to Firestore.
2. ✅ Add `RhAgentSymbolMetaStore` (or integrate into `RhAgentTriageStore`) for universe state.
3. ✅ Keep status in memory for all dates; do not auto-clear on date changes.
4. ✅ Add loading/error states.

### Phase 3: Grouped Review Integration ✅ Complete
1. ✅ Update `RhAgentGroupStore` to load and apply `universeStatus` to each row.
2. ✅ Add universe filter toggles: default hides `EXCLUDED`, shows `LOW_TRADABILITY` muted.
3. ✅ Add new PACR actions: EXCLUDE, LOW_TRADABILITY, WATCH, ELEVATE.
4. ✅ Add visual indicators for universe status (e.g., dim excluded, badge for ETF, etc.).

### Phase 4: Cross-Page Verification ✅ Complete
1. ✅ Verify grouped review buttons persist and reload correctly.
2. ✅ Verify review page promoted symbols read from the same persisted store.
3. ✅ Verify order page accepted symbols reflect persisted ACCEPT decisions.
4. ⏳ Verify excluded symbols do not appear in agent runs after the worker reads the meta collection.

### Phase 5: Universe & Import UI 🔄 Partial
1. ⏳ Build `/rh-agent-universe` page for universe status management and symbol import.
2. ✅ Build `/rh-agent-triage-report` page for PACR reports by status/date.
3. ⏳ Add CSV/text import for new symbols/ETFs.
4. ⏳ Add export (copy/CSV) for both reports.

## Open Questions

Resolved by the current implementation:

1. **Date scope for load:** ✅ Current implementation loads the current market date plus the last 30 days of decisions on startup. Additional ranges are loaded lazily in the report page.
2. **Real-time sync:** ✅ `RhAgentTriageService.listenToAllSymbolMeta()` and `loadDecisionsForDateRange` use `onSnapshot` for real-time updates where needed; grouped review loads once on date change.
3. **Multi-user:** ✅ Current schema includes `userId` on every decision and meta document. The implementation is effectively single-user today; rules can be tightened to `request.auth.uid == resource.data.userId` when multi-user support is required.
4. **Batch writes:** ✅ Group-level actions use `writeBatch` from AngularFire in the frontend (`setDecisionsBatch`). This is sufficient for manual trading volume; a Cloud Function can be added if groups exceed 500 symbols.
5. **Soft delete:** ✅ Resetting a status writes `status: PENDING` rather than deleting the document, preserving the audit trail.
6. **Universe vs. daily decision:** ✅ `EXCLUDE`/`LOW_TRADABILITY` in the grouped review writes both a daily decision (audit trail) and updates `rh-agent-symbol-meta` (persistent universe state).
7. **Agent worker filtering:** ⏳ Not implemented yet. The worker does not currently read `rh-agent-symbol-meta` to skip `EXCLUDED` symbols during nightly runs.
8. **Initial universe migration:** ✅ `rh-agent-symbol-meta` records are created on demand when a user first changes a symbol's universe status; there is no bulk migration.

## Recommended Default Decisions

- Keep the document with `status: PENDING` when reset, rather than deleting it. This preserves an audit trail and simplifies "all PENDING" reports.
- Load the current market date plus the previous 30 days of decisions on startup; load additional ranges lazily in the report page.
- Load the entire `rh-agent-symbol-meta` collection on startup (one-time; it is small and changes infrequently).
- Use batched writes for group-level actions up to 500 symbols (Firestore batch limit).
- When a user marks `EXCLUDE` or `LOW_TRADABILITY` in the grouped review, write both the daily decision and the symbol meta update. This gives an audit trail and immediate universe filtering.
- Default grouped review filter: hide `EXCLUDED`, show `LOW_TRADABILITY` muted/collapsed, show `IN_UNIVERSE`, `PREFERRED`, and `WATCHLIST` normally.
