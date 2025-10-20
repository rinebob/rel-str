# Testing - Relative Strength Heatmap (MVP) - Combined

## 1. Introduction

This document outlines the testing strategy for the Minimum Viable Product (MVP) of the Relative Strength Heatmap (RSH) application. A comprehensive approach including unit, integration, and end-to-end (E2E) testing will be implemented from the start to ensure application quality and reliability across both frontend and backend components.

## 2. Overall Strategy & Focus

The testing strategy will be comprehensive, incorporating various levels of testing with a strong focus on critical components and user flows to deliver a stable and accurate application. Key areas of focus include:

* **Relative Strength Calculation Accuracy:** Rigorously testing the core backend logic responsible for calculating RS values to ensure mathematical correctness for various inputs and edge cases.
* **Critical User Flows:** Ensuring key user journeys (e.g., user registration and login, managing stock lists, viewing the heatmap, viewing charts with interactive RS threshold marking) are functional, intuitive, and bug-free from end-to-end.
* **Code Quality & Coverage:** Utilizing unit and integration tests to ensure individual components and their interactions function correctly in isolation and in combination, and to maintain a high level of code coverage across the codebase, especially for critical business logic.

## 3. Testing Types & Frameworks

A multi-layered testing approach will be employed:

* **Unit Testing:**
    * **Scope:** Testing individual functions, methods, classes, or small units of code in isolation. This includes testing pure functions, utility helpers, single component methods without their templates, and pure reducer functions or selectors in NgRx. The goal is to verify that the smallest testable parts of the application perform as expected.
    * **Framework:** Jest will be used as the primary testing framework for both the Angular frontend (configured to run with Jest) and the Firebase Cloud Functions (Node.js backend).
* **Integration Testing:**
    * **Scope:** Testing the interaction and communication between several units or components. This includes testing how Angular components interact with services or the NgRx store, how services interact with each other, and how backend Cloud Functions interact with mocked external services (like Firebase services or APIs). The focus is on verifying the correct flow of data and control between integrated units.
    * **Framework:** Jest will also be used for integration testing across both frontend and backend components.
* **End-to-End (E2E) Testing:**
    * **Scope:** Testing the complete application flow from the user interface through the backend and database layers, simulating realistic user interactions in a browser environment. This verifies that the system works as a whole from the user's perspective, testing critical paths like the entire login process, adding a ticker and verifying its appearance and data on the heatmap, or clicking a ticker to successfully load and view the detailed chart.
    * **Framework:** Cypress will be used for developing and running End-to-End tests for the Angular web application.

## 4. Specific Testing Considerations

Certain aspects of the application require specific testing strategies:

* **Relative Strength Calculation Validation:** To confirm the absolute correctness of the core RS calculation logic implemented in backend Cloud Functions, an external validation mechanism will be used. This involves generating expected RS values for a set of known historical stock data inputs using a separate, independently validated tool or method (e.g., a spreadsheet implementing the formula, or a simple script). These externally validated expected values will serve as the authoritative assertions in the backend integration and unit tests specifically designed for the calculation functions.
* **Third-Party API Mocking:** Interactions with external third-party services, particularly the stock data API and the payment gateway APIs (Stripe/PayPal), will be comprehensively mocked during automated testing. This ensures that tests are fast, deterministic, reliable, and do not depend on the availability or performance of external services or consume external API quotas during development and CI/CD runs.
* **Firebase Service Mocking:** Core Firebase services such as Firebase Authentication and Firestore will be appropriately mocked or emulated (if using Firebase Emulators locally) in unit and integration tests. This allows for testing application logic that interacts with these services without requiring a live, internet-connected Firebase project instance. NgRx Effects that involve interactions with Firebase services will be specifically tested by mocking the underlying service calls they make.

## RS Pipeline Testing Strategy (Pre/Post)

### Unit Tests (Jest)

- RS calculation correctness
  - Fixture-based tests verifying rank parity with FE `rs-calc-utils.ts` for known series.
  - Edge cases: fewer than 5 points; all zeros; large spikes; missing days alignment handled by drop/merge semantics.
- Mapping and alignment
  - Mapping Savant bars → percent-change arrays: `cp` for post, `ipc` or derived for pre.
  - Date alignment by `d` with non-overlapping day removal.
- Writer logic (pure functions)
  - Upsert-by-day behavior into `series` arrays.
  - Retention trimming applied after append/replace.

### Integration Tests (Emulators)

- Pub/Sub → Functions → Firestore flow
  - Publish a `partner-data-ready` message with `phase=post`.
  - Mock SavantAPI responses (HTTP stub) returning baseline and target bar sets.
  - Assert `pairs/{BASE}_{SYMBOL}.post.series` and `.post.latest` written and `seriesUpdatedAt` set.
- Pre-close path
  - Publish with `phase=pre` and intraday fields present (`ip`, `ipc`, `it`).
  - Assert `.pre.series` and `.pre.latest` updated correctly with intraday-derived values.
- Retention
  - Configure retention small (e.g., 3) and verify older entries are truncated after write.
- Idempotency
  - Re-run for the same day verifies replace-not-duplicate behavior in `series`.

### CI Considerations

- Run unit tests on push/PR.
- Integration tests can run nightly or on-demand due to emulator spin-up cost.

## 5. Test Environments & Workflow

Testing will be integrated into the development workflow across different environments:

* **Local Development:** Developers will be expected to run relevant unit and integration tests frequently during local development to get rapid feedback on code changes. The full test suite (including E2E tests, requiring local emulators or a test environment setup) should be run locally before committing code to ensure basic functionality is intact.
* **Continuous Integration (CI/CD):** The automated CI/CD pipeline using GitHub Actions will run the complete test suite (unit, integration, and E2E) on every code push to the repository, especially for pull requests and merges into the main branch. Automated deployment to staging or production environments will be configured to proceed *only if* all tests within the pipeline pass, serving as a critical quality gate and ensuring that only verified code is deployed.