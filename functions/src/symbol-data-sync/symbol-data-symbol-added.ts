/**
 * Symbol-Data Symbol-Added Consumer
 *
 * Listens to the partner `partner-symbol-added` Pub/Sub topic. When a new symbol
 * is added to the partner's tracked-symbols list and its full D/W/M history has
 * been backfilled by the partner, this consumer fetches the symbol's full
 * history into `symbol-data/{symbol}`, enables it in `symbol-meta`, and
 * triggers a single-symbol ST run so the new symbol is immediately
 * reviewable.
 *
 * This keeps RS self-sufficient: a symbol added during the trading day is ready
 * before the next scheduled intraday or nightly run, so the normal PDR/nightly
 * loops do not need a special missing-symbol path.
 */
import { onMessagePublished } from 'firebase-functions/v2/pubsub';
import { logger } from 'firebase-functions';
import { PARTNER_SYMBOL_ADDED_TOPIC } from '../webhooks/webhooks-config';
import { createDailyRun, getDeadlineISO } from '../common/st-run-creation';
import { createJobAndEnqueue } from '../common/st-job-enqueueing';
import {
  getMarketDatePT,
  getRunDatePT,
  getRunIdPT,
} from '../common/pt-date-utils';
import { syncSymbolToSymbolData } from './symbol-data-backfill';
import { db, FieldValue } from '../firebase-admin-init';
import {
  DEFAULT_SYMBOL_LIST_NAME,
  ST_SYMBOLS_COLLECTION,
  ST_SYMBOL_LISTS_COLLECTION,
  StSymbol,
} from '../common/st-collections';
import { fetchAndWriteSymbolOverview } from '../common/st-overview-helper';
import { decodeSymbolAddedMessage, normalizeSource } from '../common/st-symbol-added-helpers';

/** Deadline for the single-symbol ST run triggered after onboarding. */
const RUN_DEADLINE_MINUTES = 30;

/** Add a symbol to the default PRIMARY watchlist. */
async function addSymbolToDefaultList(symbol: string): Promise<void> {
  await db.collection(ST_SYMBOL_LISTS_COLLECTION).doc(DEFAULT_SYMBOL_LIST_NAME).set(
    { name: DEFAULT_SYMBOL_LIST_NAME, symbols: FieldValue.arrayUnion(symbol) },
    { merge: true },
  );
}

/** Trigger a single-symbol ST run for a newly onboarded symbol. */
async function triggerSymbolAddedRun(symbol: string): Promise<void> {
  const marketDate = getMarketDatePT();
  const runStartedAt = new Date().toISOString();
  const runDate = getRunDatePT();
  const uniqueRunId = `${getRunIdPT(runDate, 'symbol-added')}_${symbol}`;
  const runId = await createDailyRun(
    marketDate,
    1,
    getDeadlineISO(RUN_DEADLINE_MINUTES),
    'symbol-added',
    uniqueRunId,
    runDate,
    'symbol-added',
  );
  await createJobAndEnqueue(runId, symbol, marketDate, runStartedAt, 'symbol-added');
  logger.info('symbol_data_symbol_added_agent_run_enqueued', { symbol, runId, marketDate });
}

/**
 * Pub/Sub consumer for partner-symbol-added messages.
 *
 * For each symbol in the payload:
 *   1. Runs a full backfill into symbol-data.
 *   2. Enables the symbol for ST scanning.
 *   3. Adds the symbol to the default PRIMARY watchlist.
 *   4. Fetches company overview so the symbol is reviewable right away.
 *   5. Creates a one-symbol ST run and enqueues the worker task so the
 *      symbol is immediately reviewable.
 *
 * Failures for one symbol do not block processing of the others, and the
 * message is acknowledged even if some symbols fail. Failed symbols are logged
 * and must be handled manually or by a separate retry mechanism.
 */
export const processSymbolAdded = onMessagePublished(
  {
    topic: PARTNER_SYMBOL_ADDED_TOPIC,
    region: 'us-central1',
    memory: '512MiB',
    timeoutSeconds: 300,
  },
  async (event) => {
    const { body, attributes, reason } = decodeSymbolAddedMessage(event.data.message);

    if (!body) {
      logger.warn('symbol_data_symbol_added_unsupported', { reason, attributes });
      return;
    }

    const symbols = body.symbols.map((s) => s.trim()).filter((s) => s.length > 0);
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

          // Create/enable the symbol with the same doc shape as the seed path.
          // Preserve an existing createdAt so a redelivery cannot reset it.
          const symbolDocRef = db.collection(ST_SYMBOLS_COLLECTION).doc(symbol);
          const existingSnap = await symbolDocRef.get();
          const existingData = existingSnap.data() as Partial<StSymbol> | undefined;
          const source = normalizeSource(body.source);
          if (body.source && source !== body.source) {
            logger.warn('symbol_data_symbol_added_source_normalized', {
              symbol,
              original: body.source,
              source,
            });
          }

          const symbolDoc: Partial<StSymbol> = {
            symbol,
            enabled: true,
            source,
          };
          if (!existingData?.createdAt) {
            symbolDoc.createdAt = body.addedAtUTC || new Date().toISOString();
          }
          await symbolDocRef.set(symbolDoc, { merge: true });

          // Best-effort follow-up steps: list add, overview fetch, and run trigger
          // can run in parallel once the symbol doc exists.
          await Promise.all([
            addSymbolToDefaultList(symbol).catch((err) => {
              logger.warn('symbol_data_symbol_added_list_failed', { symbol, error: err?.message });
            }),
            fetchAndWriteSymbolOverview(symbol).catch((err) => {
              logger.warn('symbol_data_symbol_added_overview_failed', { symbol, error: err?.message });
            }),
            triggerSymbolAddedRun(symbol).catch((err) => {
              logger.warn('symbol_data_symbol_added_run_failed', { symbol, error: err?.message });
            }),
          ]);

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
  },
);
