# API Communication - Relative Strength Heatmap (MVP) - Combined

## 1. Introduction

This document describes the key communication points and data flow between the Angular frontend, core Firebase services (Firestore, Authentication), and Firebase Cloud Functions within the Relative Strength Heatmap (RSH) application's MVP. It outlines how the frontend interacts with backend services and how backend components communicate with each other and external third-party APIs.

## 2. Frontend Interactions via Firebase SDKs (Firestore & Authentication)

The frontend will interact directly with Firebase services for user management and personal data storage using the respective Firebase SDKs. These interactions are subject to Firestore Security Rules and Firebase Authentication state.

* **User Authentication & Management:**
    1.  `Signup`: Create a new user account via the Firebase Auth SDK.
    2.  `Login (Email/Password)`: Sign in an existing user using email and password credentials via the Firebase Auth SDK.
    3.  `Login (Google)`: Initiate the Google Sign-In authentication flow via the Firebase Auth SDK.
    4.  `Logout`: Sign out the current authenticated user via the Firebase Auth SDK.
    5.  `ObserveAuthState` (Listener): Maintain a real-time listener on the authentication state using the Firebase Auth SDK to react to login/logout events across the application.
    6.  `SendPasswordResetEmail`: Request a password reset email for a user's account via the Firebase Auth SDK.
    7.  `GetUserProfile`: Retrieve the current user's profile data from their user document in Firestore using the Firebase SDK, with access enforced by Firestore Security Rules ensuring users can only read their own data.
    8.  `UpdateUserProfile`: Save changes to the user's profile data fields (e.g., display name) to their user document in Firestore via the Firebase SDK, enforced by Security Rules allowing users to write only to their own profile.
* **User Preferences & Stock Lists:**
    9.  `GetUserPreferences`: Retrieve user-specific application settings and preferences from their user document in Firestore via the Firebase SDK.
    10. `UpdateUserPreferences`: Save changes to user preferences to their user document in Firestore via the Firebase SDK.
    11. `GetUserStockList`: Retrieve the array of ticker symbols the user has selected to track from their user document in Firestore via the Firebase SDK.
    12. `AddTickerToStockList`: Update the `selectedTickers` array in the user's Firestore document via the Firebase SDK. This action might be triggered after validation of the ticker symbol via a Cloud Function call.
    13. `RemoveTickerFromStockList`: Update the `selectedTickers` array in the user's Firestore document via the Firebase SDK. This is typically triggered after user confirmation.
    14. `GetUserPaymentHistory`: Retrieve documents from the `paymentHistory` subcollection under the user's document in Firestore via the Firebase SDK, with access enforced by Firestore Security Rules ensuring users can only read their own payment history.

## 3. Frontend Interactions via Firebase Cloud Functions

The frontend will interact with Firebase Cloud Functions for logic that requires secure server-side execution, accessing external APIs, or performing complex data operations that are inefficient for direct client-side Firestore queries. These are typically invoked as Callable Cloud Functions.

* **Relative Strength Data & Queries:**
    15. `GetSecurityRSData`: Callable Cloud Function invoked to fetch historical OHLCV data and corresponding calculated RS values for a specific ticker over a defined date range, primarily used for populating the detailed chart view. This function reads data from Firestore.
    16. `GetUserDataForHeatmap`: Callable Cloud Function, triggered efficiently immediately upon user login and potentially when the user's stock list changes, to load the user's selected tickers along with their latest daily RS/OHLCV summary data (`latestData` map) from Firestore for heatmap display. This function is optimized for reading multiple documents efficiently.
    17. `QueryTickersByThreshold`: Callable Cloud Function invoked by the frontend to perform server-side filtering or highlighting of tickers based on user-defined criteria related to their latest RS values (e.g., "show all tickers with RS > 80"). This function reads the relevant latest data from Firestore and applies the filter logic before returning the subset of tickers/data to the frontend. This function will implement explicit backend rate limiting.
    18. `ValidateTickerSymbol`: Callable Cloud Function invoked to validate if a user-entered string (e.g., when adding a ticker to their list) is a recognized and supported ticker symbol within the application's universe, typically by checking against the master symbol list managed on the backend.
