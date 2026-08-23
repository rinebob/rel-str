/**
 * SDS (symbolDataSync) — PDR-triggered Pub/Sub subscriber.
 *
 * Thin entry point: parses the Pub/Sub message, delegates to handlePdrMessage
 * with real GCP dependencies (Firestore, Cloud Tasks, partner API).
 */

import { onMessagePublished } from 'firebase-functions/v2/pubsub';
import { getFunctions } from 'firebase-admin/functions';
import { logger } from 'firebase-functions';
import { db } from '../firebase-admin-init';
import { callPartnerTrackedSymbols, callPartnerIntradaySnapshotV2 } from '../partner-proxy';
import { PARTNER_DATA_READY_TOPIC } from '../webhooks/webhooks-config';
import { handlePdrMessage, type SdsTaskPayload } from './sds-core';

interface PubSubMessage {
  messageId?: string;
  publishTime?: string;
  data?: string;
  attributes?: Record<string, string>;
}

export const symbolDataSync = onMessagePublished(
  { topic: PARTNER_DATA_READY_TOPIC, region: 'us-central1', timeoutSeconds: 120, memory: '512MiB' },
  async (event) => {
    const message = event.data.message as PubSubMessage;
    if (!message) {
      logger.warn('sds_no_message');
      return;
    }

    // Decode payload — always use message.data with base64 decode (matching PDRv2 V2 pattern).
    // Do NOT use message.json — the Firebase SDK getter throws when parsing fails,
    // which prevents the fallback from running.
    let parsedPayload: Record<string, unknown> = {};
    try {
      const raw = typeof message.data === 'string'
        ? Buffer.from(message.data, 'base64').toString('utf8')
        : '{}';
      parsedPayload = JSON.parse(raw || '{}');
    } catch (err) {
      logger.warn('sds_payload_parse_failed', {
        runId: message.attributes?.runId,
        error: err instanceof Error ? err.message : String(err),
      });
    }

    const attributes: Record<string, string | undefined> = { ...message.attributes };

    const queue = getFunctions().taskQueue('symbolDataSyncWorker');
    const deps = {
      db,
      async enqueueTask(payload: SdsTaskPayload) {
        await queue.enqueue(payload);
      },
      async getTrackedSymbols() {
        const resp = await callPartnerTrackedSymbols();
        const raw: any[] = resp.symbols ?? [];
        return raw.map(s => (typeof s === 'string' ? s : s?.symbol)).filter(Boolean);
      },
      async fetchIntradaySnapshot(symbols: string[]) {
        const resp = await callPartnerIntradaySnapshotV2(symbols);
        return resp.snapshots.map((s) => ({
          symbol: s.symbol,
          ip: s.ip,
          ipc: s.ipc,
          io: s.io,
          it: s.it,
          ic: s.ic,
        }));
      },
    };

    const result = await handlePdrMessage(attributes, parsedPayload, deps);
    logger.info('sds_pdr_handled', { runId: attributes.runId, ...result });
  },
);
