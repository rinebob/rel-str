/**
 * Centralized CORS allowlist for RH Agent callable functions.
 *
 * Use this array for every RH Agent callable so origins stay consistent across
 * manual run, status, run history, indicator series, and trade executor functions.
 *
 * Keep this list side-effect-free so it can be imported anywhere without pulling
 * in firebase-admin or other runtime dependencies.
 */

export const RH_AGENT_ALLOWED_ORIGINS = [
  'https://rel-str--rel-str.web.app',
  'https://rel-str--rel-str.us-central1.hosted.app',
  'https://rel-str.web.app',
  'https://savanttrader.com',
  'https://www.savanttrader.com',
  'http://localhost:4200',
  'http://localhost:4210',
  'http://localhost:5000',
];
