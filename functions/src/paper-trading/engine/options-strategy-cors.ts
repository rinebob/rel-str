/**
 *
 * Centralized CORS allowlist for options strategy callable functions.
 *
 * Keep this list side-effect-free so it can be imported anywhere without
 * pulling in firebase-admin or other runtime dependencies.
 */

export const OPTIONS_STRATEGY_ALLOWED_ORIGINS = [
  'https://rel-str--rel-str.web.app',
  'https://rel-str--rel-str.us-central1.hosted.app',
  'https://rel-str.web.app',
  'https://savanttrader.com',
  'https://www.savanttrader.com',
  'http://localhost:4200',
  'http://localhost:4210',
  'http://localhost:5000',
];
