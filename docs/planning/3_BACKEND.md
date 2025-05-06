# Backend Documentation - Relative Strength Heatmap (MVP) - Combined

## 1. Introduction

This document outlines the backend architecture, key technologies, and core features for the Minimum Viable Product (MVP) of the Relative Strength Heatmap (RSH) application. The backend is built primarily using the Google Firebase platform and leverages additional Google Cloud Platform (GCP) services, providing a managed, serverless environment responsible for external data fetching, core Relative Strength calculations, data storage, user authentication, and integration with necessary third-party services.

## 2. Technology Stack

* **Platform:** Google Firebase & Google Cloud Platform (GCP)
* **Core Compute:** Firebase Cloud Functions (Node.js runtime using TypeScript)
    * *Description:* Firebase Cloud Functions will serve as the primary serverless compute environment for executing backend logic, calculations, and API interactions. Development will use TypeScript for improved code quality and maintainability.
* **Database:** Firebase Cloud Firestore
    * *Type:* NoSQL Cloud Database
    * *Description:* Firebase Cloud Firestore will be the main database, storing all application data including user profiles, user-defined stock lists and settings, and the core calculated Relative Strength (RS) historical data. Its document-model and real-time capabilities are well-suited for the application's data structure and access patterns.
* **Authentication:** Firebase Authentication
    * *Methods (MVP):* Email/Password, Google Sign-In
    * *Description:* Firebase Authentication will handle all user authentication flows securely, including registration, login, password recovery, and integrating with Google Sign-In.
* **Scheduled Tasks:** Google Cloud Scheduler
    * *Purpose:* Used to trigger Cloud Functions on a predefined schedule, specifically for the daily data fetching and calculation processes.
* **Secret Management:** Firebase Environment Configuration / Google Cloud Secret Manager
    * *Purpose:* To securely store and manage sensitive information such as third-party API keys and service credentials, keeping them separate from the codebase.
* **External APIs:**
    * Third-party Stock Data API (e.g., Alphavantage - specific provider TBD)
    * Payment Gateway APIs (Stripe, PayPal)
    * SMS Gateway API (Future consideration, part of the stack but not MVP core)
* **File Storage:** Firebase Cloud Storage (Potential, minimal requirement for MVP based on current features)
    * *Description:* If the application requires storing user-uploaded content (like profile pictures) or other files in the future, Firebase Cloud Storage would be the designated service.

## 3. Core Features (MVP)

The backend will implement the following core features, primarily through orchestrated Cloud Functions and interactions with Firestore and external services:

* **User Management:** Implement all standard Firebase Authentication flows (signup, login, logout, password reset). Manage user profiles, preferences, and personalized stock lists within Firestore, secured by Firestore Rules and Cloud Function checks.
* **Scheduled Data Fetching:** A Cloud Function, reliably triggered daily by Google Cloud Scheduler at a specific time relative to market close, will:
    * Fetch historical (as needed for calculations) and current-day OHLCV data for a predefined universe of approximately 500 ticker symbols from the chosen third-party stock data API.
    * Store the raw OHLCV data or relevant summaries in Firestore for use in calculations.
* **Relative Strength Calculation:** A separate Cloud Function, triggered automatically after the daily data fetch is complete, will:
    * Retrieve necessary historical OHLCV data and user-defined parameters (baseline ticker, lookback period - defaulting to 1-year) from Firestore.
    * Perform the core Relative Strength calculation logic for each of the ~500 fetched tickers against the specified baseline.
    * Persist the latest calculated daily RS values, along with updated OHLCV summaries (open, high, low, close, volume), calculation parameters, and a calculation timestamp to Firestore for each ticker.
* **User Data Provisioning:** Implement efficient Cloud Functions callable from the frontend to retrieve:
    * The latest daily RS values and OHLCV summaries for a user's currently selected stock list, optimized for rapid display in the heatmap upon user login or list changes.
    * Historical OHLCV and calculated RS data for a specific ticker over a requested date range, necessary for rendering the detailed chart view.
* **Dynamic Threshold Query:** A Cloud Function to process requests from the frontend to filter or highlight tickers on the heatmap based on user-defined RS threshold criteria. This function will include backend rate limiting to prevent abuse.
* **Ticker Validation:** A Cloud Function to validate if a user-entered string corresponds to a recognized ticker symbol within the application's supported universe (~500 symbols), likely by querying the stored symbol list or attempting a test fetch.
* **Payment Processing Integration:** Cloud Functions will handle secure interactions with the chosen payment gateway (Stripe/PayPal), including initiating payment requests, processing webhook notifications for subscription events (e.g., successful payment, subscription status changes), and securely updating user subscription status in Firestore.
* **Admin Functions (Restricted):** Implement Cloud Functions accessible only to users with an 'admin' role, allowing for administrative tasks such as manually triggering the daily data fetch process (for testing or recovery) and manually updating user subscription statuses.
* **Providing Schedule Information:** A mechanism (likely a simple Cloud Function or direct Firestore read) to provide the frontend with the timestamp or countdown until the next scheduled daily data fetch, used for the frontend countdown timer.

## 4. Architecture & Structure

