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
  * `pairRegistry/{BASE}_{SYMBOL}` documents represent the set of pairs to maintain.
  * Populated/updated via callables invoked by the UI (e.g., `SelectStockPanel`) when users create or modify pair lists.
  * The scheduler reads the registry to know which pairs to compute each run.

* **RS Computation (Scheduled):**
  * For each pair in `pairRegistry`, compute pre-close and post-close RS.
  * Write/update combined per-day RS doc under `pairs/{BASE}_{SYMBOL}/rs/{t}` with `{ pre?, post? }`.
  * Update `pairs/{PAIR}.latest` and optionally maintain `latest30` rolling window.
  * For pairs where canonical signals are desired (e.g., baseline included in `appConfig.activeBaselines`), generate buy/sell signals using `appConfig.defaultThresholds` and write to `pairs/{PAIR}/signals` + update `signalsSummary`.

* **On-demand RS for Non-Registered or Ad-hoc Baselines:**
  * For ad-hoc requests, compute RS transiently (no Firestore writes) and optionally hydrate a short-lived cache `rs-cache` to accelerate repeats.

* **User Data Provisioning (Callables):**
  * `GetHeatmapData`: Given a baseline and symbol list, batch-read `pairs/{BASE}_{SYMBOL}.latest` (and optionally `latest30`).
  * `GetPairRSData`: Given `(base, symbol, from, to, thresholds?)`, return RS series and transient signals (if thresholds given); fetch OHLCV from SavantAPI on-demand for charting.
  * `QueryPairsByThreshold`: Server-side filter pairs by `latest.post.rs` (or `pre`) with rate limiting.
  * `GetAppSchedule`: Expose `nextScheduledFetch`, `rsLookbackDays`, and `activeBaselines`.
  * `ValidateTickerSymbol`: Validate symbol against supported list.
  * `GetSectorConstituents`: Return the latest constituents for a given sector ETF (e.g., XLF, XLK, XLY). Source can be a cached Firestore collection (`sectors`) or partner API; callable normalizes and returns `{ baseline: string, members: string[], updatedAt: number }`.

* **Pair List Management (Callables):**
  * `RegisterPairs({ listId, baseline, symbols[] })`: Upserts `pairRegistry/{BASE}_{SYMBOL}` for each symbol; increments reference counters if tracked.
  * `UnregisterPairs({ listId, baseline, symbols[] })`: Decrements counters and prunes registry entries with zero references.
  * Notes: This supports a many-users-to-one-pair model. Actual per-user lists can be persisted later; MVP can operate with anonymous list ids if user accounts are deferred.

* **Admin (Restricted):**
  * `TriggerScheduledRun`: Manually trigger RS computation across the current registry.
  * `UpdateBaselineSet`: Update `activeBaselines` in `appConfig`.

## 4. Architecture & Structure

* **Serverless First:** Event-driven/scheduled compute via Cloud Functions.
* **Pair-Centric Storage:** RS series and signals are stored at `pairs/{BASE}_{SYMBOL}` with subcollections `rs` and `signals`. No OHLCV persisted.
* **Registry-driven Compute:** Scheduler queries `pairRegistry` to enumerate pairs for the current run; avoids meaningless baseline–symbol combinations.
* **External API Integration:** Only backend calls SavantAPI; Angular never calls partner endpoints directly.
* **Error Handling & Logging:** Robust error handling with Cloud Logging and retries for transient upstream issues.
* **Native-first:** Prefer native TS/Node for performance/clarity.
* **Sector Constituents Cache:** An optional Firestore cache (`sectors/{ETF}`) or `appConfig.sectorConfigs` stores canonical constituent lists with `updatedAt`; `GetSectorConstituents` serves clients and may refresh the cache from an upstream source.

* **Directory Structure for functions/src:**
  * Based on the documented callables, webhooks, admin functions, and utilities:
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

## 5. Key Technical Considerations

* **Data Model:**
  * Combined per-day RS documents hold both `pre` and `post` values: `{ t, pre?:{rs,at}, post?:{rs,at} }`.
  * Optional `latest30` mirror for O(1) small reads of rolling window; otherwise query `orderBy t desc limit 30`.
  * Separate `signals` collection for easy feeds (`orderBy t`, filter by `type`).
  * `pairRegistry` is the single source for which pairs are maintained by the scheduler; include fields like `{ baseline, symbol, createdAt, refCount }`.
* **Scheduling Reliability:**
  * Pre/post-close cadence. Update `appConfig.nextScheduledFetch` and monitor execution latency.
* **Performance Optimization:**
  * Batch writes per baseline where sensible. Consider min instances for hot callables.
* **Security:**
  * Firestore writes only via Admin SDK in functions. Client SDK has read-only access to RS and signals. Registry mutations via authenticated callables.
* **Scalability:**
  * Registry ensures we compute only valuable pairs. Popular pairs are computed once and shared across many users’ lists.
  * Sector dropdown generates many pairs rapidly (ETF × constituents). Use `RegisterPairs` in bulk only when the user saves the sector list; otherwise operate ad hoc without writes.

## 6. Third-Party Integrations

* **Savant Partner Time Series API:** On-demand OHLCV reads for RS compute and charting data. Auth via Google OIDC; never called by frontend.
* **Payment Gateway:** Future subscription handling.

## 7. Testing

* **Unit:** RS calculation utilities, signal detection, callable input validation.
* **Integration:** Emulators + mocked SavantAPI responses. Registry → scheduler → RS write-path happy path and edge cases.
* **CI:** GitHub Actions runs tests on each change.

## 8. Assumptions and Risks

* **Assumptions:** A registry-driven approach aligns with product UX (baseline + selected symbols). `activeBaselines` governs canonical signal persistence. Angular consumes RS/signals via callables and Firestore reads only.
* **Risks:** Registry churn (frequent pair add/removes) increases write ops; ensure idempotent callables and debounce UI submissions. Indexes must support common queries (latest, last-30, signals feeds).