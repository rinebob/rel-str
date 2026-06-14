import { getApp, getApps, initializeApp, App } from 'firebase-admin/app';
import { getFirestore, Firestore, FieldValue } from 'firebase-admin/firestore';

// Centralized Firebase Admin SDK initialization for Functions v2
// - Avoids duplicate init blocks across files
// - Sets ignoreUndefinedProperties to prevent Firestore write errors
// - Safely handles emulator vs Cloud Run/Gen2 runtime

let app: App;
let db: Firestore;

const isRunningOnCloudRun = !!process.env.K_SERVICE; // Present on Cloud Run/Gen2 Functions
const useEmulators = process.env.FUNCTIONS_EMULATOR === 'true' && !isRunningOnCloudRun;

if (getApps().length === 0) {
  // In both emulator and production, a parameterless initializeApp() will
  // pick up Application Default Credentials appropriately.
  initializeApp();
}

app = getApp();
db = getFirestore(app);
// Prevent undefined fields from causing write failures
// (e.g., ptPublishTime or nested errorSamples properties)
db.settings({ ignoreUndefinedProperties: true });

if (useEmulators) {
  // Optional emulator hints (do not force on Cloud Run)
  // Firestore emulator host is typically provided by the shell via env
  // FIRESTORE_EMULATOR_HOST; we can log for confirmation if needed.
  // Auth emulator can be hinted via env as well.
  if (!process.env.FIREBASE_AUTH_EMULATOR_HOST) {
    // Example: process.env.FIREBASE_AUTH_EMULATOR_HOST = 'localhost:9099';
  }
}

export { db, FieldValue };