* **Serverless First:** The architecture is fundamentally serverless, leveraging Cloud Functions for event-driven or on-demand execution, eliminating the need to manage dedicated servers for most backend logic.
* **Database Interaction:** All data access will go through Firestore, using the Firebase Admin SDK within Cloud Functions for secure read/write operations that bypass standard security rules but require elevated permissions. Firestore Security Rules will be strictly defined for direct frontend access to protect user data (e.g., user can only read/write their own profile/lists).
* **External API Integration:** Interactions with third-party APIs (stock data, payment gateways) will be encapsulated within Cloud Functions. API keys and secrets will be managed securely using Firebase Environment Configuration or Google Cloud Secret Manager, accessed only by authorized functions. External API calls will include appropriate error handling and retry logic.
* **Modular Functions:** Cloud Functions will be organized into logical units based on their functionality (e.g., `dataFetcher`, `rsCalculator`, `userDataApi`, `paymentProcessor`, `adminTasks`) to improve maintainability and allow for independent deployment and scaling.
* **Error Handling & Logging:** Implement robust error handling within Cloud Functions to catch issues during data fetching, calculations, database operations, and external API calls. Critical errors will be logged to Google Cloud Logging. Generic error responses will be sent to the frontend where appropriate to avoid exposing sensitive backend details. Automated retries will be implemented for transient external API errors.
* **Native Code Preference:** Prioritize using native Node.js/TypeScript features and well-established, minimal third-party libraries within Cloud Functions for data manipulation and utility tasks to reduce complexity and potential security surface area.

## 5. Key Technical Considerations

* **Data Model (Firestore):** Design the Firestore data structure carefully for efficient storage and retrieval of both historical OHLCV and daily RS values. This involves considering how data is partitioned (e.g., per ticker, per day), how queries will be performed (e.g., fetching a date range for a ticker), and ensuring necessary indexes are created (as detailed in a separate `database-schema.md` document).
* **RS Calculation Logic:** The TypeScript implementation of the Relative Strength calculation logic within the Cloud Function must be thoroughly unit-tested for mathematical accuracy and handle edge cases (e.g., missing data points, stock splits, dividends - though handling splits/dividends might be dependent on the data provider or deferred).
* **Scheduling Reliability:** The configuration of Google Cloud Scheduler and the triggered Cloud Function must be highly reliable to ensure the daily data fetch and calculation process runs successfully and consistently at the correct time relative to market close. Monitoring and alerting for scheduling failures are essential.
* **Performance Optimization:** Optimize Cloud Function execution times, particularly the RS calculation process, which might be computationally intensive for ~500 symbols. This involves optimizing the algorithm, ensuring efficient data reads from Firestore, allocating appropriate memory/CPU, and minimizing cold starts for frequently called functions (e.g., user data provisioning). Design Firestore queries to be efficient and minimize document reads.
* **Security:** Implement comprehensive security measures including rigorous Firestore Security Rules to restrict direct client access, thorough input validation and sanitization in Cloud Functions, secure management of API keys, and proper authentication/authorization checks within functions for all user-triggered actions and admin tasks.
* **Scalability:** Rely on Firebase and GCP's built-in automatic scaling for Cloud Functions and Firestore, which is expected to handle the projected user load for the MVP phase without manual intervention.

## 6. Third-Party Integrations

This backend relies on integrating with the following external services:

* **Stock Data Service:** Integration via API calls from Cloud Functions to fetch historical and daily stock price and volume data. Specific provider (e.g., Alphavantage) to be confirmed based on data availability, reliability, and cost.
* **Payment Processors:** Integration with Stripe and/or PayPal using their respective SDKs/APIs, primarily within secure Cloud Functions, to handle subscription payments, payment intents, and process webhook notifications for subscription status changes.
* **SMS Gateway (Future):** Potential future integration for features like notifications, which would also be handled via API calls from Cloud Functions.

## 7. Testing

* Implement a comprehensive testing strategy for the backend:
    * **Unit Tests:** Using Jest for testing individual Cloud Function logic, utility functions, and calculation algorithms in isolation.
    * **Integration Tests:** Testing the interaction between Cloud Functions and Firebase services (Firestore, Authentication) and mocking external API calls.
* Automated test execution will be a mandatory step in the CI/CD pipeline using GitHub Actions to ensure that backend code changes do not introduce regressions. Specific test coverage targets for critical logic will be defined.

## 8. Assumptions and Risks**

* **Assumptions:**
    * A reliable and cost-effective third-party stock data API is available that provides the necessary historical and daily OHLCV data for the target universe (~500 symbols) with sufficient accuracy and consistent update timing relative to market close.
    * The chosen payment gateways (Stripe/PayPal) provide reliable APIs and webhooks for managing subscriptions programmatically within the Firebase/GCP environment.
    * Firebase and GCP services provide the necessary performance, scalability, and features within a manageable cost for the MVP.
    * The Relative Strength calculation methodology is correctly implemented and aligns with user expectations.
* **Risks:**
    * **Data API Reliability and Cost:** Downtime, unexpected changes, data inaccuracies, or prohibitive costs from the third-party data provider could significantly disrupt the application's core functionality and financial viability.
    * **Performance Bottlenecks:** The daily data fetch and RS calculation process might become a performance bottleneck, potentially exceeding execution time limits or incurring high costs if not optimized efficiently, especially as the number of symbols or lookback period increases.
    * **Calculation Accuracy:** Bugs in the RS calculation logic could lead to inaccurate data, eroding user trust and the value proposition of the application.
    * **API Key Security:** Improper management of API keys and secrets could lead to security breaches or unauthorized usage of third-party services.
    * **Firestore Data Model Limitations:** If the Firestore data model is not designed effectively for query patterns, retrieving data for heatmaps or charts could become slow or expensive.
    * **Scheduling Failures:** Failures in the Cloud Scheduler trigger or the data fetch function could result in stale data for users.