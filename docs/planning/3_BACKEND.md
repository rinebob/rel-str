> **Transition Note:** This document was originally authored for a **daily-only RS model** and predates multi-interval RS, Signals Activity, and the unified ingestion engine. See `MULTI_INTERVAL_RS_TRANSITION.md`, `UNIFIED_INGESTION_ENGINE.md`, and `RS_SIGNAL_HISTORY.md` for the current multi-interval design. This file is still useful for high-level architecture, but many implementation details are **legacy**.

> In addition, live/backfill ingestion has moved away from symbol-driven or Alpha Vantage-based pipelines toward a **unified, run-driven ingestion engine** that runs once per trading day in response to the **universe-ready `partner-data-ready` v1 message** from Savant (attributes `runType = "ts-post-all-intervals"`, `phase = "post"`). See `docs/partner/rs-partner-integration.md` and `RS_ARCHIVE_BACKFILL.md` for the current ingestion and archive/backfill model.

# Backend Documentation - Relative Strength Heatmap (MVP) - RS-Only

## 1. Introduction

This backend runs on Firebase/Google Cloud and focuses on computing and serving Relative Strength (RS) values and derived signals. We do not persist OHLCV data in Firestore; price/volume come from SavantAPI on-demand for charting/backtests. Storage is pair-centric: `${BASELINE}_${SYMBOL}`. RS is computed only for pairs that are explicitly registered (pair registry), not for the cross-product of symbols × baselines.

## 2. Technology Stack

* **Platform:** Firebase & GCP
* **Compute:** Firebase Cloud Functions (TypeScript)
* **Database:** Firestore (RS-only series, signals, small mirrors, and a pair registry)
* **Auth:** Firebase Authentication (future), Google OIDC (server-to-server)
* **Scheduler:** Cloud Scheduler for pre/post-close runs
* **Secrets:** Firebase env config / Secret Manager
* **External APIs:**
  * Savant Partner Time Series API (read-only OHLCV for on-demand compute and charts)
  * Payment gateway (future)

## 3. Core Features (MVP)

* **Pair Registry (Source of Truth):**
  * `pair-registry/{BASE}-{SYMBOL}` documents represent the set of pairs to maintain.
  * Populated/updated via callables invoked by the UI (e.g., `SelectStockPanel`) when users create or modify pair lists.
  * The scheduler reads the registry to know which pairs to compute each run.

* **RS Computation (Scheduled / Ingestion Engine):**
* For each pair in `pair-registry`, compute pre-close and post-close RS across **multiple intervals**.
* Persist RS history into per-interval archives:
  * DAILY: `pairs-data/{BASE}-{SYMBOL}/archive-YYYY/{YYMMDD}` (e.g., `/pairs-data/QQQ-AAPL/archive-2024/241004`) including `pre?` and `post?` blocks.
  * WEEKLY: `pairs-data/{BASE}-{SYMBOL}/archive-weekly-YYYY/{YYMMDD}`.
  * MONTHLY: `pairs-data/{BASE}-{SYMBOL}/archive-monthly-YYYY/{YYMMDD}`.
* Maintain per-pair latest mirrors (e.g. `latestDaily`, `latestWeekly`, `latestMonthly`) on `pairs-data/{PAIR}` sourced from these archives.
* In the current design, this work is owned by a **unified, run-driven ingestion engine** that runs once per trading day in response to the universe-ready `partner-data-ready` v1 message (see `UNIFIED_INGESTION_ENGINE.md` and `docs/partner/rs-partner-integration.md`).

* **On-demand RS for Non-Registered or Ad-hoc Baselines:**
  * For ad-hoc requests, compute RS transiently (no Firestore writes) and optionally hydrate a short-lived cache `rs-cache` to accelerate repeats.

* **User Data Provisioning (Callables):**
  * `GetHeatmapData`: Given a baseline and symbol list, batch-read `pairs-data/{BASE}-{SYMBOL}.latest`.
  * `GetPairRSData`: Given `(base, symbol, from, to, thresholds?)`, return RS series and transient signals (if thresholds given); fetch OHLCV from SavantAPI on-demand for charting.
  * `QueryPairsByThreshold`: Server-side filter pairs by `latest.post.rs` (or `pre`) with rate limiting.
  * `GetAppSchedule`: Expose `nextScheduledFetch`, `rsLookbackDays`, and `activeBaselines`.
  * `ValidateTickerSymbol`: Validate symbol against supported list.
  * `GetSectorConstituents`: Return the latest constituents for a given sector ETF (e.g., XLF, XLK, XLY). Source can be a cached Firestore collection (`sectors`) or partner API; callable normalizes and returns `{ baseline: string, members: string[], updatedAt: number }`.

