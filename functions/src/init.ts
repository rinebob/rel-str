import { setGlobalOptions } from 'firebase-functions/v2';

// Global defaults for all v2 functions in this project.
// Use the allowlisted SA for SavantAPI; allow override via env PARTNER_CALLER_SA.
setGlobalOptions({
  region: 'us-central1',
  serviceAccount: process.env.PARTNER_CALLER_SA || 'rel-str-partner-caller-prod@rel-str.iam.gserviceaccount.com',
});
