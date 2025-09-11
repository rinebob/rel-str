# Frontend Documentation - Relative Strength Heatmap (MVP) - Combined

## 1. Introduction

This document outlines the frontend architecture, key technologies, and core features for the Minimum Viable Product (MVP) of the Relative Strength Heatmap (RSH) web application, adjusted to consume RS-only, pair-centric data. The focus is on building a robust, maintainable, and performant user interface primarily for desktop web browsers, while establishing a structure that can support future mobile responsiveness and potential native mobile applications.

## 2. Technology Stack

* **Framework:** Angular
    * *Description:* Angular has been selected as the primary frontend framework due to its structured approach, component-based architecture, and comprehensive ecosystem, which are well-suited for building a feature-rich, single-page application like the RSH.
* **Language:** TypeScript
* **Styling:** Sass (SCSS syntax)
    * *Approach:* Styling will be managed using Sass (SCSS syntax). This preprocessor provides variables, nesting, mixins, and other features that significantly improve CSS maintainability and organization compared to standard CSS, aligning well with Angular's component-based structure. Specific styling for UI components will leverage Angular Material's theming capabilities.
* **UI Library:** Angular Material
    * *Description:* Angular Material will provide pre-built UI components adhering to Material Design principles. This will accelerate development, ensure design consistency across the application, and provide built-in accessibility features for standard elements like buttons, forms, tables, and navigation.
* **State Management:** NgRx Signal Store for shared state; local component signals for UI
    * *Description:* Application state will be managed using the NgRx library, specifically utilizing NgRx Signal Store for global and complex state. This reactive state management approach provides efficient state updates and management, particularly useful for handling complex data flows like the heatmap state, user settings, and fetched data. Local component state will primarily use Angular's built-in signal capabilities for simplicity and performance.
* **Communication:** Firebase SDK (Firestore reads), Callable Functions for multi-read aggregates, RS ranges, and OHLCV (backend-only to SavantAPI)
    * *Approach:* The frontend will interact with the backend using Firebase SDKs for direct interactions (e.g., Firestore reads) and Angular's `HttpClient` (via NgRx signal store and dedicated service) for calling Firebase Cloud Functions that read from Firestore. The Angular app will not call partner endpoints directly; partner endpoints are server-to-server only.

## 3. Core Features (MVP)

* **Auth (TBD) and Navigation**
  * User Authentication (Signup, Login - supporting Email/Password & Google Sign-In, Logout). [TBD]
  * Password Reset functionality. [TBD]
  * User Profile and basic Preferences Management (viewing/updating). [TBD]
  * Payment/Subscription Management interface (displaying current status, linking to payment gateway for history/updates - actual payment handling via gateway integration). [TBD]
* **Managing User's Personalized Stock List**
  * Add/Remove tickers (or pairs) via a modal interface (e.g., `SelectStockPanel`). [Integrates with pair registry]
* **Heatmap (baseline-aware):**
  * Display RS using a selected baseline (default baseline from config).
  * Read `pairs/{BASELINE}_{SYMBOL}.latest` for pre/post RS and timestamps.
  * Optionally show a sparkline using `latest30`; otherwise fetch 30-day RS from callable on demand.
  * Sorting/highlighting based on RS and freshness.
  * Sector baseline dropdown: user can pick a SPDR sector (XLC, XLY, XLP, XLE, XLF, XLV, XLI, XLB, XLRE, XLK, XLU) or SPY (broad). Selecting a sector sets the baseline to that ETF and auto-loads the sector’s current constituents into the list.
  * Sector Strength button: sets baseline to SPY and loads the sector ETF symbols as the current list for direct sector vs SPY comparison; supports interval (D/W/M), sort/filter, and navigation to `rs-chart`/History per item.
  * Current Signals button: navigates to a dedicated Signals View that lists canonical signals from the most recent completed RS run; supports client-side filtering and deep links to `rs-chart`.
* **Chart View:**
  * Display a candlestick price chart with associated volume data for a selected ticker (via backend-provided OHLCV).
  * Fetch RS series via `GetPairRSData(base, symbol, from, to, thresholds?)`.
  * Color candlesticks using RS values.
  * Allow interactive input of user-defined RS thresholds and visualize buy/sell markers based on returned RS (transient) or canonical signals (active baselines).
  * Provide alternative RS visualization options on the chart (e.g., separate pane or band).
  * Existing `sync-chart` behavior (unchanged):
    * Bottom carousel shows mini-charts for all pairs in the current list; user can scroll horizontally and click any mini-chart to load it in the main chart area.
    * Main chart supports zoom/pan/scroll controls (mouse wheel/drag or built-in toolbar controls where available).
  * `rs-chart` must achieve feature parity with `sync-chart` for carousel and zoom/pan/scroll controls.
