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
const PARTNER_DATA_READY_TOPIC = 'projects/alpha-vantage-proxy-api/topics/partner-data-ready';

// Run‑type values that we care about (time‑series data). Messages with any other
// runType (e.g., non‑time‑series data) will be ignored.
// Define an enum for the allowed run types – this gives us a clear, typed list
// and makes future additions easier.
export enum RunType {
  TS_DAILY_PRE = 'ts_daily_pre',
  TS_DAILY_POST = 'ts_daily_post',
  TS_WEEKLY_POST = 'ts_weekly_post',
  TS_MONTHLY_POST = 'ts_monthly_post',
}

// Helper Set for quick membership checks (string values of the enum)
const ALLOWED_RUN_TYPES = new Set<string>(Object.values(RunType));

// Pub/Sub subscriber to process runs
export const processDataReadyRun = onMessagePublished(
  // Data‑Ready events are published to the consumer‑agnostic topic defined above
  { topic: PARTNER_DATA_READY_TOPIC, region: 'us-central1' },
  async (event) => {
    let resolvedRunId: string | undefined; // set early so catch can reference safely
    try {
      const message = event.data.message;

      // Decode base64 Pub/Sub data safely and parse JSON
      const dataBase64 = typeof message.data === 'string' ? message.data : '';
      const rawData = dataBase64 ? Buffer.from(dataBase64, 'base64').toString('utf8') : '{}';
      let payload: Record<string, any> = {};
      try {
        payload = JSON.parse(rawData);
      } catch (parseErr: any) {
        logger.error('Invalid Pub/Sub JSON payload', { rawData, error: parseErr?.message });
        throw new Error('Invalid JSON in Pub/Sub message');
      }

      // ---------------------------------------------------------------------
      // Determine runType (prefer attribute, fallback to payload)
      // ---------------------------------------------------------------------
      const attrRunType = message.attributes?.runType as string | undefined;
      const payloadRunType = (payload.runType as string | undefined) ?? (payload.run_type as string | undefined);
      const runType = attrRunType ?? payloadRunType;
      if (!runType || !ALLOWED_RUN_TYPES.has(runType)) {
        logger.info(`Skipping Data‑Ready message with unsupported or missing runType: ${runType}`, {
          attributes: message.attributes,
        });
        // Exit early – the message will be considered successfully processed.
        return;
      }

      // ---------------------------------------------------------------------
      // Resolve runId (prefer attribute, fallback to payload)
      // ---------------------------------------------------------------------
      const attrRunId = message.attributes?.runId as string | undefined;
      resolvedRunId = attrRunId ?? (payload.runId as string | undefined) ?? (payload.run_id as string | undefined);
      if (!resolvedRunId || typeof resolvedRunId !== 'string' || resolvedRunId.trim().length === 0) {
        logger.error('Missing or invalid runId in message; skipping update to Firestore', {
          attributes: message.attributes,
          payload,
        });
        return; // Do not attempt to write to Firestore with an invalid path
      }

      // Update run status to processing (merge to create if missing)
      await db
        .collection('runs')
        .doc(resolvedRunId)
        .set(
          {
            status: 'processing',
            startTime: admin.firestore.FieldValue.serverTimestamp(),
            runType,
          },
          { merge: true }
        );

      // Compute RS for registered pairs (placeholder for full RS logic)
      // Query pairRegistry, fetch OHLCV from SavantAPI, calculate RS, update pairs/*
      await db
        .collection('runs')
        .doc(resolvedRunId)
        .set(
          {
            status: 'completed',
            endTime: admin.firestore.FieldValue.serverTimestamp(),
            baselinesProcessed: payload.baselinesUpdatedCount || 0,
            symbolsProcessed: payload.symbolsUpdatedCount || 0,
          },
          { merge: true }
        );

      logger.info(`Processed run ${resolvedRunId} successfully`);
    } catch (error: any) {
      logger.error('Pub/Sub processing error', error);
      if (resolvedRunId) {
        await db
          .collection('runs')
          .doc(resolvedRunId)
          .set(
            {
              status: 'failed',
              error: error?.message ?? String(error),
              endTime: admin.firestore.FieldValue.serverTimestamp(),
            },
            { merge: true }
          );
      }
    }
  }
);