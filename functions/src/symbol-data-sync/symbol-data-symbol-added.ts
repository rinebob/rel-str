/**
 * Symbol-Data Symbol-Added Consumer
 *
 * Listens to the partner `partner-symbol-added` Pub/Sub topic. When a new symbol
 * is added to the partner's tracked-symbols list and its full D/W/M history has
 * been backfilled by the partner, this consumer fetches the symbol's full
 * history into `symbol-data/{symbol}`, enables it in `rh-agent-symbols`, and
 * triggers a single-symbol RH Agent run so the new symbol is immediately
 * reviewable.
 *
 * This keeps RS self-sufficient: a symbol added during the trading day is ready
 * before the next scheduled intraday or nightly run, so the normal PDR/nightly
 * loops do not need a special missing-symbol path.
 */
import { onMessagePublished } from 'firebase-functions/v2/pubsub';
import { logger } from 'firebase-functions';
import { PARTNER_SYMBOL_ADDED_TOPIC } from '../webhooks/webhooks-config';
import { createDailyRun, getDeadlineISO } from '../common/rh-agent-run-creation';
import { createJobAndEnqueue } from '../common/rh-agent-job-enqueueing';
import {
  getMarketDatePT,
  getRunDatePT,
  getRunIdPT,
} from '../common/pt-date-utils';
import { syncSymbolToSymbolData } from './symbol-data-backfill';
import { db } from '../firebase-admin-init';
import { RH_AGENT_SYMBOLS_COLLECTION } from '../common/rh-agent-collections';

interface SymbolAddedPayloadV1 {
  version: 'v1';
  symbols: string[];
  addedAtUTC: string;
  status: 'ready';
  availableIntervals: string[];
}

/**
 * Decode and validate a partner-symbol-added Pub/Sub message.
 */
function decodeSymbolAddedMessage(message: {
  data?: string;
  attributes?: Record<string, string>;
}): { body: SymbolAddedPayloadV1; attributes: Record<string, string> } {
  if (!message.data) {
    throw new Error('Missing message data');
  }
  const jsonString = Buffer.from(message.data, 'base64').toString('utf8');
  const body = JSON.parse(jsonString) as SymbolAddedPayloadV1;
  return { body, attributes: message.attributes || {} };
}

/**
 * Pub/Sub consumer for partner-symbol-added messages.
 *
 * For each symbol in the payload:
 *   1. Runs a full backfill into symbol-data.
 *   2. Enables the symbol for RH Agent scanning.
 *   3. Creates a one-symbol RH Agent run and enqueues the worker task so the
 *      symbol is immediately reviewable.
 *
 * Failures for one symbol do not block processing of the others.
 */
export const processSymbolAdded = onMessagePublished(
  {
    topic: PARTNER_SYMBOL_ADDED_TOPIC,
    region: 'us-central1',
    memory: '512MiB',
    timeoutSeconds: 300,
  },
  async (event) => {
    const { body, attributes } = decodeSymbolAddedMessage(event.data.message);

    if (body.version !== 'v1') {
      logger.warn('symbol_data_symbol_added_unsupported_version', {
        version: body.version,
        attributes,
      });
      return;
    }

    if (body.status !== 'ready') {
      logger.warn('symbol_data_symbol_added_unsupported_status', {
        status: body.status,
        attributes,
      });
      return;
    }

    if (!Array.isArray(body.symbols)) {
      logger.warn('symbol_data_symbol_added_malformed_symbols', {
        symbolsType: typeof body.symbols,
        attributes,
      });
      return;
    }

    const symbols = body.symbols.filter((s): s is string => typeof s === 'string' && s.length > 0);
    if (symbols.length === 0) {
      logger.warn('symbol_data_symbol_added_no_symbols', { attributes });
      return;
    }

    logger.info('symbol_data_symbol_added_received', {
      symbolCount: symbols.length,
      addedAtUTC: body.addedAtUTC,
      availableIntervals: body.availableIntervals,
      attributes,
    });

    const results = await Promise.all(
      symbols.map(async (symbol) => {
        try {
          const result = await syncSymbolToSymbolData(symbol, true);
          logger.info('symbol_data_symbol_added_processed', {
            symbol,
            status: result.status,
            dailyCount: result.dailyCount,
            weeklyCount: result.weeklyCount,
            monthlyCount: result.monthlyCount,
            error: result.error,
          });

          if (result.status !== 'ok') {
            return { symbol, ok: false, error: result.error ?? 'backfill not ok' };
          }

          // Enable the symbol for RH Agent scanning
          await db.collection(RH_AGENT_SYMBOLS_COLLECTION).doc(symbol).set(
            { symbol, enabled: true },
            { merge: true },
          );

          // Trigger a single-symbol RH Agent run so the symbol is reviewable
          // immediately instead of waiting for the next nightly/PDR run.
          const marketDate = getMarketDatePT();
          const runStartedAt = new Date().toISOString();
          const runDate = getRunDatePT();
          const uniqueRunId = `${getRunIdPT(runDate, 'symbol-added')}_${symbol}`;
          const runId = await createDailyRun(
            marketDate,
            1,
            getDeadlineISO(30),
            'symbol-added',
            uniqueRunId,
            runDate,
            'symbol-added',
          );
          await createJobAndEnqueue(
            runId,
            symbol,
            marketDate,
            runStartedAt,
            'symbol-added',
          );

          logger.info('symbol_data_symbol_added_agent_run_enqueued', {
            symbol,
            runId,
            marketDate,
          });

          return { symbol, ok: true };
        } catch (err: any) {
          logger.error('symbol_data_symbol_added_error', {
            symbol,
            error: err?.message,
          });
          return { symbol, ok: false, error: err?.message };
        }
      }),
    );

    const okCount = results.filter((r) => r.ok).length;
    const failed = results.filter((r) => !r.ok);

    logger.info('symbol_data_symbol_added_complete', {
      total: symbols.length,
      ok: okCount,
      failed: failed.length,
      failedSymbols: failed.map((f) => f.symbol),
    });

    if (failed.length > 0) {
      // Throw so Pub/Sub retries the whole message. Individual symbol failures
      // are logged; a retry will re-run syncSymbolToSymbolData which is
      // idempotent for existing data.
      throw new Error(
        `Failed to backfill symbols: ${failed.map((f) => `${f.symbol} (${f.error})`).join(', ')}`,
      );
    }
  },
);