* **Signals View:**
  * Route: `signals`. Displays a table of canonical signals from the latest completed run (via `GetCurrentSignals`).
  * Features: sorting (e.g., by baseline, symbol, type, source, time), filtering (baseline/type/source), client-side pagination, and a row action to open `rs-chart` centered on the signal date.
* **Dynamic Filtering/Highlighting:**
  * Use `QueryPairsByThreshold` callable to filter by `latest` RS server-side (rate-limited), or filter client-side after a batch read.
* **Loading & Error Handling:**
  * Display appropriate Loading Indicators during data fetching or processing.
  * Implement user-friendly Error Handling and display specific data state/freshness information per ticker rather than generic errors for individual ticker data failures.
* **Countdown Timer:**
  * A persistent countdown timer indicating the time until the next scheduled daily data fetch via `GetAppSchedule`.
* **Public Pages:**
  * Landing page introducing the app, Documentation/How to Use guide, and dedicated Signup/Login pages. [Auth TBD]
* **Backtest View:**
  * Route: `backtest`. A feature-level view to evaluate historical performance of signals for a selected pair `(baseline, target)` with technical analysis (TA) filters applied to baseline, target, or both.
  * UI: 
    * Backtest chart (re-uses `RsChartView` rendering stack) showing RS and OHLCV with TA overlays (e.g., SMA200, RSI, etc.).
    * Filter Builder: add/edit/remove TA filters; choose scope (baseline | target | both) and parameters with a comparator toggle (>, <) for each rule.
      * Examples: `RSI > 50`, `Price > EMA(200)`, `Price < EMA(50)`.
    * Signal indicators: as filters change, show which signals remain vs filtered-out directly on the chart.
    * Results table: totals (count, win/loss, win%), remaining after filters, and filtered-off counts; update live as filters adjust.
  * Data: RS from Firestore; OHLCV and TA metrics fetched via backend callable to SavantAPI (partner will source from AV). Frontend never calls partner endpoints directly.
  * MVP specifics:
    * TA supported: EMA(20), EMA(50), EMA(200) and RSI(>50) to start.
    * Interval: default Daily; user can switch to Weekly/Monthly.
    * Lookback: default last 1 year; max range TBD (e.g., up to 5 years or all available).
    * Rule logic: AND all active rules (no OR groups for MVP).
    * Presets: allow save/load of rule sets via backend callables persisting to Firestore (no Auth yet; will layer Auth later).
* **Backtest Button:** Lives near sector controls. On click:
  * Navigates to the `backtest` route with the current `(baseline, target)` pre-selected (or prompts to select a pair).
  * BacktestView loads RS from Firestore and requests OHLCV+TA overlays via a backend callable; user builds filters and sees results update.
  * Defaults: Daily interval, last 1 year lookback, initial TA list empty (user adds EMA20/50/200 and RSI>50 as desired).
  * Filter Builder includes a comparator toggle (>, <) for each rule; users can construct both long and underperformance scans.
* **Settings:**
  * Gear icon opens a right-side drawer with configurable app settings. Applies immediately with an option to Reset to Defaults.
  * Configurable (MVP):
    * Timeframe interval: Daily / Weekly / Monthly
    * RS thresholds: Buy, Sell
    * Signal scope preference: Show pre, post, or both in UI
    * Backtest defaults: interval (D/W/M), lookback (default 1y), TA presets load on open
    * Heatmap: default sort metric (pre/post/latest), default baseline, default sector, enable sparklines
    * Chart: show RS pane vs candle-coloring, default thresholds, decimal precision
    * Appearance: theme (light/dark), density (compact/comfortable)
    * Performance: enable/disable live updates (auto-refresh latest), cache duration hints (frontend)

## 4. Architecture & Structure

* **Component-Based:** Adhere strictly to Angular's component-based architecture for modularity and reusability.
* **Module Structure:** Organize features into distinct Angular modules, utilizing lazy loading for routing where appropriate to optimize initial load times.
* **State Management:** Utilize NgRx Signal Store slices for auth (future), settings (baseline selection), heatmap data (latest + optional latest30), and chart data (RS series + OHLCV fetched via callable).
* **Service Layer:** Implement Angular services to encapsulate business logic, orchestrate data fetching by interacting with NgRx effects/actions, and handle cross-cutting concerns (e.g., logging, error handling details).
* **Data Handling:**
    * Always display the most recent data successfully fetched and processed for each ticker.
    * Clearly indicate the freshness/state of data per ticker in the UI.
    * Handle real-time updates for the heatmap and chart data by implementing Firestore listeners where data changes occur, including automatic chart bar color updates and user notifications for newly available data.