* **Pair List Management (Pair Registry):**
  * `RegisterPairs({ listId:string, baseline:string, symbols:string[] })` → `{ registered:string[] }`
    * Upserts `pairRegistry/{BASELINE}_{SYMBOL}` for each symbol; may increment `refCount`.
  * `UnregisterPairs({ listId:string, baseline:string, symbols:string[] })` → `{ unregistered:string[] }`
    * Decrements `refCount` and deletes entries when zero.
  * Used by `SelectStockPanel` to keep the registry aligned with user-created lists of pairs. Popular pairs appear in many lists but are computed once.
* **Signals (Current Run):**
  * `GetCurrentSignals()`
    * Returns the full set of canonical signals produced in the most recent completed RS run (across active baselines).
    * Response:
      ```json
      {
        "runAt": 1736726400000,
        "items": [
          { "baseline": "SPY", "symbol": "MSFT", "t": 1736726400000, "type": "buy", "source": "post", "rs": 78.4 },
          { "baseline": "SPY", "symbol": "NVDA", "t": 1736726400000, "type": "sell", "source": "post", "rs": 62.1 },
          { "baseline": "XLF", "symbol": "BAC", "t": 1736726400000, "type": "buy", "source": "post", "rs": 70.2 }
        ]
      }
      ```
    * Notes:
      - Returns canonical signals (active baselines) written by the scheduler for the latest completed run only; expected list size is small (e.g., <= 50).
      - Frontend performs all filtering client-side (baseline, type, source).
      - Uses the latest completed run id/timestamp recorded by the scheduler (e.g., a `runs` record or companion to `appConfig`).
      - Rate-limited to protect backend and ensure fair usage.
      - Auth: standard app auth (future); for MVP may be public read if policies allow.
* **Partner Endpoint (Server-to-Server ONLY; not called from the Angular app):**
    * HTTPS GET `partnerTimeSeriesV2` (prod): https://partnertimeseriesv2-lsluydmucq-uc.a.run.app
    * Auth: Google OIDC ID token with allowlisted service account emails (env var `ALLOWED_SERVICE_ACCOUNT_EMAILS`).
    * Query params: `symbol` (required), `interval` (DAILY|WEEKLY|MONTHLY), optional `range|from|to|limit`.
    * Purpose: External partner access to normalized time series stored in Firestore. Our app backend reads Firestore directly for app features.
    * **RS pipeline note (2025-12):** although the partner endpoint supports
      `range` and `limit`, the RS backend now **always** calls it with explicit
      `from`/`to` windows only. Legacy sugar parameters such as
      `yearsBack`/`days`/`limit` are deprecated for RS bar fetching and are no
      longer used to determine time ranges anywhere in the RS code path.
