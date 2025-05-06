# User Flow - Relative Strength Heatmap (MVP) - Combined

## 1. Introduction

This document outlines the primary user journeys and interaction flows for the Minimum Viable Product (MVP) of the Relative Strength Heatmap (RSH) application. These flows cover the essential tasks users will perform, from account management to interacting with the core data visualization features. The application will also feature a persistent **countdown timer** indicating the time until the next scheduled data fetch, providing users with transparency on data freshness.

## 2. Key User Journeys

The following are the five key user journeys identified for the MVP that represent core user interactions and application functionality:

1.  User Sign Up Flow
2.  User Login Flow
3.  Logged-in User Views Heatmap
4.  User Manages Stock List
5.  User Views Ticker Chart

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