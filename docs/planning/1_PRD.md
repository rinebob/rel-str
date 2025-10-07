# Product Requirements Document (PRD) - Relative Strength Heatmap (MVP) - Combined

## 1. Introduction & Goals

### 1.1 App Overview

* **App Name:** Relative Strength Heatmap (RSH)
* **Tagline:** Visualizing Market Strength, Relatively.
* **Description:** The Relative Strength Heatmap (RSH) is a web application designed for investors and traders. It provides a quick, intuitive visual representation of the relative performance of various securities against a user-defined baseline security over time. The core feature is a color-coded heatmap table (red for underperformance, yellow for similar performance, green for overperformance) that allows users to identify trends and potential trading opportunities based on relative strength. The MVP will focus on the core heatmap functionality, detailed associated charting, historical data visualization, and the necessary infrastructure to support a freemium model, secure user management, and reliable data processing.

### 1.2 Primary Goals

* Enable users to track the Relative Strength of a personalized list of stock tickers against a user-defined baseline.
* Visualize RS data intuitively using a color-coded heatmap for quick market scanning.
* Provide detailed chart views with RS data overlays and simulated threshold points for individual tickers.
* Ensure data is updated daily and presented with freshness indicators and countdown timers.
* Implement core data and analysis features first; full user authentication, management, and subscription are planned (Deferred/TBD) and will be layered later.
* Launch a functional MVP rapidly to begin marketing and gather user feedback.
* Establish a user base for future growth and feature expansion.
* Validate the freemium monetization strategy (specifically via a paid subscription tier).

## 2. Scope

### 2.1 In Scope for MVP

* Settings (no Auth): Right-side drawer with global app preferences (timeframe Daily/Weekly/Monthly, RS thresholds buy/sell, default signal scope pre/post/both, heatmap defaults incl. baseline/sector and sorting, chart defaults, appearance, performance). Persisted via backend callables using an anonymous client id until Auth is added.
* Sector Baseline selection: Dashboard sector dropdown (SPDR family + SPY) sets baseline to sector ETF and loads constituents as current list.
* Sector Strength comparison: Dashboard button sets baseline to SPY and compares sector ETFs as targets in the heatmap.
* Daily Scheduled Data Fetching (~500 symbols) via backend ingestion pipeline (partner pipeline -> normalized Firestore). The frontend never calls external market data providers directly.
* Daily Relative Strength Calculation (based on a configurable lookback period, defaulting to 1-year for MVP) for fetched symbols against a user-defined baseline.
* Storage of daily OHLCV summaries and calculated RS values, along with a calculation timestamp, in Firestore.
* Display of the Relative Strength Heatmap for the user's selected tickers, with color-coding, RS values, symbols, and data freshness indicators.
* Sorting and visual indication (shading/color) of tickers based on data freshness in the heatmap.
* Clickable heatmap rows/symbols to navigate to a detailed chart view.
* Detailed Ticker Chart View:
    * Candlestick chart with volume.
    * Candlestick bars colored by daily RS value.
    * Ability to input buy/sell RS thresholds and visualize simulated trade points on the chart.
    * Alternative RS data visualizations on the chart (e.g., band, separate pane).
    * Zoom/Pan/Scroll controls on the main chart.
    * Parity with existing `sync-chart` carousel behavior: a bottom mini-chart carousel of current list pairs with click-to-load, replicated in `rs-chart` before deprecating `sync-chart`.
* Timeframe interval selection: Daily / Weekly / Monthly for heatmap metrics and chart defaults.
* Signals View: Dedicated `signals` route listing canonical signals from the most recent completed RS run with sorting, client-side filtering (baseline/type/source), pagination, and deep links to `rs-chart`.
* Current Signals: Dashboard button navigates to the Signals View and loads current-run canonical signals (unfiltered list from backend; client-side filters apply).
* Signal History (per pair): Accessible from heatmap row action; last 30 signals with filters and link to open in `rs-chart` centered on the event.
* Backtest View (MVP): Dedicated `backtest` route to evaluate historical performance of signals for a selected pair with TA filters (EMA 20/50/200; RSI with comparator >/< 50) applied to baseline, target, or both; AND-only rule composition; chart overlays; live results table (totals, remaining, filtered, win%). Presets can be saved/loaded to Firestore without Auth via callables.
* Real-time UI updates (heatmap, chart bar color + notification) when new daily data becomes available.
* Display of a countdown timer until the next scheduled data fetch.
* Integration with a payment gateway (Stripe/PayPal) for subscription (part of the signup flow) — Deferred/TBD.
* Basic user roles (paid user, admin) — Deferred/TBD.
* Public Pages: Landing page, Documentation/How to Use, Signup/Login.
* Error handling and display of data state/freshness instead of raw errors where possible.
* Comprehensive Unit, Integration, and E2E testing.
* CI/CD pipeline using GitHub Actions.
* Basic monitoring (health, performance, data freshness).
* Developer documentation (including JSDoc generated site) and a basic User Guide hosted on the site.
* Hosting on Firebase Hosting.
* Security measures (Authentication, Authorization via Firestore Rules/Functions, Data Security, API Security, basic Vulnerability Management).
* Performance Optimizations for both frontend (fast loading, smooth rendering) and backend (efficient calculations, queries, minimal cold start).
* Use of NgRx Signal Store for frontend state management.
* Preference for native TS/JS over third-party utilities where feasible.
* Basic Admin capabilities: Monitor data fetch status, potentially force updates, handle errors, view/manage user accounts and subscription levels.
* Authentication & Subscriptions (Deferred/TBD):
  * User Authentication (Email/Password, Google Sign-In, Logout, Password Reset) — Deferred
  * User Profile and Preferences (per-user storage) — Deferred
  * Subscription/Payments integration (Stripe/PayPal) and basic roles (paid user, admin) — Deferred