* ### Partner Notifications (Data Ready Webhook)
+
+To avoid polling on our side, SavantAPI will notify us when a data load (e.g., daily post-close) is complete.
+
+* Endpoint (Cloud Run, HTTPS): `POST https://<our-cloud-run-host>/partner/data-ready`
+* Authentication:
+  * Preferred: Google OIDC ID token audience bound to the service URL; verify issuer and the calling service account against an allowlist.
+  * Alternative: HMAC signature header `X-Savant-Signature: sha256=...` over the raw body using a shared secret in Secret Manager; verify in code and reject on mismatch.
+* Request payload (JSON):
+  ```json
+  {
+    "runId": "2025-09-11-post",
+    "phase": "post", // or "pre"
+    "intervals": ["DAILY"],
+    "symbolsUpdated": ["AAPL", "MSFT", "NVDA"],
+    "baselines": ["SPY", "XLF", "XLK"],
+    "time": 1736726400000,
+    "notes": "post-close batch complete"
+  }
+  ```
+* Response:
+  * `202 Accepted` on enqueue; processing continues asynchronously.
+  * Idempotent: repeated notifications for the same `runId` are safe.
+* Processing (high level):
+  1. Verify auth/signature and basic schema.
+  2. Record event to `partnerEvents/{runId}` (append log) and `runs/{runId}` (status: received).
+  3. Publish a message to Pub/Sub `rs-data-ready` with payload.
+  4. Subscriber Cloud Function processes the run: compute RS for registered pairs, update `pairs/*/rs`, `pairs/*/latest`, generate canonical signals, update `runs/{runId}` (status: completed, counts).
+* Retries and Idempotency:
+  * Cloud Run returns 2xx only after enqueuing; any 5xx triggers SavantAPI retry.
+  * Deduplicate by `runId`; all writes should be upserts conditioned on `runId` where applicable.
+* Security:
+  * Enforce allowlist of service accounts for OIDC, or verify HMAC.
+  * Rate limit via Cloud Armor (optional) and request size limits.
+  * Log all verification failures with redaction.
* **Payment Processing:**
    19. `InitiatePayment`: Callable Cloud Function invoked to securely initiate a payment flow (e.g., setting up a subscription via Stripe/PayPal). This function interacts with the payment gateway's SDKs/APIs on the backend to create payment intents or checkout sessions and returns necessary information to the frontend to complete the payment process securely.
    20. `ProcessPaymentWebhook`: HTTPS Cloud Function to receive and process webhooks from the payment gateway to confirm payments and update user subscription status.
* **Admin Functions (restricted access):** These functions will have access controls (enforced within the function) limiting execution to users with the 'admin' role.
    21. `TriggerDailyDataFetch`: Callable Cloud Function (admin-only) to manually trigger the backend's daily data fetching process, useful for testing or administrative recovery.
    22. `UpdateUserSubscription`: Callable Cloud Function (admin-only) to manually change a user's subscription status in Firestore.
* **Application Configuration & Schedule Info:**
    23. `GetAppSchedule`: Callable Cloud Function or a direct read from the `appConfig` Firestore document to provide the frontend with information about the next scheduled daily data fetch time, used for the countdown timer.
* **Backtest:**
  * `GetBacktestResults({ baseline:string, symbol:string, interval:'DAILY'|'WEEKLY'|'MONTHLY', from?:number, to?:number, rules:Array<{ id:string, scope:'baseline'|'target'|'both', type:string, params:Record<string, number|string|boolean> }>, thresholds?:{ buy:number, sell:number } })`
    * Returns inputs and computed summary needed for interactive backtesting in the frontend. TA metrics are fetched server-side from SavantAPI (which sources from AV when available).
    * Response:
      ```json
      {
        "baseline": "SPY",
        "symbol": "MSFT",
        "interval": "DAILY",
        "from": 1704067200000,
        "to": 1735603200000,
        "rsSeries": [ { "t": 1712016000000, "rs": 74.2 } ],
        "ohlcv": [ { "t": 1712016000000, "o": 1, "h": 2, "l": 0.5, "c": 1.5, "v": 123456 } ],
        "ta": {
          "EMA20": [ { "t": 1712016000000, "value": 150.2 } ],
          "EMA50": [ { "t": 1712016000000, "value": 148.2 } ],
          "EMA200": [ { "t": 1712016000000, "value": 130.2 } ],
          "RSI": [ { "t": 1712016000000, "value": 52.1 } ]
        },
        "signals": [ { "t": 1712016000000, "type": "buy", "source": "post", "rs": 78.4 } ],
        "metrics": {
          "totalSignals": 42,
          "wins": 24,
          "losses": 18,
          "winPct": 57.14
        }
      }
      ```
    * Notes:
      - TA coverage MVP: EMA(20/50/200), RSI.
      - Default: interval Daily, lookback 1 year; user may choose Weekly/Monthly; max lookback TBD.
      - The callable delivers RS, OHLCV, and TA series so the frontend can apply AND-composed rule combinations interactively without round-trips.
      - SavantAPI TA endpoints are WIP; this callable surfaces TA once available. Frontend never calls partner endpoints directly.
      - Rate-limit to protect upstreams and consider caching.
  * `GetClientSettings({ anonId:string })` → `{ settings: SettingsDTO, updatedAt:number }`
  * `SaveClientSettings({ anonId:string, settings: SettingsDTO })` → `{ ok:true, updatedAt:number }`
  * `SettingsDTO` (example payload):
    ```json
    {
      "timeframe": "DAILY",
      "rsThresholds": { "buy": 70, "sell": 30 },
      "signalScope": "post",
      "backtest": { "interval": "DAILY", "lookbackDays": 365, "autoLoadLastPreset": false },
      "heatmap": { "defaultSort": "latest.post.rs", "baseline": "SPY", "sector": "XLK", "sparklines": true },
      "chart": { "rsPane": false, "decimalPrecision": 2 },
      "appearance": { "theme": "dark", "density": "compact" },
      "performance": { "liveUpdates": true }
    }
    ```
  * Notes:
    - Until Auth is added, the frontend generates/stores a stable `anonId` locally and passes it to associate settings.
    - When Auth arrives, a migration path can copy settings to a per-user document.
    - Input validation enforced server-side; apply rate-limiting/debounce on saves from the frontend.

