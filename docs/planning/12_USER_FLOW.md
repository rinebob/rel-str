# User Flow - Relative Strength Heatmap (MVP) - Combined

## 1. Introduction

This document outlines the primary user journeys and interaction flows for the Minimum Viable Product (MVP) of the Relative Strength Heatmap (RSH) application. These flows cover the essential tasks users will perform, from account management to interacting with the core data visualization features. The application will also feature a persistent **countdown timer** indicating the time until the next scheduled data fetch, providing users with transparency on data freshness.

## 2. Key User Journeys

1.  User Sign Up Flow  [Deferred]
2.  User Login Flow  [Deferred]
3.  Logged-in User Views Heatmap
4.  User Manages Stock List
5.  User Views Ticker Chart
6.  User Views Signal History
7.  User Selects Sector Baseline (Dashboard Dropdown)
8.  User Compares Sector Strength (Dashboard Button)
9.  User Views Current Signals (Dashboard Button)
10. User Runs Backtest (Dashboard Button)
11. User Adjusts Settings (Gear Icon)

## 3. Detailed User Flows

Below are the main steps a user takes and the expected system responses for each key journey. These flows describe the typical path, acknowledging that alternative interactions (e.g., using social login, encountering errors) are handled but the primary successful path is documented here.

* **User Sign Up Flow:** Describes the process for a new user to create an account and gain access to the application, including subscription setup.
    1.  User arrives at the application website (e.g., landing page).
    2.  User decides to sign up (potentially after reviewing documentation or features).
    3.  User clicks a "Sign Up", "Get Started", or similar button/link.
    4.  User is presented with a sign-up form that includes required fields for account credentials (e.g., email address, desired password, password confirmation) and integrated payment information collection fields.
    5.  User fills out all the required information accurately and submits the form.
    6.  The application initiates the request processing, which includes backend operations:
        * Validating the format and content of the submitted form data (e.g., valid email, strong password).
        * Attempting to create a new user account in the Firebase Authentication service.
        * If authentication account creation is successful, creating a corresponding new user document in the Firestore `users` collection, populated with basic profile data and potentially a default/seed list of selected tickers.
        * Initiating the payment processing flow (using the chosen payment gateway, e.g., Stripe or PayPal, via a secure Cloud Function call) using the payment information provided by the user.
        * Handling the response received from the payment gateway API (e.g., payment success, failure, required 3D Secure step).
        * Updating the user's `subscriptionStatus` field in their Firestore user document based on the outcome of the payment processing (e.g., 'paid', 'free' if payment fails or they choose a free tier option later).
        * On successful account creation and payment, potentially logging the user in automatically and redirecting them to the main application dashboard.
        * On failure at any step (validation error, authentication error, payment error), displaying appropriate and informative validation or payment-specific error messages to the user on the sign-up form.

* **User Login Flow:** Describes the process for an existing user to authenticate and access their account and data.
    1.  User arrives at the application website.
    2.  User clicks a "Login", "Sign In", or similar button/link.
    3.  User is presented with available login options (e.g., a form with fields for email and password, a "Login with Google" button for social sign-in).
    4.  User selects their preferred method and completes the authentication process (e.g., enters credentials and clicks submit, clicks "Login with Google" and follows the OAuth flow).
    5.  The application interacts with Firebase Authentication services to verify the provided credentials or handle the social login handshake.
    6.  On successful authentication:
        * Firebase Authentication provides an authentication token to the frontend SDK.
        * The frontend establishes the user's authenticated state using the SDK.
        * The frontend triggers the backend process (via a Cloud Function call) to fetch the initial dataset required for displaying the heatmap for this user's selected tickers.
        * The application navigates/redirects the user to the main application dashboard (the heatmap page).
    7.  On authentication failure (e.g., incorrect password, email not found, cancelled social login), an appropriate and clear error message is displayed on the login interface.

