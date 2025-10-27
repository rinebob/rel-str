import { setGlobalOptions } from 'firebase-functions/v2';

// Global defaults for all v2 functions in this project.
// Use the allowlisted SA for SavantAPI in production; allow override via env PARTNER_CALLER_SA.
// In the local emulator, omit serviceAccount so Firebase uses default application credentials.
const isEmulator = process.env.FUNCTIONS_EMULATOR === 'true' || !!process.env.FIREBASE_EMULATOR_HUB;
const sa = process.env.PARTNER_CALLER_SA || 'rel-str-partner-caller-prod@rel-str.iam.gserviceaccount.com';

setGlobalOptions({
  region: 'us-central1',
  ...(isEmulator ? {} : { serviceAccount: sa }),
});
