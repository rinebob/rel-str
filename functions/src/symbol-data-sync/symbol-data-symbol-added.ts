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
import { db, FieldValue } from '../firebase-admin-init';
import {
  DEFAULT_SYMBOL_LIST_NAME,
  RH_AGENT_SYMBOLS_COLLECTION,
  RH_AGENT_SYMBOL_LISTS_COLLECTION,
  RhAgentSymbol,
  RhAgentSymbolSource,
} from '../common/rh-agent-collections';
import { fetchAndWriteSymbolOverview } from '../common/rh-agent-overview-helper';

/** Deadline for the single-symbol RH Agent run triggered after onboarding. */
const RUN_DEADLINE_MINUTES = 30;

interface SymbolAddedPayloadV1 {
  version: 'v1';
  symbols: string[];
  createdAtUTC: string;
  status: 'ready';
  availableIntervals: string[];
  /** Optional source tag; defaults to RhAgentSymbolSource.ManualAdd. */
  source?: string;
}

/** Validate that the parsed payload matches the expected V1 shape.
 * Returns null for unsupported-but-ackable payloads (wrong version/status,
 * malformed symbols, etc.) so Pub/Sub does not retry them. */
function validateSymbolAddedPayload(
  raw: unknown,
): { body: SymbolAddedPayloadV1 | null; reason?: string } {
  const body = raw as Partial<SymbolAddedPayloadV1>;
  if (body?.version !== 'v1') {
    return { body: null, reason: `unsupported version: ${body?.version}` };
  }
  if (body.status !== 'ready') {
    return { body: null, reason: `unsupported status: ${body.status}` };
  }
  if (!Array.isArray(body.symbols) || body.symbols.some((s) => typeof s !== 'string' || s.length === 0)) {
    return { body: null, reason: 'malformed symbols' };
  }
  if (typeof body.createdAtUTC !== 'string' || body.createdAtUTC.length === 0) {
    return { body: null, reason: 'missing or malformed createdAtUTC' };
  }
  if (!Array.isArray(body.availableIntervals)) {
    return { body: null, reason: 'malformed availableIntervals' };
  }
  return {
    body: {
      version: 'v1',
      symbols: body.symbols,
      createdAtUTC: body.createdAtUTC,
      status: 'ready',
      availableIntervals: body.availableIntervals,
      source: typeof body.source === 'string' ? body.source : undefined,
    },
  };
}

/**
 * Decode and validate a partner-symbol-added Pub/Sub message.
 */
function decodeSymbolAddedMessage(message: {
  data?: string;
  attributes?: Record<string, string>;
}): { body: SymbolAddedPayloadV1 | null; attributes: Record<string, string>; reason?: string } {
  if (!message.data) {
    throw new Error('Missing message data');
  }
  const jsonString = Buffer.from(message.data, 'base64').toString('utf8');
  const raw = JSON.parse(jsonString);
  const { body, reason } = validateSymbolAddedPayload(raw);
  return { body, reason, attributes: message.attributes || {} };
}

/** Add a symbol to the default PRIMARY watchlist. */
async function addSymbolToDefaultList(symbol: string): Promise<void> {
  await db.collection(RH_AGENT_SYMBOL_LISTS_COLLECTION).doc(DEFAULT_SYMBOL_LIST_NAME).set(
    { name: DEFAULT_SYMBOL_LIST_NAME, symbols: FieldValue.arrayUnion(symbol) },
    { merge: true },
  );
}

/** Trigger a single-symbol RH Agent run for a newly onboarded symbol. */
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
 *   2. Enables the symbol for RH Agent scanning.
 *   3. Adds the symbol to the default PRIMARY watchlist.
 *   4. Fetches company overview so the symbol is reviewable right away.
 *   5. Creates a one-symbol RH Agent run and enqueues the worker task so the
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
      createdAtUTC: body.createdAtUTC,
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
          const symbolDocRef = db.collection(RH_AGENT_SYMBOLS_COLLECTION).doc(symbol);
          const symbolDoc: RhAgentSymbol = {
            symbol,
            enabled: true,
            createdAt: body.createdAtUTC || new Date().toISOString(),
            source: body.source || RhAgentSymbolSource.MANUAL_ADD,
          };
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