* **Logged-in User Views Heatmap:** Describes the primary interaction with the core data visualization feature after logging in.
    1.  User successfully logs in (completing the User Login Flow), which initiates the process to fetch the initial heatmap data in the background.
    2.  The application navigates/redirects the user to the main heatmap dashboard page.
    3.  Upon the page loading, the frontend ensures the authenticated user context is active and available via the Firebase SDK.
    4.  If the initial data fetching (initiated on login) is still in progress, the frontend displays appropriate loading indicators (e.g., spinners, skeleton loaders) in the heatmap area.
    5.  As the latest daily **Relative Strength (RS) data** and associated OHLCV summaries for the user's selected tickers arrive from the backend (fetched via the efficient Cloud Function call initiated upon login), the frontend processes this data.
    6.  The frontend renders or updates the heatmap table using the received RS and OHLCV data. This includes applying the defined color coding (based on RS value), displaying the ticker symbol and RS value in each cell, and displaying freshness indicators (timestamp, relative time like "Today's Close") for each ticker's data. The heatmap will display the most recent valid data available for each ticker, indicating if it is not the latest expected post-close data.
    7.  The user can select a baseline for the heatmap, which will be used to calculate the relative strength of each ticker.
    8.  The user can view the last 30 days of data for each ticker by clicking on the ticker symbol.
    9.  The user can click a button on any row (e.g., "View Chart") to open the chart view for that baseline–symbol pair at route `rs-chart`, or click "History" to open a signal/history panel for that pair.
    10. The user can select a timeframe interval (Daily, Weekly, Monthly) that updates heatmap metrics and sparklines accordingly.
    11. The user can sort and filter the current stock list (e.g., sort by RS pre/post, filter by thresholds or freshness) to focus on relevant symbols.
    12. The user can choose a sector from a dashboard dropdown (SPDR sectors, e.g., XLC, XLY, XLP, XLE, XLF, XLV, XLI, XLB, XLRE, XLK, XLU, and SPY as a broad market option). Choosing a sector sets the baseline to that sector ETF and loads the sector’s constituent stocks into the current list.
    13. The user can click a "Sector Strength" button to compare sector ETFs directly: sets baseline to SPY and loads the sector ETF symbols as the current list.
    14. The user can click a "Current Signals" button to navigate to the dedicated Signals View, which lists the buy/sell signals generated in the most recent completed RS run (canonical signals for active baselines) with filters and links to open items in the chart.
    15. The chart will display real-time updates for the latest RS writes.

## RS Data Consumption (Frontend)

- Heatmap and list views
  - During market hours: read `pairs/{PAIR}.pre.latest` for rank and quick fields.
  - After close: read `pairs/{PAIR}.post.latest`.
- RS Chart view
  - Historical RS pane uses `pairs/{PAIR}.post.series`.
  - Optionally overlay intraday current (`pre.latest`) if the user is viewing same-day data.
- Freshness
  - Listen to `pairs/{PAIR}.pre.seriesUpdatedAt` and `.post.seriesUpdatedAt` for phase-specific freshness.
- Baseline switching
  - When baseline changes, reload relevant pairs under the new baseline namespace and refresh views.
- Error and fallback
  - If `pre.latest` is missing (no intraday yet), fall back to `post.latest`.
  - If `post.series` is short after backfill begins, show loading/placeholder and progressively populate.

* **User Manages Stock List:** Describes how a logged-in user modifies the list of tickers displayed on their heatmap.
    1.  User is on the main heatmap dashboard page, already logged in and viewing their current list.
    2.  User clicks a "Manage List", "Edit Tickers", or similar button/icon.
    3.  A modal window, dialog, or separate page appears, displaying the user's current list of selected ticker symbols (retrieved from the `selectedTickers` array in their user document in Firestore).
    4.  For each ticker currently displayed in the list within the modal, there is a visual indicator and a "Delete" or "Remove" button/icon.
    5.  There is a clear input field or area where the user can enter new ticker symbols they wish to add (they may be able to enter multiple symbols separated by space or comma).
    6.  As the user enters new symbols, the application validates them against a known master list of supported tickers (likely via a backend call to a `ValidateTickerSymbol` Cloud Function). Invalid symbols are flagged with an error message.
    7.  Successfully validated symbols are added to a temporary list displayed within the modal interface, distinct from the currently saved list until confirmed.
    8.  If the user clicks the "Delete" or "Remove" button next to a ticker in their current list displayed in the modal, it is visually marked for removal.
    9.  The modal interface includes "Cancel" and "Update List" (or "Save Changes") buttons.
    10. If the user clicks "Cancel", the modal closes, discarding any additions, removals, or changes made within the modal interface since it was opened.
    11. If the user clicks "Update List", the frontend constructs the final desired list of tickers based on the changes made in the modal and sends this modified list to the backend via a dedicated Cloud Function call (`UpdateUserStockList`). The backend validates the final list (e.g., checks for duplicates, ensures tickers are supported) and atomically updates the `selectedTickers` array in the user's document in Firestore. The modal closes. The main heatmap view updates to reflect the changes in the user's list (this might trigger data fetches for any newly added symbols that were not previously tracked).