## Recent Changes (2025-10-27)

- Callable: `getTrackedSymbols`
  - Request: `{ ttlSeconds?: number }` (60–3600; default 600)
  - Response: `GetTrackedSymbolsResponse` (see `functions/src/partner-proxy.ts`)
  - Behavior: reads cache if fresh; otherwise mints an OIDC ID token and calls the partner function URL.
- Environment variables (Functions):
  - `PARTNER_TRACKED_SYMBOLS_URL`, `PARTNER_TS_URL` (function URLs)
  - `PARTNER_CALLER_SA` (prod SA runtime and impersonation target)
  - `GOOGLE_IMPERSONATE_SERVICE_ACCOUNT` (emulator-only to impersonate SA)
  - Optional audiences: default to URL if not provided.
- Authentication model:
  - Emulator uses ADC + impersonation (no hard-coded service account locally).
  - Production functions run under the configured service account.

## 4. Backend Interactions (Cloud Functions)

Firebase Cloud Functions serve as the central point for backend logic and integration with external services. They interact with each other, other Firebase services, and third-party APIs:

* **Stock Data API:** Cloud Functions (specifically the scheduled data fetch function) interact with the configured third-party stock data API (via HTTP client or dedicated SDK) to fetch historical and daily OHLCV data for the master symbol list.
* **Payment Gateway APIs:** Cloud Functions (for `InitiatePayment` and a dedicated webhook handler function) interact with Payment Gateway SDKs/APIs (Stripe/PayPal) to process payments, manage subscriptions, and receive notifications about transaction status.
* **SMS Gateway API (Future):** Future Cloud Functions might interact with an SMS gateway API to send text notifications to users.
* **Firestore:** Cloud Functions use the Firebase Admin SDK to perform trusted server-side reads and writes to Firestore. This is used extensively for saving fetched OHLCV and calculated RS data, updating the `latestData` map, writing historical data, managing user data (like subscription status updates received via webhooks), and reading configuration.
* **Cloud Scheduler:** Google Cloud Scheduler triggers the main data fetch/calculation Cloud Function on a predefined daily schedule.
* **Other Cloud Functions:** Cloud Functions can invoke other Cloud Functions internally if needed, though for MVP, direct invocation or database triggers are more likely patterns.

## 5. Error Handling

A robust error handling strategy is implemented across the stack:

* **Backend (Cloud Functions):**
    * Implement retry logic for external API calls (especially the stock data API) to handle transient network issues or service unavailability.
    * Log detailed technical errors to Google Cloud Logging for monitoring and debugging.
    * When returning errors to the frontend, catch exceptions and return generic, user-friendly error responses via the Callable Function mechanism or HTTP status codes, avoiding exposure of sensitive backend details.