* **Pair List Management (Callables):**
  * `RegisterPairs({ listId, baseline, symbols[] })`: Upserts `pair-registry/{BASE}-{SYMBOL}` for each symbol; increments reference counters if tracked.
  * `UnregisterPairs({ listId, baseline, symbols[] })`: Decrements counters and prunes registry entries with zero references.
  * Notes: This supports a many-users-to-one-pair model. Actual per-user lists can be persisted later; MVP can operate with anonymous list ids if user accounts are deferred.

* **Admin (Restricted):**
  * `TriggerScheduledRun`: Manually trigger RS computation across the current registry.
  * `UpdateBaselineSet`: Update `activeBaselines` in `appConfig`.
  * `backfillSignalsHistory`: Admin-protected HTTP function to compute post-close RS signals for days in `[from,to]` for all pairs enumerated from `pair-registry`. Auth via `Authorization: Bearer local-admin`.

## 4. Architecture & Structure

* **Serverless First:** Event-driven/scheduled compute via Cloud Functions.
* **Pair-Centric Storage:** RS series and canonical signals are stored at `pairs-data/{BASE}-{SYMBOL}` with subcollections including `signals` and multi-interval **Signals Activity** mirrors; positions live under `positions/*`. No OHLCV is persisted in Firestore; price/volume come from SavantAPI.
* **Registry-driven Compute:** Scheduler queries `pair-registry` to enumerate pairs for the current run; avoids meaningless baseline–symbol combinations.
* **External API Integration:** Only backend calls SavantAPI; Angular never calls partner endpoints directly.
* **Error Handling & Logging:** Robust error handling with Cloud Logging and retries for transient upstream issues.
* **Native-first:** Prefer native TS/Node for performance/clarity.
* **Sector Constituents Cache:** An optional Firestore cache (`sectors/{ETF}`) or `appConfig.sectorConfigs` stores canonical constituent lists with `updatedAt`; `GetSectorConstituents` serves clients and may refresh the cache from an upstream source.

* **Directory Structure for functions/src (legacy sketch – superseded by CFSTR):**
  * This was an early high-level proposal kept for historical context. For the **current target Cloud Functions structure**, see the **CFSTR** effort below and `docs/implementations/RS-BE-MAINT-CFSTR-2601-01_cloud-functions-structure-and-refactor.md`.
  * Original sketch (no longer authoritative):

    ```
    functions/src/
    ├── callables/           # User-facing callable functions (e.g., GetHeatmapData, GetPairRSData, GetBacktestResults, RegisterPairs/UnregisterPairs)
    │   ├── rs-data.ts       # Heatmap and pair RS data callables
    │   ├── backtest.ts      # GetBacktestResults and presets
    │   ├── registry.ts      # RegisterPairs, UnregisterPairs
    │   └── sectors.ts       # GetSectorConstituents
    ├── webhooks/            # Webhook handlers (e.g., Partner Data-Ready, payment webhooks)
    │   ├── partner-webhooks.ts  # Data-ready webhook and Pub/Sub
    │   └── payment-webhooks.ts  # Payment processing webhooks
    ├── admin/               # Admin-only callables
    │   ├── scheduler.ts     # TriggerScheduledRun, UpdateBaselineSet
    │   └── config.ts        # Admin configuration functions
    ├── utils/               # Shared utilities
    │   ├── auth-utils.ts    # OIDC verification, allowlisting
    │   ├── rs-calc.ts       # RS computation logic
    │   └── validation.ts    # Input validation helpers
    └── services/            # Core services and schedulers
        ├── scheduler.ts     # RS computation scheduler
        └── registry.ts      # Pair registry management
    ```
  * This organization aligns with the RS-only backend focus, grouping by responsibility for maintainability.

### 4.1 Implementation Efforts (Cloud Functions Structure – CFSTR)

- **Code**: `CFSTR` – Cloud Functions directory structure & organization
- **Efforts**:
  - `RS-BE-MAINT-CFSTR-2601-01` – Cloud Functions filesystem refactor and RS/partner separation
    - Scope: document the current `functions/src` layout, design a target structure that separates partner integration, RS domain logic, jobs, and admin entrypoints, and define a migration plan. New RS job-pipeline code (e.g., FRBARR) should adopt the target structure immediately, while existing `webhooks`-centric code is migrated incrementally in a follow-up MAINT effort.

