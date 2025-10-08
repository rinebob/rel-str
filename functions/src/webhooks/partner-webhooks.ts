import { onMessagePublished } from 'firebase-functions/v2/pubsub';
import { logger } from 'firebase-functions';
import * as admin from 'firebase-admin';

// Initialize Firebase Admin
if (!admin.apps.length) {
  admin.initializeApp();
}

const db = admin.firestore();

// NOTE: The HTTP webhook endpoint has been removed. All notifications are now handled via Pub/Sub.

// Pub/Sub topic constant (used by the subscriber below)
const PARTNER_DATA_READY_TOPIC = 'partner-data-ready';

// Pub/Sub subscriber to process runs
export const processDataReadyRun = onMessagePublished(
  // Data‑Ready events are published to the consumer‑agnostic topic defined above
  { topic: PARTNER_DATA_READY_TOPIC, region: 'us-central1' },
  async (event) => {
    try {
      const message = event.data.message;
      const payload = JSON.parse(message.data.toString());

      const runId = payload.runId;

      // Update run status to processing
      await db.collection('runs').doc(runId).update({
        status: 'processing',
        startTime: admin.firestore.FieldValue.serverTimestamp(),
      });

      // Compute RS for registered pairs (placeholder for full RS logic)
      // Query pairRegistry, fetch OHLCV from SavantAPI, calculate RS, update pairs/*
      await db.collection('runs').doc(runId).update({
        status: 'completed',
        endTime: admin.firestore.FieldValue.serverTimestamp(),
        baselinesProcessed: payload.baselinesUpdatedCount || 0,
        symbolsProcessed: payload.symbolsUpdatedCount || 0,
      });

      logger.info(`Processed run ${runId} successfully`);
    } catch (error: any) {
      logger.error('Pub/Sub processing error', error);
      await db.collection('runs').doc(event.data.message.attributes?.runId).update({
        status: 'failed',
        error: error.message,
      });
    }
  }
);