* **Frontend:**
    * Show appropriate loading indicators in the UI while data is being fetched or backend functions are executing.
    * If a backend function invocation or data fetch operation fails completely, display a clear general error message to the user (e.g., "Could not load data, please try again").
    * For data display (especially the heatmap), if data for some individual tickers is unavailable or stale (e.g., the post-close update failed for one ticker), display the most recent available data (even if it's from a previous day or the pre-close value), along with a clear indicator of its specific freshness state per ticker (e.g., timestamp, "Yesterday's Close", "Pre-Close Data"). Avoid showing a generic "error" state for the entire heatmap if only some data is affected. The UI will also support sorting/shading tickers based on data freshness to help users identify stale data easily.

## 6. Rate Limiting

Rate limiting is implemented to protect backend resources and manage costs:

* The primary focus for explicit backend-enforced rate limiting is the `QueryTickersByThreshold` Callable Cloud Function, as this is a user-triggered operation that could potentially be abused or heavily used.
* Firebase services (Authentication, Firestore, Cloud Functions) have built-in quotas and default protections against excessive usage.
* Rate limits imposed by third-party APIs (stock data, payment gateways) must be respected and handled within the Cloud Functions making those calls, often involving retry strategies or queueing.
* The critical daily backend data fetch and calculation process, triggered by Cloud Scheduler, is designed to be prioritized and resilient to ensure data freshness, even if user-triggered queries are being rate-limited.

## 7. Real-Time Updates

Real-time data synchronization is utilized where beneficial for the user experience:

* The frontend uses Firebase Firestore **real-time listeners** on the `latestData` map within the `symbols` collection (or potentially on relevant fields within documents) to automatically update the UI when the backend successfully writes new daily data (specifically the post-close values). This enables real-time updates to the heatmap colors and values as soon as the daily calculation is complete.
* When a user is viewing a detailed chart for a specific ticker, a Firestore listener on that ticker's `latestData` map ensures that the chart display (e.g., the color of the most recent candlestick bar) updates in real-time, and an explicit notification can be shown to the user (e.g., "New data available!") when the daily update for that ticker is received while they are on the page.
* (Future Feature) Real-time notifications to users (e.g., via text message) based on specific RS signals or data availability will be implemented via a Cloud Function that interacts with Firebase Cloud Messaging (FCM) or a third-party SMS provider.

## 8. SavantAPI Usage

### Overview

SavantAPI is a critical partner API providing normalized time series data. Our application consumes this data to compute Relative Strength (RS) values and other metrics.

### Identity and Authentication

* **Role:** We are the consumer. No inbound partner webhooks required for FE; backend subscribes to Pub/Sub and calls Partner Time Series.
* **Identity:** Cloud Functions v2 default service account `rel-str-partner-caller-prod@rel-str.iam.gserviceaccount.com`.
* **Auth:** Google OIDC ID token via `getIdTokenClient(PARTNER_AUDIENCE)` (no OAuth scopes). `PARTNER_AUDIENCE` defaults to prod URL; can be overridden by env.

### Endpoint Parameters

* `symbol: string`
* `interval: "DAILY" | "WEEKLY" | "MONTHLY"` (we use DAILY for RS)
* Optional: `range | from | to | limit`

### Field Mapping (bars)

* **Common:**
  - `d: string` — day key, e.g., "2025-10-09"
  - `t: number` — epoch ms
  - `o/h/l/c/v`: raw OHLCV
  - `ac`: adjusted close
  - `pc`: prior close
  - `ch`: absolute change `c - pc`
  - `cp`: percent change `((c - pc)/pc) * 100`
* **Intraday (pre-close):**
  - `ip`: intraday price
  - `ipc`: intraday percent change vs prior close
  - `ic`: intraday absolute change vs prior close
  - `it`: time string, e.g., "15:30"

### RS Phase Mapping

* `post` (canonical EOD):
  - close = `ac`
  - percent change = `cp`
* `pre` (intraday):
  - close = `ip`
  - percent change = `ipc` (fallback derive from `ip` & `pc`)

### Alignment

* Align baseline and target strictly by `d`. Drop non-overlaps.
* Only compute RS for days where both baseline and target have valid entries and a complete 5-day window.