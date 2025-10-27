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

## 6. Relative Strength (RS) Pipeline: Pre- and Post-Close Phases

- Two runs per market day:
  - pre-close: intraday snapshot, used for trading decisions before the bell.
  - post-close: canonical EOD snapshot, used for historical analysis and backtests.
- Trigger: Pub/Sub topic `partner-data-ready`, with attribute `phase: "pre" | "post"`.
- Input Source: SavantAPI Partner Time Series (outbound HTTP GET with Google OIDC).
- Output Destination: Firestore `pairs/{BASE}_{SYMBOL}` document, with separate branches for each phase (`pre` and `post`).

### Subscriber Flow (Cloud Functions v2)

1) Resolve registered pairs (baseline + targets).
2) For each pair:
   - Fetch baseline and target bars from SavantAPI (interval: DAILY).
   - Align series strictly by date string `bars[].d` (drop non-overlaps).
   - Build percent-change arrays:
     - pre: use `ipc` (intraday percent) if available; otherwise derive `(ip - pc) / pc * 100`.
     - post: use `cp` (EOD percent change).
   - Compute RS rank with a 5-day rolling window.
   - Persist to Firestore under the correct phase branch (`pre` or `post`).
3) Update metrics and `seriesUpdatedAt`.

Notes:
- Identity: default SA `rel-str-partner-caller-prod@rel-str.iam.gserviceaccount.com`.
- Audience: `PARTNER_AUDIENCE` (prod URL by default). Use `getIdTokenClient` without OAuth scopes.

### RS Calculation (Canonical)

- Inputs: aligned baseline/target percent-change arrays (units = percent).
- Window: 5 days.
- Algorithm:
  - For each day i ≥ 4, form 5-length windows for baseline and target.
  - Evaluate all 32 comparison matrices (00000..11111) by summing the appropriate series values per matrix bit.
  - Sort sums ascending; `rank = (position("11111") + 1) / 32`.
- Edge cases:
  - If fewer than 5 aligned points: skip rank emission for that day.

### Backfill

- Separate function to compute post-close RS for the last N days for all registered pairs.

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
* **Risks:** Registry churn (frequent pair add/removes) increases write ops; ensure idempotent callables and debounce UI submissions. Indexes must support common queries (latest, last-30, signals feeds).

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