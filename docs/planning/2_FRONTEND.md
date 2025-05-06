# Frontend Documentation - Relative Strength Heatmap (MVP) - Combined

## 1. Introduction

This document outlines the frontend architecture, key technologies, and core features for the Minimum Viable Product (MVP) of the Relative Strength Heatmap (RSH) web application. The focus is on building a robust, maintainable, and performant user interface primarily for desktop web browsers, while establishing a structure that can support future mobile responsiveness and potential native mobile applications.

## 2. Technology Stack

* **Framework:** Angular
    * *Description:* Angular has been selected as the primary frontend framework due to its structured approach, component-based architecture, and comprehensive ecosystem, which are well-suited for building a feature-rich, single-page application like the RSH.
* **Language:** TypeScript
* **Styling:** Sass (SCSS syntax)
    * *Approach:* Styling will be managed using Sass (SCSS syntax). This preprocessor provides variables, nesting, mixins, and other features that significantly improve CSS maintainability and organization compared to standard CSS, aligning well with Angular's component-based structure. Specific styling for UI components will leverage Angular Material's theming capabilities.
* **UI Library:** Angular Material
    * *Description:* Angular Material will provide pre-built UI components adhering to Material Design principles. This will accelerate development, ensure design consistency across the application, and provide built-in accessibility features for standard elements like buttons, forms, tables, and navigation.
* **State Management:** NgRx (specifically utilizing NgRx Signals / Signal Store for global and complex state)
    * *Description:* Application state will be managed using the NgRx library. This reactive state management approach provides efficient state updates and management, particularly useful for handling complex data flows like the heatmap state, user settings, and fetched data. Local component state will primarily use Angular's built-in signal capabilities for simplicity and performance. NgRx will be structured with clear separation of concerns (actions, reducers, effects, selectors), with effects handling side effects such as API calls.
* **Communication:** Firebase SDKs (Authentication, Firestore) and calls to Firebase Cloud Functions
    * *Approach:* The frontend will interact with the backend using a combination of Firebase SDKs for direct interactions (e.g., Authentication, listening to Firestore data changes) and Angular's `HttpClient` module (orchestrated via NgRx effects) for making calls to Firebase Cloud Functions to fetch data (e.g., initial heatmap data, historical chart data) and send user actions (e.g., saving stock lists, triggering filters).

## 3. Core Features (MVP)

The frontend will implement the following core features:

* User Authentication (Signup, Login - supporting Email/Password & Google Sign-In, Logout).
* Password Reset functionality.
* User Profile and basic Preferences Management (viewing/updating).
* Payment/Subscription Management interface (displaying current status, linking to payment gateway for history/updates - actual payment handling via gateway integration).
* Managing User's Personalized Stock List (Add/Remove tickers, likely via a modal interface).
* Displaying the Relative Strength Heatmap:
    * Color-coded cells based on calculated RS values (0-100 scale, using a configurable gradient).
    * Displaying ticker symbol and the latest calculated RS value in each cell.
    * Clear indicators for data freshness (e.g., displaying a timestamp, labeling data as "Yesterday's Close").
    * Option to sort and visually shade tickers in the heatmap based on data freshness to quickly identify stale data.
* Viewing Detailed Ticker Chart:
    * Display a candlestick price chart with associated volume data for a selected ticker.
    * Candlestick bars will be colored based on the daily RS value for the corresponding period.
    * Allow interactive input of user-defined RS thresholds and visualize simulated buy/sell trade points on the chart where the RS line crosses these thresholds.
    * Provide alternative RS visualization options on the chart (e.g., display RS as a band below the price chart, or in a separate pane).
* Dynamic Ticker Filtering/Highlighting within the heatmap based on user-defined RS thresholds (executed via a backend query).
* Displaying appropriate Loading Indicators during data fetching or processing.
* Implementing user-friendly Error Handling and displaying specific data state/freshness information per ticker rather than generic errors for individual ticker data failures.
* A persistent countdown timer indicating the time until the next scheduled daily data fetch from the backend.
* Public-facing pages: Landing page introducing the app, detailed Documentation/How to Use guide, and dedicated Signup/Login pages.

## 4. Architecture & Structure

* **Component-Based:** Adhere strictly to Angular's component-based architecture for modularity and reusability.
* **Module Structure:** Organize features into distinct Angular modules, utilizing lazy loading for routing where appropriate to optimize initial load times.
* **State Management:** Utilize NgRx for managing application state as detailed in Section 2.
* **Service Layer:** Implement Angular services to encapsulate business logic, orchestrate data fetching by interacting with NgRx effects/actions, and handle cross-cutting concerns (e.g., logging, error handling details).
* **Data Handling:**
    * Always display the most recent data successfully fetched and processed for each ticker.
    * Clearly indicate the freshness/state of data per ticker in the UI.
    * Handle real-time updates for the heatmap and chart data by implementing Firestore listeners where data changes occur, including automatic chart bar color updates and user notifications for newly available data.
* **Routing:** Utilize Angular Router to manage navigation between different views/components based on the URL, including parameterized routes for displaying specific ticker charts.
* **Navigation Structure:** Implement a combination of a collapsible sidebar and a top navigation bar using Angular Material components (Sidenav and Toolbar).
    * **Collapsible Sidebar:** The primary navigation for accessing different application sections (Heatmap, Charts, Account Settings) will be in a sidebar, designed to be collapsible to maximize space for the heatmap.
    * **Top Navigation Bar:** A top bar will contain essential elements like the app logo/title, potentially quick action icons, and user authentication/account status indicators (Login/Signup links when logged out, User Profile link/Logout button when logged in).

## 5. Key Technical Considerations

* **Data Visualization:** Implement the heatmap and chart components efficiently to handle potentially large lists of tickers and historical data, ensuring smooth rendering and interactivity. Leverage the chosen charting library (likely a TechAnJs/D3-based library as mentioned in the broader PRD) effectively. Use Angular's `Renderer2` when necessary for safe and Angular-aware manual DOM manipulation, particularly within charting or heatmap components.
* **Performance:** Apply a range of Angular performance optimization techniques throughout development, including lazy loading of modules, production build optimizations, strategic use of `OnPush` change detection, optimizing data display (e.g., virtual scrolling for long lists), prerendering public pages, optimizing image and CSS delivery, leveraging browser caching, performing regular performance audits, and optimizing initial bundle size.
* **Real-time Updates:** Implement robust Firestore listeners to efficiently update relevant parts of the UI (heatmap cell colors, data freshness indicators, chart bar colors) automatically when underlying data in the database changes, providing users with near real-time information regarding newly available daily data. Implement clear visual notifications, especially when viewing a chart, that new data has loaded.
* **Error Handling & UI Feedback:** Develop a consistent and user-friendly approach to handling errors. Display informative loading states, provide clear general error messages when necessary, and prioritize displaying the state/freshness of individual ticker data even if specific recent data fetches failed, to avoid a completely blank UI.
* **Responsiveness:** While the primary focus for MVP is the desktop web experience, design components with responsiveness in mind, using CSS flexbox/grid and Angular Material's responsive utilities where appropriate, to facilitate future adaptation to smaller screen sizes.

## 6. Testing

* Implement a comprehensive testing strategy encompassing:
    * **Unit Tests:** Using Jest for testing individual functions, services, and component logic in isolation.
    * **Integration Tests:** Testing interactions between components, services, and NgRx state.
    * **End-to-End (E2E) Tests:** Using Cypress to test key user flows through the application in a browser environment.
* Automated test execution will be integrated into the CI/CD pipeline using GitHub Actions to ensure that tests run on every code change. Test coverage targets will be defined and monitored.

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