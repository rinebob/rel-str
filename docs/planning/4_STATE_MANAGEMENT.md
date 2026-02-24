# State Management Documentation - Relative Strength Heatmap (MVP)

## 1. Introduction

This document outlines the strategy for managing various types of state within the Relative Strength Heatmap (RSH) frontend application, built with Angular. A combination of Angular's built-in signals and NgRx Signal Store will be used.

## 2. Local (Intra-Component) State

* **Approach:** Angular `signal()`
* **Description:** State that is specific to a single component and does not need to be shared with other parts of the application will be managed using Angular's built-in `signal()` function. This is suitable for UI-specific state within a component, such as form input values before submission, toggle states, local loading indicators, or component-internal display logic.

## 3. Global / Shared (Inter-Component) State

* **Approach:** NgRx Signal Store
* **Description:** State that needs to be shared between multiple components or is considered central to the application's functionality will be managed using NgRx Signal Store. This includes:
    * User authentication status and profile information.
    * User-defined stock lists and settings (baseline security, timeframe, thresholds).
    * Heatmap vNext query and **RSMA/EMA-based scoring configuration** (selected interval, RSMA window such as 5/10/30, and future coloring mode).
    * Application-wide settings (e.g., theme if implemented).
    * Potentially state related to the overall application flow or notifications.

## 4. Server State Management & Caching

* **Storage:** NgRx Signal Store
* **Approach:** Data fetched from the backend (Firebase Firestore or Cloud Functions), such as the calculated Relative Strength data for the heatmap and charts, will be stored within designated slices of the NgRx Signal Store.
* **Derived scoring (RSMA):** The same Signal Store slice that caches RS series for the heatmap will also compute EMA-based RS moving averages (RSMA) client-side for Daily/Weekly/Monthly intervals, exposing these as derived signals used for heatmap sorting.
* **Caching Strategy:** The Signal Store will act as a local cache for server data. A specific logic will be implemented:
    * Upon loading the heatmap/chart view, the app will first check if today's relevant data (pre-close or post-close) is available in the store.
    * If today's data is not yet available, **yesterday's post-close data** (if cached or fetched) will be displayed as a fallback.
    * Once today's data is successfully fetched from the backend, the NgRx Signal Store will be updated, triggering reactive updates in the UI to display the fresh data.
* **Loading/Error States:** Loading status, error messages, and other metadata related to fetching server data will be managed alongside the data within the NgRx Signal Store.
* **Timestamp:** A **single timestamp** will be stored and displayed on the UI, indicating the calculation/fetch time of the currently presented dataset (pre-close or post-close).

## 5. State Persistence

* **Mechanism:** Browser Local Storage or IndexedDB (Implementation detail)
* **Data to Persist:** Certain user preferences and application settings that enhance user experience across sessions will be persisted locally in the user's browser. This includes:
    * Selected default stock list.
    * Last used baseline security.
    * Applied filters or sorting preferences on the heatmap.
    * Potentially theme settings (if applicable).
    * (Other user-specific settings identified later).
* **Integration:** This persisted state will be loaded when the application starts and can be initially used to populate the relevant parts of the NgRx Signal Store or component signals. Changes to these settings will update both the in-memory state and the local persisted storage.

## 6. Async & Streams (RxJS-First)

* **Canonical async type:** For all stateful flows (server state, derived UI state, and cross-component coordination), **RxJS `Observable` is the primary async primitive**.
* **NgRx Signal Store + RxJS:**
  * Signal Store slices may expose derived `signal()` values, but IO and multi-step workflows should be implemented with RxJS streams composed in services or dedicated orchestration helpers.
  * Where Firebase/Angular APIs already expose observables (Firestore, HttpClient), consume them directly; do **not** convert to promises in store code.
* **Prohibited patterns in new state code:**
  * Introducing new `async`–`await` chains in Signal Store methods for data fetching, fan-out, or coordination when an observable-based API exists.
  * Using `firstValueFrom` / `lastValueFrom` in store code as the primary mechanism for reads.
* **Cancellation & staleness:**
  * Prefer `switchMap` for user-driven selectors (selected list, timeframe, filters) so that previous requests are canceled and cannot update state after newer selections.
  * Use `takeUntil` / `takeUntilDestroyed` where appropriate to tie subscriptions to component or store lifecycles.
* **Loading/Error modeling:**
  * Represent loading and error state as part of the same observable pipelines (e.g., `startWith({ loading:true })`, `catchError`) instead of imperative flags around Promise chains.