### 2.2 Out of Scope for MVP

* Intraday data or real-time streaming price/RS updates.
* Externally reachable API of RS signal stream.
* TradingView integration.
* Complex social features or community interactions.
* Advanced charting features *beyond* candlestick, volume, RS overlay/thresholds, and basic trend lines (e.g., other indicators, drawing tools, complex annotations).
* Full quantitative backtesting engine (we provide an interactive Backtest View with TA filters and summary metrics, not a full engine).
* Portfolio tracking features.
* Push notifications (beyond potential future SMS mentioned).
* Multiple subscription tiers beyond a single 'paid' level for the MVP core features.
* Detailed administrative dashboard (manual admin functions via Cloud Functions/basic interface in MVP).
* Automated security scanning or formal penetration testing (for MVP).
* Offline mode.
* Complex non-RS based filters (basic filtering by RS values, alphabetical, freshness is in scope).
* Animated walkthroughs or detailed graphics (basic static documentation is in scope).
* Full-featured Blog/Newsletter platform (maybe a static page linking elsewhere is in scope).
* Comprehensive Pricing Management (basic Free/Paid distinction handled via gateway integration is in scope).
* Horizontal scaling design *beyond* Firebase's built-in automatic scaling (will be considered later).

## 3. Target Users

* **Stock Traders and Investors:** Individuals actively involved in the stock market who use technical analysis, specifically Relative Strength, to inform their trading and investment decisions.
* **Users interested in a visual approach:** Those who prefer scanning data quickly via color-coded heatmaps rather than just lists or complex charts initially.
* **Technically oriented users:** Users comfortable with web applications and financial concepts.
* **Goals:** Quickly identify securities demonstrating strong or weak relative performance, inform short-term trading decisions (buy/sell), and visualize historical performance trends.
* **Pain Points:** Difficulty in quickly comparing the performance of many securities simultaneously; lack of an intuitive, time-series-based visualization for relative strength; needing to manually track relative performance.

## 4. User Stories / Key Features

