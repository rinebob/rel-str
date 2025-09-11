# Security - Relative Strength Heatmap (MVP) - Combined

## 1. Introduction

This document outlines the security strategy and considerations for the Minimum Viable Product (MVP) of the Relative Strength Heatmap (RSH) application, leveraging the security features provided by the Firebase platform and implementing best practices.

## 2. Authentication and Authorization

* **Authentication:** User authentication will be handled entirely by **Firebase Authentication**, supporting Email/Password and Google Sign-In.
* **Authorization (Data Access):** Access control to data stored in Firebase Firestore will be strictly enforced using **Firebase Firestore Security Rules**. These rules will ensure that users can only read and write their own data (profiles, preferences, stock lists, payment history) based on their authenticated User ID (UID).
* **Authorization (Cloud Function Access):** Access to sensitive or administrative operations implemented in Firebase Cloud Functions will be controlled within the function code. Cloud Functions will verify the user's authentication state using `context.auth` and check the user's role (e.g., 'admin' status stored in their Firestore user document) before executing restricted logic.
* **Role Management:** A mechanism to designate user roles (e.g., 'admin', different subscription tiers) will be implemented, and these roles will be used to enforce feature access and permissions via Firestore Security Rules and Cloud Function logic.
* **Secure Token Handling:** Authentication tokens will be handled securely by the Firebase SDKs on the frontend and the Firebase Admin SDK on the backend.

## 3. Data Security

* **Data in Transit:** All communication with Firebase services and between Firebase Cloud Functions and external services will utilize **HTTPS/SSL** to ensure data is encrypted during transmission.
* **Data at Rest:** Data stored in Firebase Firestore and other Google Cloud services is automatically **encrypted at rest** by Google.
* **Protecting Secrets:** Third-party API keys and other sensitive secrets (e.g., payment gateway keys, SMS service keys) will **not** be stored in frontend code. They will be stored securely using **Firebase Environment Configuration** or **Google Cloud Secret Manager** and accessed only by authorized Firebase Cloud Functions.
* **Input Validation:** Data received from the frontend will be validated and sanitized within Cloud Functions and potentially by Firestore Security Rules before being processed or written to the database to prevent invalid or malicious data.

## 4. API Security

* **Unauthorized Access to Cloud Functions:** Access to Callable and HTTPS Cloud Functions will be restricted based on authentication status (`context.auth`) and authorization logic (role/permissions check) within the function code.
* **Data Tampering:** Firestore Security Rules are the primary defense against unauthorized data modification attempts via direct SDK access.
* **Denial of Service (DoS) / Abuse Protection:** Firebase's built-in quotas and scaling provide some protection. Explicit **rate limiting** will be implemented for potentially resource-intensive user-triggered Cloud Functions (like the dynamic threshold query) to prevent abuse.
* **Injection Vulnerabilities:** User input will be validated and sanitized in Cloud Functions to mitigate injection risks. Firebase SDK methods should be used correctly for database interactions.
* **Information Leakage:** Generic error messages will be returned to the frontend, with detailed errors logged securely on the backend.

## 5. Partner Endpoint Security (External Integrations)

* Auth method: Google OIDC ID tokens minted for the function URL (audience = exact URL).
* Allowlist: Environment variable `ALLOWED_SERVICE_ACCOUNT_EMAILS` controls which service account emails are accepted.
* Header: `Authorization: Bearer <id_token>`; token must include an `email` claim matching the allowlist.
* Angular app does not call partner endpoints; only backend-to-backend integrations use this flow.

## 6. Vulnerability Management

* **Dependency Management:** Regularly update project dependencies (npm packages) and use tools like `npm audit` to identify and address known security vulnerabilities in libraries.
* **Staying Informed:** Monitor security advisories and best practices for relevant technologies (Angular, Node.js, Firebase).
* **Leverage Firebase Features:** Ensure correct configuration and utilization of Firebase and Google Cloud security features.
* **Secure Coding:** Follow secure coding principles, including robust validation and proper output encoding (though Angular provides built-in XSS protection).
* **Basic Response:** Have a basic plan for assessing and addressing reported or discovered vulnerabilities quickly.