* **Routing:** Angular Router to manage navigation. During the charting migration, we will keep the existing SyncFusion-based chart view and introduce a new Renderer2/SVG-based chart view under a separate route.
  * Existing view route: `sync-chart` (unchanged)
  * New view route: `rs-chart` (component: `RsChartView`)
  * New view route: `signals` (component: `SignalsView`)
  * New view route: `backtest` (component: `BacktestView`)
* **Navigation Structure:** Implement a combination of a collapsible sidebar and a top navigation bar using Angular Material components (Sidenav and Toolbar).
    * **Collapsible Sidebar:** The primary navigation for accessing different application sections (Heatmap, Charts, Account Settings) will be in a sidebar, designed to be collapsible to maximize space for the heatmap.
    * **Top Navigation Bar:** A top bar will contain essential elements like the app logo/title, potentially quick action icons, and user authentication/account status indicators (Login/Signup links when logged out, User Profile link/Logout button when logged in).
* **Sector Baseline Selector:** Lives in the dashboard header/toolbar. On change:
  * Updates baseline in the settings store.
  * Fetches sector constituents (via callable or cached config) and replaces the current list with the members.
  * Triggers heatmap data refresh and preserves existing sort/filter/interval selections.
* **Sector Strength Button:** Lives alongside the sector selector. On click:
  * Sets baseline to `SPY` in the settings store.
  * Loads the SPDR sector ETF symbols as targets (from sector config/callable) and refreshes the heatmap, preserving sort/filter/interval.
* **Current Signals Button:** Lives near sector controls. On click:
  * Navigates to the `signals` route and loads canonical signals from the most recent completed run via `GetCurrentSignals`.
  * The Signals View provides client-side filters (baseline/type/source), sorting, and pagination; rows link to `rs-chart` centered on the signal date.
* **Settings Drawer:**
  * Triggered by a gear icon in the dashboard header; implemented as a right-side sidenav drawer (non-blocking) for quick access.
  * Settings stored in a Signal Store slice and persisted via callables (anonymous client id until Auth is added).
  * Provide Reset to Defaults and per-section reset; optimistic UI with debounce-save.

## 5. Key Technical Considerations

* **Data Visualization:** Implement the heatmap and chart components efficiently to handle potentially large lists of tickers and historical data, ensuring smooth rendering and interactivity. Leverage the chosen charting library effectively. Use Angular's `Renderer2` when necessary for safe and Angular-aware manual DOM manipulation, particularly within charting or heatmap components.
* **Performance:** Apply a range of Angular performance optimization techniques throughout development, including lazy loading of modules, production build optimizations, strategic use of `OnPush` change detection, optimizing data display (e.g., virtual scrolling for long lists), prerendering public pages, optimizing image and CSS delivery, leveraging browser caching, performing regular performance audits, and optimizing initial bundle size.
* **Real-time Updates:** Implement robust Firestore listeners to efficiently update relevant parts of the UI (heatmap cell colors, data freshness indicators, chart bar colors) automatically when underlying data in the database changes, providing users with near real-time information regarding newly available daily data. Implement clear visual notifications, especially when viewing a chart, that new data has loaded. No direct polling of external providers from the frontend.
* **Error Handling & UI Feedback:** Develop a consistent and user-friendly approach to handling errors. Display informative loading states, provide clear general error messages when necessary, and prioritize displaying the state/freshness of individual ticker data even if specific recent data fetches failed, to avoid a completely blank UI.
* **Responsiveness:** While the primary focus for MVP is the desktop web experience, design components with responsiveness in mind, using CSS flexbox/grid and Angular Material's responsive utilities where appropriate, to facilitate future adaptation to smaller screen sizes.
* **Chart Rendering Strategy (Transition Plan):**
  * Primary: Implement a Renderer2/SVG charting pipeline that draws candles, wicks, volume, RS overlays, and threshold markers with fine-grained performance control and theming.
  * Utilities: Prefer minimal helpers (e.g., d3-scale/d3-array) or small custom mappers for scales/extents; avoid depending on heavy chart libraries for "calculations" only.
  * Rendering service: `RsChartRenderService` encapsulates all DOM/SVG drawing via `Renderer2`.
  * Transitional Use of SyncFusion: Keep the existing SyncFusion-based view for continuity (including its bottom mini-chart carousel and main chart zoom/pan/scroll controls). We are not modifying `sync-chart`; documentation only. If needed temporarily, reuse its interactions while we layer custom SVG overlays; aim to phase out SyncFusion rendering once SVG achieves feature parity.
  * Parity Goal: Before deprecating `sync-chart`, ensure `rs-chart` includes (1) bottom mini-chart carousel for current list pairs and (2) robust zoom/pan/scroll on the main chart.