## 5. Key Technical Considerations

* **TypeScript Contracts & Strong Typing (Functions):**
  * All shared schemas (Firestore docs such as `pairs-data`, `signals`, `positions`, and all callable inputs/outputs) **must** be represented by exported `interface`/`type` declarations under `functions/src/types/*`.
  * **Prohibited patterns (BE):**
    * `const v = d.data() as any;` or `const doc = { ... } as any;` for anything written to or read from Firestore.
    * Inline object literals used as de-facto schemas for Firestore documents or callable payloads.
    * Using plain `Record<string, any>` where a concrete interface can be declared.
  * Root writers/readers (e.g., `positions-manager.ts`, RS writers, signal history callables) must:
    * Import and use the canonical interfaces from `functions/src/types/*`.
    * Keep those interfaces in sync with `docs/planning/5_DATABASE_SCHEMA.md` and update the schema docs whenever the contract changes.
  * Backend contracts and frontend contracts must be explicitly aligned:
    * Functions expose TS types in `functions/src/types/*`.
    * Frontend imports or mirrors these contracts in `src/app/core/models/*.types.ts` using `Pick`/`Omit`/`extends` rather than redefining shapes.
  * Any new collection or callable added to the backend **must** include:
    * A documented schema in `5_DATABASE_SCHEMA.md`.
    * A matching interface in `functions/src/types/*`.
    * No usage of implicit `any` in the corresponding function implementation.

* **Data Model:**
  * Combined per-day RS documents hold both `pre` and `post` values: `{ t, pre?:{rs,at}, post?:{rs,at} }`.
  * Separate `signals` collection for easy feeds (`orderBy t`, filter by `type`).
  * `pair-registry` is the single source for which pairs are maintained by the scheduler; include fields like `{ baseline, symbol, createdAt, refCount }`.
  * **Canonical vs Intraday signals:**
    * Canonical trading decisions (signals and positions) are based **only on post-close (daily adjusted) RS** for all days, including both historical backfill and live runs.
    * Intraday RS series may be persisted for UX and inspection, but **intraday signal decisions are not currently persisted** as `opens`/`closes` and are not used when computing canonical position history or PnL.
    * In the future, if we persist intraday signals, they must live in a clearly separate structure (e.g. `intradaySignals`) and remain excluded from canonical analytics.
  * **Positions & Price Timeline (canonical backend model):**
    * Positions are modeled as a **timeline of price/RS samples**, not three ad-hoc buckets of `entry*`, `current*`, and `exit*` fields.
    * A shared `PriceDatum` interface represents a single price snapshot at a point in time:
      * `role: 'entry' | 'update' | 'exit'` — implemented as a `PriceDatumRole` enum in `functions/src/types/signal.types.ts`.
      * `day: string` — trading day in `YYYY-MM-DD` (ET-aligned).
      * `timestamp: number` — epoch ms for the sample (canonical time primitive; ISO strings can always be derived when needed).
      * `price: number` — target price at this sample.
      * `rs?: number` — RS value at this sample.
      * `source?: RsSourceEnum` — reuses the existing `RsSourceEnum` (`PRE` and `POST`); **`PRE` covers all intraday/pre-close samples**.
      * `pnl: number` — absolute PnL vs the original entry at this moment.
      * `pct: number` — percentage return vs the original entry at this moment.
    * **Entry samples** must always have `pnl = 0` and `pct = 0` so downstream code can rely on a consistent contract (no special cases for missing values).
    * `BePositionDoc` (declared in `functions/src/types/position.types.ts`) is the canonical root positions contract and is defined in terms of this price timeline:
      * Identity & routing:
        * `positionId: string` — canonical id used across FE/BE.
        * `pair: string`, `baseline: string`, `symbol: string` — routing metadata.
        * `direction: RsDirectionEnum` — LONG/SHORT enum reused from RS contracts.
        * `status: RsPositionStatus` — `'open' | 'closed'` (enum).
      * **Price timeline:**
        * `entry: PriceDatum` — role `ENTRY`; the canonical opening sample.
        * `updates: PriceDatum[]` — zero or more role `UPDATE` samples (intraday/pre-close or intermediate snapshots).
        * `exit?: PriceDatum` — optional role `EXIT` sample when the position is closed.
      * **Aggregated PnL (position-level):**
        * `netPnL?: number` — final realized PnL at close (usually mirrors `exit.pnl`).
        * `netPercentReturn?: number` — final realized percent return (usually mirrors `exit.pct`).
      * We **do not** duplicate `lastPrice`/`lastRs`/`lastTimestamp` fields; the most recent state is always the last element of `updates` or the `exit` sample if present.
      * We intentionally **omit `createdAt`/`updatedAt` from the contract**; lifecycle timing is derived from `entry.timestamp` and `exit.timestamp`, and Firestore system timestamps can be inspected separately when needed.

