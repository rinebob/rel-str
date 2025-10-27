# DevOps - Relative Strength Heatmap (MVP) - Combined

## 1. Introduction

This document outlines the DevOps strategy for the Minimum Viable Product (MVP) of the Relative Strength Heatmap (RSH) application, leveraging the Firebase platform and associated Google Cloud infrastructure. The strategy focuses on efficient hosting, automated deployment pipelines, comprehensive monitoring, and scalable infrastructure to support the application throughout the MVP phase.

## 2. Hosting

* **Frontend (Angular Web App):** Firebase Hosting
    * Provides fast, secure, and reliable hosting for the static web assets (HTML, CSS, JavaScript, images, etc.) via a global Content Delivery Network (CDN). Supports custom domains and SSL certificates out-of-the-box.
* **Backend (Cloud Functions, Firestore, Authentication, etc.):** Firebase / Google Cloud Managed Infrastructure
    * Firebase services (Authentication, Firestore, Cloud Functions, Cloud Scheduler, etc.) run on Google Cloud's infrastructure and are automatically managed by Google/Firebase. This eliminates the need for manual server provisioning, configuration, patching, and management for these core backend components.
* **Generated Documentation Site:** Hosted on Firebase Hosting
    * Static documentation sites (e.g., JSDoc generated developer docs, user guides) will also be hosted on Firebase Hosting, potentially on a subdomain or a specific path within the main domain.

## 3. Continuous Integration / Continuous Deployment (CI/CD)

* **Tool:** GitHub Actions
* **Strategy:** Implement a CI/CD pipeline using GitHub Actions to automate the build, test, and deployment process. The pipeline will be triggered automatically by code commits, specifically targeting the main development branch (e.g., `main` or `master`) after pull requests are merged.
* **Workflow:** The automated pipeline will perform the following steps:
    * Checkout the latest code from the repository.
    * Install dependencies for both the Angular frontend and the Firebase Cloud Functions.
    * Build the Angular frontend application (generating static assets).
    * Build the Firebase Cloud Functions (transpiling TypeScript, etc.).
    * **Run automated tests:** Execute the comprehensive suite of automated tests, including frontend unit tests, integration tests, and end-to-end (E2E) tests, as well as backend unit and integration tests for Cloud Functions. The pipeline will fail if any tests do not pass.
    * If tests pass, deploy the built frontend assets to Firebase Hosting.
    * If tests pass, deploy the Cloud Functions to Firebase.
    * (Optional) Generate JSDoc developer documentation from code comments.
    * (Optional) Deploy the generated documentation site to Firebase Hosting.
* **Benefit:** Enables rapid, consistent, and reliable delivery of code changes to production or staging environments with minimal manual intervention. The integrated automated testing ensures that critical functionality is not broken before deployment, reducing the risk of introducing bugs into production.

## 4. Monitoring

* **Focus:** Proactive monitoring of application health, performance, resource usage, data freshness, and errors across the frontend and backend.
* **Tools:** Leverage the suite of monitoring tools provided by Firebase and Google Cloud Platform (GCP).
    * Firebase Console Dashboards: Provide an overview of project usage, performance, and stability.
    * Firebase Performance Monitoring: Gather performance data for the frontend web application (e.g., page load times, network request latency).
    * Firebase Crashlytics: Collect, analyze, and track frontend crash reports.
    * Google Cloud Logging (formerly Stackdriver Logging): Centralized logging for all backend components (Cloud Functions, database operations, etc.). Enables structured logging and log-based metrics.
    * Google Cloud Monitoring (formerly Stackdriver Monitoring): Collect metrics (CPU usage, memory, network traffic, database operations) and configure dashboards and alerting policies.
* **Specific Monitoring Areas:**
    * **Cloud Functions:** Monitor function invocation counts, execution time, cold starts, memory and CPU usage. Set up alerts for function errors, increased error rates, or unusually long execution times.
    * **Firestore:** Monitor database read/write/delete operations count and latency, storage size, and query performance. Track index usage and identify potential slow queries.
    * **Firebase Hosting:** Monitor site performance (latency), request volume, and error rates for serving static assets.
    * **Data Freshness State:** Implement custom metrics or analyze logs (within Cloud Functions) to monitor the successful completion and timestamp of the daily pre-close and post-close data calculation and persistence processes. Set up alerting if data is not updated within expected timeframes relative to market close. Implement mechanisms to track if a significant percentage of individual tickers show stale data in Firestore and alert on thresholds.
    * **Error Logging:** Ensure all significant errors from both the frontend (via Crashlytics) and backend (via Cloud Logging) are captured, categorized, and easily searchable. Configure alerts for critical error thresholds.
    * **Payment Gateway Webhooks:** Monitor the successful receipt and processing of webhook events from payment gateways.

## 5. Scaling

* **Approach:** Primarily rely on Firebase's built-in automatic scaling for core services.
* **Details:** Firebase Authentication, Firestore, and Cloud Functions are designed to automatically scale their resources up or down based on the volume of requests and load. This auto-scaling capability is expected to be sufficient to handle the projected user base throughout the MVP phase (estimated 100-1000 users) and potentially accommodate growth up to approximately 10,000 users without requiring explicit manual scaling configurations or infrastructure changes for these services.
* **Considerations:** While scaling is automatic, continuous monitoring of usage and costs via Firebase/GCP dashboards is essential. As the user base and data volume grow, review resource allocations for Cloud Functions and optimize Firestore queries and data model to ensure efficiency and manage costs. The performance optimizations implemented based on findings (potentially documented separately, e.g., in `performance-optimization.md`) will directly contribute to the application's ability to scale efficiently.

## 6. Emulator to Prod Partner API (2025-10-27)

- Place minimal keys in `functions/.env.rel-str` (auto-loaded by emulators):
  - `PARTNER_TRACKED_SYMBOLS_URL=https://us-central1-alpha-vantage-proxy-api.cloudfunctions.net/partnerListTrackedSymbolsV2`
  - `PARTNER_TS_URL=https://us-central1-alpha-vantage-proxy-api.cloudfunctions.net/partnerTimeSeriesV2`
  - `PARTNER_CALLER_SA=rel-str-partner-caller-prod@rel-str.iam.gserviceaccount.com`
  - `GOOGLE_IMPERSONATE_SERVICE_ACCOUNT=rel-str-partner-caller-prod@rel-str.iam.gserviceaccount.com`
- One-time machine setup:
  - `gcloud auth application-default login`
  - `gcloud config set project rel-str`
  - Grant user `roles/iam.serviceAccountTokenCreator` on the caller SA.
- Start emulators; functions will impersonate the SA and call prod partner endpoints.
- Troubleshooting:
  - Ensure outbound HTTPS to `oauth2.googleapis.com`, `iamcredentials.googleapis.com`, and partner URLs.