* **Signals View Table:**
  * Use Angular CDK/Material table with OnPush and trackBy.
  * Client-side transforms for filter/sort/paginate on the returned list (expected <= ~50 rows per run).
  * Provide stable test ids for E2E.
* **Backtest Frontend Notes:**
  * Comparator UX: Rule editor includes a toggle for comparator (`>` or `<`) next to each rule's value input; labels clarify examples like `RSI > 50`, `Price > EMA(200)`.
  * Rule model/types: Define a `BacktestRule` type `{ id:string; scope:'baseline'|'target'|'both'; type:'EMA'|'RSI'|'PRICE'; comparator:'>'|'<'; params: { length?:number; threshold?:number; compareTo?:'price'|'ema' } }` with validators per type.
  * State slices: Add Backtest signal store slices for `context` (pair, interval, lookback), `rules[]`, `results` (totals, remaining, filtered), and `series` (rs, ohlcv, ta).
  * Performance: Request only needed TA series; cache last call result while tweaking rules; debounce UI-driven recomputes; render annotations efficiently with SVG grouping and keyed updates.
  * Presets: Save/load via callables; until Auth, attach an anonymous client id stored locally to list only this client’s presets.
* **Settings State & Persistence:**
  * State slices: `settings` (interval, thresholds, scopes, UI prefs), persisted with an anonymous client id; when Auth arrives, migrate to per-user.
  * Validation: enforce numeric ranges (e.g., 0–100 for RS thresholds) and safe defaults.
  * Immediate application: changes should propagate to heatmap, chart, signals, and backtest views in real time.
  * Offline-first: keep last settings locally; sync to backend when available.

## 6. Data Flow (Chart)

* **RS series (pre/post):** Read directly from Firestore `pairs/{BASELINE}_{SYMBOL}/rs` (e.g., `orderBy t desc limit 30` for the default window). Also read `pairs/{...}.latest` for freshness.
* **OHLCV price/volume:** Fetched on-demand via a backend Callable that reads from SavantAPI. The frontend never calls SavantAPI directly.
* **Signals:**
  * Canonical signals (for active baselines) can be read from `pairs/{...}/signals`.
  * Transient signals for custom thresholds are computed client-side from the RS series returned and are not persisted.

## 7. Assumptions and Risks**

* **Assumptions:**
    * The chosen third-party stock data API is reliable, provides necessary OHLCV data for the target universe, and is cost-effective for the MVP's data fetching requirements.
    * Angular Material and the chosen charting library meet the functional and performance requirements for building the heatmap and charts.
    * Firebase services (Authentication, Firestore, Hosting, Cloud Functions) provide a stable and scalable backend infrastructure within cost expectations for the MVP.
    * Users are comfortable with standard web application interfaces, or the provided documentation is sufficient to guide them.
* **Risks:**
    * **Performance Issues:** Rendering and interacting with large heatmaps or complex charts might encounter performance bottlenecks despite planned optimizations, leading to a poor user experience.
    * **Data API Reliability:** Downtime or performance issues with the third-party data API could directly impact the freshness and availability of data in the frontend.
    * **Complexity of State Management:** Improper implementation of NgRx could lead to overly complex or hard-to-debug state logic.
    * **Real-time Data Challenges:** Implementing reliable real-time updates via Firestore listeners while efficiently updating complex UI elements like charts and heatmaps could be challenging.
    * **Responsiveness Limitations:** The initial desktop-focused design might require significant rework to become fully mobile-responsive, impacting future development effort.

## 8. Testing

* Implement a comprehensive testing strategy encompassing:
    * **Unit Tests:** Using Jest for testing individual functions, services, and component logic in isolation.
    * **Integration Tests:** Testing interactions between components, services, and NgRx state.
    * **End-to-End (E2E) Tests:** Using Cypress to test key user flows through the application in a browser environment.
* Automated test execution will be integrated into the CI/CD pipeline using GitHub Actions to ensure that tests run on every code change. Test coverage targets will be defined and monitored.