* **Scheduling Reliability:**
  * Pre/post-close cadence. Update `appConfig.nextScheduledFetch` and monitor execution latency.
* **Performance Optimization:**
  * Batch writes per baseline where sensible. Consider min instances for hot callables.
* **Security:**
  * Firestore writes only via Admin SDK in functions. Client SDK has read-only access to RS and signals. Registry mutations via authenticated callables.
* **Scalability:**
  * Registry ensures we compute only valuable pairs. Popular pairs are computed once and shared across many users’ lists.
  * Sector dropdown generates many pairs rapidly (ETF × constituents). Use `RegisterPairs` in bulk only when the user saves the sector list; otherwise operate ad hoc without writes.

## 6. Relative Strength (RS) Pipeline: Pre- and Post-Close Phases

- Two runs per market day:
  - **PRE** (pre-close): intraday snapshot, used for trading decisions before the bell.
  - **POST** (post-close): canonical EOD snapshot, used for historical analysis, backtests, and canonical signals.
- Trigger: Pub/Sub topic `partner-data-ready`, with attribute `phase: "pre" | "post"`.
- Input Source: SavantAPI Partner Time Series (outbound HTTP GET with Google OIDC).
- Output Destination: Firestore `pairs-data/{BASE}-{SYMBOL}` document plus per-interval archives:
  - `pairs-data/{PAIR}/archive-YYYY/{YYMMDD}` (DAILY, `pre`/`post` branches).
  - `pairs-data/{PAIR}/archive-weekly-YYYY/{YYMMDD}` (WEEKLY RS).
  - `pairs-data/{PAIR}/archive-monthly-YYYY/{YYMMDD}` (MONTHLY RS).
  - All downstream consumers (signals, positions, activity, timelines) treat these archive `rsRaw`/`rsNorm` values as the single source of truth for RS.

### Subscriber Flow (Cloud Functions v2)

1) Resolve registered pairs (baseline + targets) from `pair-registry/*`.
2) For each pair:
   - Fetch baseline and target bars from SavantAPI for DAILY/WEEKLY/MONTHLY intervals.
   - Align series strictly by date string `bars[].d` (drop non-overlaps).
   - Build percent-change arrays per phase:
     - PRE: use intraday fields (`ip`/`ipc`) when available, otherwise derive from open/prev-close.
     - POST: use EOD percent change (`cp`) on split-adjusted `c` (see data-normalization docs).
   - Compute RS rank with the canonical 5-day rolling-window algorithm.
   - Persist RS into the appropriate archive collections and `latest*` mirrors via `writeUnifiedSeries`.
3) Update metrics and `seriesUpdatedAt` on the pair doc.
4) RsSignalHistory + Activity processing:
   - **Canonical engine (multi-interval, shared by backfill and realtime POST):**
     - `runCanonicalRsEngineForPair` loads archive RS samples (DAILY/WEEKLY/MONTHLY) and runs the shared RS engine `detectRsEvents(samples, thresholds)` per interval.
     - Threshold crossings are turned into `RsWriteEvent[]` (OPEN/CLOSE events with `rsRawYesterday/rsRawToday`, `rsNormYesterday/rsNormToday`, `price`, `positionId`, `interval`, `direction`).
     - All `RsWriteEvent`s are consumed by `applyRsEventsForPair`, which is the **single canonical writer** for:
       - Per-pair signal docs under `pairs-data/{PAIR}/signals/{YYYY}/opens|closes/{signalId}`.
       - Root positions under `positions/{open|YYYY-closed}/items/{positionId}` (including entry/exit timeline updates).
     - Multi-interval Signals Activity (D/W/M) is derived from these same writes via the shared helper `generateActivityFromWrites`:
       - Groups writes by `(interval, positionId)`.
       - Derives `openDay`/`closeDay` for each position.
       - Walks archive RS samples between those days and emits `ActivityEvent` rows per day:
         - `OPEN` on the open day.
         - `HOLD` on intermediate days where the interval has a sample.
         - `CLOSE` on the close day (if the position is closed).
       - These events are written to per-pair and root mirrors under `signals-activity/*`.
   - **PRE vs POST responsibilities:**
     - PRE (intraday / pre-close):
       - No canonical signals or new positions are created/closed.
       - Uses archive `pre` RS for today plus canonical history to:
         - Update open-position snapshot fields via `updateOpenPositionsForPair` (`currentPrice`, `currentChange`, `currentPctChange`, `currentRs`, `lastUpdateDay`).
         - Append `PriceDatum{ role: 'update', source: 'pre' }` to each open position’s `updates[]` timeline via `appendOpenPositionsTimelineForPair` / `appendRootPositionTimelineUpdate`.
     - POST (canonical signals + EOD updates):
       - Uses canonical POST RS from archives for today and prior days.
       - Runs the multi-interval canonical engine as described above to produce:
         - `RsWriteEvent[]` → `applyRsEventsForPair` → canonical per-pair signals and root positions (entry/exit).
         - Multi-interval `ActivityEvent[]` (DAILY/WEEKLY/MONTHLY) via `generateActivityFromWrites`.
       - Updates open-position snapshots for today (price + RS) and appends a POST `PriceDatum{ role: 'update', source: 'post' }` for positions that remain open.
   - App PnL (`netPnL` / `netPercentReturn` on positions) and user Actual PnL remain decoupled:
     - App-level PnL is derived from canonical RS-driven prices and stored only on the position documents.
     - User Actual PnL is stored under `users/{uid}/trades/{positionId}` and is never written by the backend into `pairs-data/*` or `positions/*`.