* **User Views Ticker Chart:** Describes the process for a user to view detailed historical data and RS analysis for a single security.
    1.  User is viewing the heatmap or a list of tickers on the dashboard.
    2.  User clicks a button, link, or specific element associated with a ticker symbol (e.g., clicking on a row in the heatmap table, clicking a symbol in a separate list).
    3.  The application navigates the user to a dedicated chart page or view specifically for that ticker symbol.
    4.  Upon loading the chart page/view, the frontend displays loading indicators in the chart area while data is retrieved.
    5.  The frontend initiates data fetching for historical price and RS data for that specific ticker over a relevant predefined or configurable date range for the chart visualization (e.g., last 6 months, 1 year).
    6.  The frontend calls the backend (via a `GetSecurityRSData` Cloud Function) to retrieve historical **OHLCV data** and the corresponding calculated **Relative Strength (RS) data** for the specified ticker and date range from Firestore. (Note: The frontend may initially render the most recent day's data if already present from the heatmap view while waiting for historical data, but the full range of historical RS data for the chart is specifically fetched for this view).
    7.  As historical data arrives from the backend, the frontend processes it.
    8.  The frontend renders a **candlestick price chart** using the received OHLCV data.
    9.  For each historical day displayed on the chart, the corresponding candlestick bar color is set according to that day's 0-100 RS value (e.g., using a gradient scale).
    10. Historical **volume data** for the same date range is displayed, likely in a separate pane below the price chart.
    11. User input fields or sliders are available on the chart page/interface for the user to enter "buy threshold" and "sell threshold" RS values.
    12. Based on the user-defined thresholds and the historical RS data displayed on the chart, the frontend calculates and displays visual indicators directly on the chart simulating potential trade entry/exit points where the RS line (or daily RS values) cross these threshold levels.
    13. Alternative visualizations for RS data (e.g., a separate pane below the price chart plotting the RS line, an overlaid band on the price chart) are supported and can be toggled by the user.
    14. **Real-time Update:** If new daily pre-close or post-close data for this specific ticker becomes available (written to Firestore by the backend) while the user is actively viewing the chart page, the corresponding candlestick bar color for the most recent day will update in real-time, and an explicit notification (e.g., a small banner or toast message) will inform the user that new data has been received.
    15. **Countdown Timer:** A persistent countdown timer will be displayed on the chart page, indicating the time remaining until the next scheduled data fetch (e.g., 15 minutes remaining). This provides users with transparency on data freshness and helps them understand when the next update will occur.
    16. **Data Source Attribution:** The chart page will include clear attribution to the data source (e.g., a link to the provider's website or terms of use) to ensure users are aware of the origin of the data they are viewing.
    17. The user can select a baseline for the chart, which will be used to calculate the relative strength of the ticker.
    18. The user can view the last 30 days of data for the ticker by clicking on the ticker symbol.
    19. The chart will display real-time updates for the latest RS writes.

* **User Views Signal History:** Describes how a user reviews buy/sell signals for a baseline–symbol pair.
    1. From the heatmap row actions (or from the chart view), the user clicks "History" to open the Signal History view/panel for the current baseline–symbol pair.
    2. The frontend requests recent signals for the pair:
        * Default: last 30 signals (most recent first) via a Firestore query on `pairs/{BASE}_{SYMBOL}/signals` ordered by `t desc`.
        * Optional filters: by `type` (`buy`/`sell`), by date range, or by source (`pre`/`post`).
    3. The Signal History view displays a list/table of signals with:
        * Timestamp, type (buy/sell), RS value at event, and source (pre/post).
        * Optional badges indicating canonical (active baseline) vs transient thresholds.
    4. For each signal, the user can click "Open in Chart" which navigates to `rs-chart` anchored around that signal date (e.g., +/- N days) and highlights the corresponding candle/marker.
    5. The user can adjust filters (type/date/source) and the list updates accordingly. If no signals are present for the chosen filters, the view shows an empty-state message.
    6. Performance notes:
        * Use pagination or infinite scroll if more than 30 signals.
        * Collection-group queries for broad feeds are possible later, but MVP focuses on the single-pair history.

* **User Selects Sector Baseline (Dashboard Dropdown):** Describes how a user pivots the heatmap to a sector ETF baseline and its constituents.
  1. The dashboard displays a Sector dropdown (SPDR family + SPY). Example options:
     * SPY – S&P 500 Index (broad market)
     * XLC – Communication Services
     * XLY – Consumer Discretionary
     * XLP – Consumer Staples
     * XLE – Energy
     * XLF – Financials
     * XLV – Health Care
     * XLI – Industrials
     * XLB – Materials
     * XLRE – Real Estate
     * XLK – Technology
     * XLU – Utilities
  2. When the user selects a sector, the app sets the heatmap baseline to the selected sector ETF and retrieves the sector’s constituent list.
     * Source of constituents: backend callable or cached config (see planning docs) that returns current members.
  3. The current list is replaced with the sector’s constituents (targets), and the heatmap loads `pairs/{SECTOR_ETF}_{SYMBOL}.latest` (and optional `latest30`).
  4. The user may then sort/filter, select interval (D/W/M), open Chart (`rs-chart`), or open History for any constituent.
  5. Optionally, the user can “Save as List” which registers the sector pairs for future scheduler maintenance (pair registry).

* **User Compares Sector Strength (Dashboard Button):** Describes how a user compares sectors relative to SPY.
  1. The dashboard shows a "Sector Strength" button. When clicked:
     * Baseline is set to `SPY`.
     * Targets are populated with the SPDR sector ETF symbols (e.g., XLC, XLY, XLP, XLE, XLF, XLV, XLI, XLB, XLRE, XLK, XLU).
  2. The heatmap loads `pairs/SPY_{SECTOR_ETF}.latest` (and optional `latest30`) for each sector ETF.
  3. The user may sort/filter by RS, select interval (D/W/M), and open Chart (`rs-chart`) or History for any sector ETF item.
  4. Optionally, the user can save this as a quick-access list; registry writes are only performed on explicit save (not on view).

* **User Views Current Signals (Dashboard Button):** Shows canonical signals from the most recent completed RS run.
  1. The dashboard shows a "Current Signals" button near the sector controls. When clicked, the app navigates to the Signals View route (`/signals`).
  2. The Signals View displays a table with: timestamp, type (buy/sell), symbol, baseline, source (pre/post), RS at event; each row has an action to open `rs-chart` centered on the signal date.
  3. Client-side controls: filtering (baseline/type/source), sorting (by time, baseline, symbol, type), and pagination. Empty-state shown if there are no signals.
  4. Data source: the view calls `GetCurrentSignals()` to retrieve the latest run’s canonical signals (across active baselines). No client writes.

* **User Adjusts Settings (Gear Icon):** Describes how a user changes global/app defaults and view behavior.
  1. From any dashboard view, the user clicks the gear icon in the header. A right-side Settings drawer opens (non-blocking).
  2. The drawer groups settings into sections with inline validation and a Reset-to-Defaults per section:
     * Timeframe: Daily / Weekly / Monthly (applies to heatmap/rs-chart/backtest defaults)
     * RS Thresholds: Buy, Sell (used by chart coloring, canonical/transient markers defaults)
     * Signal Scope: Show pre, post, or both in UI by default
     * Backtest Defaults: interval (D/W/M), lookback (default 1y), auto-load last preset (optional)
     * Heatmap: default sort metric (pre/post/latest), default baseline/sector, show sparklines toggle
     * Chart: show RS pane vs candle-coloring, default thresholds, decimal precision
     * Appearance: theme (light/dark), density (compact/comfortable)
     * Performance: enable/disable live updates (auto-refresh latest), cache hints
  3. Settings apply immediately (optimistic update) and are saved after a short debounce via a callable. The user can cancel/close to keep changes.
  4. Persistence:
     * MVP: settings are saved to Firestore under an anonymous client id (until Auth).
     * Future: when Auth is enabled, the settings are tied to the user and migrated.
  5. On reopen, the drawer loads stored settings; a global Restore Defaults option resets all sections.

## Recent Changes (2025-10-27)

- Auth-first data loading:
  - Dashboard V2 defers any Firestore-dependent loads until `authState` yields a user.
  - This aligns with Firestore rules that require auth for reading `tracked-symbols` and `pairs-data`.
- Symbol universe sourcing:
  - Store calls Functions `getTrackedSymbols` via `RelStrDbV2Service.getTrackedSymbols$()` and sets `supportedSymbolsListV2`.
  - UI no longer issues duplicate callable requests; debug renders read from the store state.