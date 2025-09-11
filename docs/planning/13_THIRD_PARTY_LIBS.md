# Third-Party Libraries - Relative Strength Heatmap (MVP)

## 1. Introduction

This document lists the key third-party libraries anticipated for use in the Minimum Viable Product (MVP) of the Relative Strength Heatmap (RSH) application, categorized by frontend and backend. The project aims to minimize third-party dependencies by utilizing native TypeScript/JavaScript capabilities where feasible.

## 2. Frontend Libraries (Angular)

* **Angular Core Libraries:** Standard libraries included with the Angular framework (e.g., `@angular/core`, `@angular/common`, `@angular/router`).
* **UI Component Library:** A library providing pre-built and styled UI components (buttons, forms, modals, etc.) to accelerate frontend development and ensure consistency. *Suggestion: Angular Material.*
* **State Management:** **NgRx** will be used for managing the application's state in a predictable and scalable way.
* **Charting Library:** For rendering interactive financial charts (candlestick, volume) and enabling visual overlays/coloring of data like Relative Strength. *Example based on user input: TechAnJs (or another D3-based library).*
* **Date/Time Handling:** Native JavaScript `Date` object and TypeScript will be used for date and time manipulation where sufficient. A third-party library (like `date-fns`) will only be introduced if complex or frequent operations are needed that are cumbersome with native capabilities.
* **Testing Frameworks:** Jest (for unit and integration tests), Cypress (for end-to-end tests).

## 3. Backend Libraries (Firebase Cloud Functions - Node.js)

* **Firebase Admin SDK:** The official library for interacting with Firebase services (Auth, Firestore) from the backend environment.
* **HTTP Client:** A library to make HTTP requests to external services, particularly the third-party stock data API if they don't provide an official Node.js SDK. *Suggestion: `axios`.*
* **Third-Party Stock Data API Client:** If the chosen stock data provider offers an official Node.js client library, it will be used.
* **Payment Gateway SDK:** The official server-side Node.js library for integrating with the chosen payment processor (e.g., Stripe, PayPal).
* **SMS Sending Library (Future):** A library for the chosen SMS provider if text notifications are implemented later (e.g., Twilio).
* **Testing Framework:** Jest (for unit and integration tests).
* **Data Manipulation (Minimal):** Native JavaScript/TypeScript will be preferred for data manipulation. A library like `lodash` will only be considered if specific, complex utility functions are frequently needed and not easily implementable with native code.
* **Authentication & Google Cloud**
  * google-auth-library (Node.js)
    * Purpose: Obtain Google OIDC ID tokens for server-to-server calls where required (e.g., partner endpoints in cross-project contexts).
    * Not used by the Angular frontend.