### RS Calculation (Canonical)

- Inputs: aligned baseline/target percent-change arrays (units = percent).
- Window: 5 days.
- Algorithm:
  - For each day i ≥ 4, form 5-length windows for baseline and target.
  - Evaluate all 32 comparison matrices (00000..11111) by summing the appropriate series values per matrix bit.
  - Sort sums ascending; `rank = (position("11111") + 1) / 32`.
- Edge cases:
  - If fewer than 5 aligned points: skip rank emission for that day.

### Backfill (admin)

Admin-protected HTTP function `backfillSignalsHistory` computes post-close RS signals for days in `[from,to]` for all pairs enumerated from `pair-registry`. Auth via `Authorization: Bearer local-admin`.

### Error Handling & Idempotency

- Per-pair failure should not fail the run. Log and continue; track success/failure counts per run ID.
- Upsert by day key. Replace or append the series entry for day D and set `latest` accordingly.

## 7. Third-Party Integrations

* **Savant Partner Time Series API:** On-demand OHLCV reads for RS compute and charting data. Auth via Google OIDC; never called by frontend.
* **Payment Gateway:** Future subscription handling.

## 8. Testing

* **Unit:** RS calculation utilities, signal detection, callable input validation.
* **Integration:** Emulators + mocked SavantAPI responses. Registry → scheduler → RS write-path happy path and edge cases.
* **CI:** GitHub Actions runs tests on each change.

## 9. Assumptions and Risks

* **Assumptions:** A registry-driven approach aligns with product UX (baseline + selected symbols). `activeBaselines` governs canonical signal persistence. Angular consumes RS/signals via callables and Firestore reads only.
* **Risks:** Registry churn (frequent pair add/removes) increases write ops; ensure idempotent callables and debounce UI submissions. Indexes must support common queries (latest, signals feeds).

## 10. Recent Changes (2025-10-27)

- Functions v2 init:
  - `functions/src/init.ts` sets `region: us-central1` for all v2 functions.
  - `serviceAccount` is applied only in production. In emulator, we omit it to let ADC + impersonation work locally.
- Partner proxy + callable:
  - `getTrackedSymbols` (onCall) fetches SavantAPI tracked symbols using a Google OIDC ID token minted via IAM Credentials (`generateIdToken`), audience set to the partner function URL.
  - Normalizes upstream payload to a simple `{ items: TrackedSymbolDTO[]; cached: boolean; updatedAt }`.
  - Best-effort cache at `app/trackedSymbolsCache` with `updatedAt` (serverTimestamp) and TTL from client (60–3600s).
- Minimal env required (in `functions/.env.rel-str`):
  - `PARTNER_TRACKED_SYMBOLS_URL`, `PARTNER_TS_URL` (full URLs)
  - `PARTNER_CALLER_SA` (prod SA email)
  - `GOOGLE_IMPERSONATE_SERVICE_ACCOUNT` (same SA email for emulator impersonation)
  - Optional: `PARTNER_TRACKED_SYMBOLS_AUDIENCE`, `PARTNER_TS_AUDIENCE` (default to URL if omitted)