* As a **new user**, I want to sign up for an account, potentially provide payment information, so I can access the application's features.
* As a **returning user**, I want to log in quickly so I can access the heatmap and my personalized data.
* As a **logged-in user**, I want to see a heatmap of my selected stock tickers with their latest Relative Strength values and colors so I can quickly gauge market leadership and identify opportunities.
* As a **logged-in user**, I want to see how fresh the data is for each ticker on the heatmap so I know if I'm looking at the most recent information.
* As a **logged-in user**, I want to easily add and remove tickers from my personalized list so the heatmap only shows the symbols I care about.
* As a **logged-in user**, I want to specify the baseline security for relative strength calculation so I can compare my list against a relevant benchmark (e.g., SPY).
* As a **logged-in user**, I want to set the timeframe for the heatmap columns (e.g., 1-day, 2-day, 1-week relative performance periods) so I can analyze different time horizons.
* As a **logged-in user**, I want to sort or filter the securities in the heatmap table (e.g., by current day's RS, alphabetically, by data freshness) so I can organize the view.
* As a **logged-in user**, I want to filter or highlight tickers on the heatmap based on specific RS threshold criteria so I can quickly find tickers meeting certain conditions.
* As a **logged-in user**, I want to click on a ticker from the heatmap to navigate to a detailed price chart with historical RS data overlaid so I can perform deeper analysis.
* As a **logged-in user viewing a chart**, I want to see the historical price bars colored by the daily RS value so I can visually correlate price movement and strength.
* As a **logged-in user viewing a chart**, I want to input RS thresholds and visualize simulated buy/sell trade points on the chart based on these thresholds crossing the RS data.
* As a **logged-in user viewing the heatmap or a chart**, I want to see a countdown timer showing the time until the next scheduled daily data fetch.
* As a **logged-in user viewing a chart**, if new data becomes available, I want the chart to update in real-time and be notified so I have the latest information immediately.
* As a **visitor**, I want to see a landing page that introduces the app and its benefits so I can understand its value proposition.
* As a **visitor or user**, I want to access documentation that explains relative strength and how to use the application's features.
* As an **admin user**, I want to be able to manually trigger the daily data fetch process (for testing or recovery).
* As an **admin user**, I want to be able to update a user's subscription status and view basic account information.
* As a **logged-in user or visitor**, I want to choose a sector baseline (e.g., XLK) so I can view all sector constituents relative to that sector ETF.
* As a **user**, I want a Sector Strength comparison to see sector ETFs vs SPY so I can quickly identify leading/lagging sectors.
* As a **user**, I want a Current Signals view listing the latest canonical signals so I can quickly scan opportunities and jump into charts.
* As a **user**, I want to view Signal History for a pair so I can see prior buy/sell events and navigate to them in the chart.
* As a **user**, I want to run a Backtest on a `(baseline, target)` pair, applying TA filters (EMA20/50/200; RSI comparator >/<), and see live-updating results (totals, win/loss, win%) so I can iterate toward higher success rates.
* As a **user**, I want a Settings drawer (gear icon) to adjust Timeframe (D/W/M), RS thresholds, signal scope, heatmap/chart defaults, appearance and performance, with immediate effect and saved for next time.
* As a **user viewing a chart**, I want carousel navigation across my current list and zoom/pan/scroll controls in the main chart for efficient exploration.
* As a **user (future)**, I want to create an account, log in, and manage my subscription so my settings, lists, and presets follow me across devices. (Deferred/TBD)

## 5. Requirements

### 5.1 Functional Requirements

* The application must provide sector baseline selection and sector strength comparison workflows.
* The application must allow settings and presets persistence via an anonymous client id until Auth is enabled.
* The application must automatically fetch historical and current-day OHLCV data for the supported universe from a partner pipeline into Firestore on a schedule; the frontend only accesses Firestore and callable functions (no direct frontend calls to third parties).
* The application must provide a color-coded heatmap of the latest daily RS values for the user's selected tickers and chosen timeframes.
* The application must allow users to filter or highlight heatmap tickers based on user-defined RS value thresholds via a backend query, with client-side filtering for additional criteria where appropriate.
* The application must provide a detailed interactive chart for a selected ticker showing candlestick price, volume, and historical RS data.
* The chart must provide zoom/pan/scroll controls and a bottom mini-chart carousel for current list navigation (in `rs-chart`, achieving parity with existing `sync-chart`).
* The application must provide a dedicated Signals View listing current-run canonical signals with sorting, filtering, pagination, and deep links to `rs-chart`.
* The application must provide a Signal History view per pair (last 30, filters, open-in-chart).
* The application must provide a Backtest View with TA filters (EMA20/50/200; RSI comparator >/<), AND-only rule composition, overlays, and a results table; presets can be saved/loaded via callables.
* The application must provide a Settings drawer to adjust timeframe (D/W/M), RS thresholds, signal scope, heatmap/chart defaults, appearance, and performance; settings apply immediately and persist via callables.
* The application must handle and display errors gracefully, showing relevant status messages or data state/freshness instead of raw technical errors where possible.
* The application must implement backend rate limiting on user-triggered queries to protect resources.
* The application must securely store and retrieve sensitive API keys and secrets on the backend (e.g., using environment variables, secret management).
* The application must validate and sanitize all user input on the backend to prevent security vulnerabilities.
* The application must support user registration and authentication via email/password and Google Sign-In. (Deferred/TBD)
* The application must support subscription payments and basic roles once Auth is enabled. (Deferred/TBD)

### 5.2 Non-Functional Requirements

* **Performance:**
    * Frontend: Achieve fast initial loading times (<3 seconds ideally), smooth heatmap rendering for typical user list sizes (e.g., 100-200 tickers), responsive user interactions (<100ms for most UI actions).
    * Backend: Ensure efficient Cloud Function execution (especially RS calculation), completion of daily data fetch/calc for ~500 symbols within a specific window (e.g., 1-2 hours) before market open/close, efficient Firestore queries (<500ms), minimize cold start impact for frequently used functions (e.g., using min instances).
    * Consistency: The daily data fetch trigger must occur consistently at a specific time relative to market close (e.g., 30-60 minutes after).
* **Scalability:** The architecture must be able to scale automatically leveraging Firebase's built-in scaling to support up to 1000 active users within the MVP timeframe.
* **Security:**
    * User data must be protected via secure authentication and authorization mechanisms (Firestore Rules, Function checks verifying user identity).
    * Data in transit must be secured using HTTPS/SSL.
    * Data at rest in Firestore must be secured (leveraging Firestore's built-in encryption).
    * API keys and secrets must be stored securely on the backend, separate from the codebase.
    * Vulnerabilities in code and dependencies must be managed proactively (regular dependency updates, monitoring for known vulnerabilities, basic response plan for incidents).
    * Cross-Site Scripting (XSS) and Cross-Site Request Forgery (CSRF) protection must be implemented.
* **Reliability:** The daily data fetch and calculation process must be reliable, with monitoring, logging, and automated retry mechanisms in place for API failures. The application should maintain high uptime (>99.5%) for core user-facing features.
* **Maintainability:** The codebase should be well-structured (standalone Angular components with Signal Store for state management, modular Cloud Functions) and documented (JSDoc for code, architectural docs, basic user guide) to facilitate future development, debugging, and onboarding of new developers.
* **Testability:** The application must be testable at unit, integration, and end-to-end levels, with automated tests integrated into the CI/CD pipeline to ensure code quality and prevent regressions. Test coverage targets should be defined (e.g., >80% unit test coverage for critical backend logic).
* **Usability:** The user interface should be intuitive and easy to navigate for target users, allowing them to quickly manage lists, understand the heatmap visualization, and interact with charts without extensive training (supported by the user guide). Key actions should require minimal clicks.

## 6. Success Metrics

* Number of user signups (overall and paid conversions).
* Number of active users (e.g., users who log in and view the heatmap weekly/daily).
* Conversion rate from Free to Paid users.
* User engagement with core features (e.g., frequency of logging in, time spent viewing heatmap, number of chart views).
* User retention rates (monthly/quarterly).
* Positive feedback from early users (qualitative).
* Reliability of daily data processing (successful fetch and calculation rate).
* Data freshness SLA adherence (e.g., pre-close RS available by 3:30 PM ET; post-close RS available by 4:30 PM ET ± tracked latency).

## 7. Assumptions and Risks

* **Assumptions:**
    * Primary market data flows through a partner pipeline into normalized Firestore storage; the app consumes data via Firestore and callable functions only (no direct frontend calls to third parties).
    * Users understand the basic concept of relative strength as used in the application or are willing to learn from the provided documentation.
    * The chosen technical infrastructure (Firebase, Firestore, Cloud Functions) can support the daily data fetching, calculations, storage, and user load for the MVP scope efficiently and cost-effectively.
    * The chosen payment gateway (Stripe/PayPal) integration is straightforward and reliable.
    * The predefined seed list of ~500 symbols is sufficiently broad for the initial target audience.
* **Risks:**
    * **Data API Issues:** Downtime, significant rate limits, unexpected changes in API structure, data errors, or unsustainable costs from the third-party data provider could severely impact data availability and accuracy.
    * **Performance Bottlenecks:** Despite optimizations, calculating and rendering the heatmap and historical charts for user lists and timeframes might still encounter performance issues, impacting user experience, especially as the user base or list sizes grow.
    * **User Adoption and Value Proposition:** The app's value proposition may not resonate strongly enough with the target audience, or competitors may offer superior alternatives, hindering user adoption and paid conversions.
    * **Calculation Accuracy:** Ensuring the relative strength calculation logic is correct and handles edge cases (e.g., stock splits, dividends, missing data) accurately is crucial; errors could erode user trust.
    * **Security Vulnerabilities:** Despite planned measures, unforeseen vulnerabilities could expose user data or system integrity, requiring rapid response.

## 8. Future Considerations (Beyond MVP)

* Additional charting features and indicators.
* More sophisticated user profile management and preferences.
* Expansion of the stock universe beyond the initial ~500 symbols.
* More sophisticated user roles and permissions.
* Push notifications (e.g., email, mobile) for specific RS signals or data updates.
* Social/community features (e.g., sharing heatmaps, discussing symbols).
* Advanced analytics or reporting on user activity or market trends.
* Integration with other trading platforms (e.g., brokers via API).
* User customizable RS calculation parameters (beyond lookback, e.g., methodology).
* Support for asset classes other than stocks (e.g., ETFs, Indices, Crypto - if data available).
* Development of native mobile applications.