- Emulator workflow (no manual shell exports needed):
  - `gcloud auth application-default login` and `gcloud config set project rel-str`.
  - Grant your user `roles/iam.serviceAccountTokenCreator` on `rel-str-partner-caller-prod@rel-str.iam.gserviceaccount.com`.
  - Start emulators; the runtime impersonates the SA and calls prod partner endpoints.
- Diagnostics:
  - Upstream errors log audience and caller SA. ETIMEDOUT indicates local network/proxy issues to `oauth2.googleapis.com` or to the partner URL.

## 11. Constants and Contracts (BE)

- Constants module: `functions/src/config/constants.ts`
  - `DEFAULT_PARTNER_CALLER_SA`, `OAUTH_CLOUD_PLATFORM_SCOPE`, `IAM_CREDENTIALS_BASE_URL`, `IAM_SERVICE_ACCOUNTS_PATH`, `IamCredentialsMethod`
- Partner contracts/types: `functions/src/types/partner.ts`
  - `TrackedSymbolDTO`, `GetTrackedSymbolsResponse`, `PartnerEndpointPath`
- App Check note:
  - Firebase callable verification logs include `verifications.app` and `verifications.auth`. `app` may be `MISSING` in dev if App Check isn’t initialized/enforced; this is expected unless enforcement is enabled.

## 12. RsSignalHistory Callables

- `GetPairSignals({ baseline, symbol, limit?, source?, type? })`
  - Returns canonical signals from `pairs-data/{PAIR}/signals/*`.
- `GetDailySignals({ day?, fromDay?, toDay?, limitDays?, all? })` (legacy)
  - Historical daily board helper; new Decision Board–style UIs should instead consume **Signals Activity** from `signals-activity/{YYYY}/days/{YYYY-MM-DD}` (root) and `pairs-data/{PAIR}/signals-activity/{YYYY}/days/{YYYY-MM-DD}` (per pair), filtered by interval/state as needed.
- `GetPnLSummary({ from, to, type:'app'|'actual', uid? })`
  - Returns App PnL (backend summaries) or Actual PnL (per-user overlays).
- `GetPositionWithActuals({ positionId, uid? })` and `GetPairSignalsWithActuals({ baseline, symbol, uid?, limit?, fromDay?, toDay? })`
  - Return merged canonical positions with user overlays when provided.
- `UpdatePositionActuals({ positionId, executed, openedPrice?, closedPrice?, openedTime?, closedTime?, noteOpen?, noteClose? })`
  - Auth-required; upserts `users/{uid}/trades/{positionId}`.

## 13. Identity & Integration Notes (RsSignalHistory)

- Functions run under `rel-str-partner-caller-prod@rel-str.iam.gserviceaccount.com` (configurable via `PARTNER_CALLER_SA`).
- We consume SavantAPI; subscribe to `partner-data-ready` Pub/Sub; no inbound partner webhooks in FE.

## 14. Data Normalization & Split Handling Strategy

This section documents our policy on consuming market data from the Partner Time Series API.

### 14.1 Philosophy: Split-Adjusted, Dividend-Excluded
We prioritize **split-adjusted** historical values for the Close (`c`) price. This ensures that the price series is continuous and free of artificial gaps caused by stock splits (e.g., a 4:1 split does *not* show a 75% drop). This continuity is essential for accurate Relative Strength calculations and long-term trend analysis.

### 14.2 Partner Field Usage
- **`c` (Close):** STRICTLY USED. We request data such that this field represents the **split-adjusted** close price. It serves as the source of truth for all RS calculations, signal generation, and chart visualizations.
- **`ac` (Adjusted Close):** STRICTLY IGNORED.
  - **Reasoning:** The `ac` field typically includes adjustments for both splits *and dividends*. While useful for Total Return analysis, dividend adjustments distort technical price levels (candles) and do not have corresponding adjusted Open/High/Low values provided by the API. Using `ac` would result in distorted candle shapes.
  - **Conclusion:** By using the split-adjusted `c` (and corresponding O/H/L), we maintain correct candle proportions while avoiding split-induced discontinuities.

### 14.3 Implications
- **No Price Gaps:** Long-term charts will be smooth across split events.
- **Technical Accuracy:** Candles remain proportional because we avoid the dividend-adjustment scaling that is present in `ac`.
- **Request Parameters:** We explicitly request split-adjusted data (e.g., via `adjusted=true` or equivalent provider defaults) to ensure the `c` field is back-adjusted for splits.