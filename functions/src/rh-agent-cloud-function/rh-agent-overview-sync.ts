/**
 * RH Agent Company Overview Sync
 *
 * Fetches SA company overview data for all enabled rh-agent-symbols and
 * writes the result back onto the symbol doc for grouping/sorting in the UI.
 *
 * Architecture:
 *   - rhAgentOverviewSyncWeekly (scheduler, Sundays 6 AM UTC)
 *       → loads all enabled symbols, enqueues one Cloud Task per symbol
 *   - rhAgentOverviewSyncAdmin (callable) — manual full backfill trigger
 *   - rhAgentOverviewSyncSymbol (task worker)
 *       → calls partnerCompanyOverviewV2 for one symbol, writes to Firestore
 *
 * SA endpoint: partnerCompanyOverviewV2?symbol={SYMBOL}
 * All fields returned as strings — parsed defensively (handles "None").
 * Returns 404 for non-equity symbols (ETFs, indexes) — skipped gracefully.
 * TTL: 7 days (matches SA refresh cadence).
 */
import { onSchedule } from 'firebase-functions/v2/scheduler';
import { onCall } from 'firebase-functions/v2/https';
import { onTaskDispatched } from 'firebase-functions/v2/tasks';
import { getFunctions } from 'firebase-admin/functions';
import { logger } from 'firebase-functions';
import { FieldValue } from 'firebase-admin/firestore';

import { db } from '../firebase-admin-init';
import { callPartnerCompanyOverview } from '../partner-proxy';
import { PartnerCompanyOverviewResponse } from '../types/partner';
import { RH_AGENT_SYMBOLS_COLLECTION } from './rh-agent-config';

// ============================================================================
// Constants
// ============================================================================

const OVERVIEW_TASK_QUEUE = 'rhAgentOverviewSyncSymbol';

/** Re-fetch if overviewFetchedAt is older than this many days. */
const OVERVIEW_TTL_DAYS = 7;

// ============================================================================
// Types
// ============================================================================

/** Parsed overview fields written to rh-agent-symbols/{SYMBOL}. */
export interface RhAgentOverviewFields {
  name?: string;
  sector?: string;
  industry?: string;
  exchange?: string;
  assetType?: string;
  marketCap?: number;
  marketCapTier?: 'mega' | 'large' | 'mid' | 'small' | 'micro';
  beta?: number;
  peRatio?: number;
  forwardPe?: number;
  week52High?: number;
  week52Low?: number;
  ma200?: number;
  ma50?: number;
  dividendYield?: number;
  analystTarget?: number;
  analystBuys?: number;
  analystSells?: number;
  overviewFetchedAt: FirebaseFirestore.FieldValue | FirebaseFirestore.Timestamp;
}

// ============================================================================
// Helpers
// ============================================================================

/** Parse a string field to number — returns undefined for "None" or non-numeric. */
function parseNum(val: string | undefined): number | undefined {
  if (!val || val === 'None' || val === '-') return undefined;
  const n = parseFloat(val);
  return isNaN(n) ? undefined : n;
}

/** Derive market cap tier from raw market cap value in USD. */
function deriveMarketCapTier(marketCap: number | undefined): RhAgentOverviewFields['marketCapTier'] {
  if (marketCap == null) return undefined;
  if (marketCap >= 200e9)  return 'mega';
  if (marketCap >= 10e9)   return 'large';
  if (marketCap >= 2e9)    return 'mid';
  if (marketCap >= 300e6)  return 'small';
  return 'micro';
}

/** Map raw AV data fields (all strings) to our stored overview shape. */
function parseOverviewData(data: Record<string, string>): Omit<RhAgentOverviewFields, 'overviewFetchedAt'> {
  const marketCap = parseNum(data['MarketCapitalization']);
  const analystBuys =
    (parseNum(data['AnalystRatingBuy']) ?? 0) +
    (parseNum(data['AnalystRatingStrongBuy']) ?? 0);
  const analystSells =
    (parseNum(data['AnalystRatingSell']) ?? 0) +
    (parseNum(data['AnalystRatingStrongSell']) ?? 0);

  return {
    name:          data['Name']     || undefined,
    sector:        data['Sector']   || undefined,
    industry:      data['Industry'] || undefined,
    exchange:      data['Exchange'] || undefined,
    assetType:     data['AssetType'] || undefined,
    marketCap,
    marketCapTier: deriveMarketCapTier(marketCap),
    beta:          parseNum(data['Beta']),
    peRatio:       parseNum(data['PERatio']),
    forwardPe:     parseNum(data['ForwardPE']),
    week52High:    parseNum(data['52WeekHigh']),
    week52Low:     parseNum(data['52WeekLow']),
    ma200:         parseNum(data['200DayMovingAverage']),
    ma50:          parseNum(data['50DayMovingAverage']),
    dividendYield: parseNum(data['DividendYield']),
    analystTarget: parseNum(data['AnalystTargetPrice']),
    analystBuys:   analystBuys > 0 ? analystBuys : undefined,
    analystSells:  analystSells > 0 ? analystSells : undefined,
  };
}

/** Load all enabled symbol IDs from rh-agent-symbols. */
async function loadEnabledSymbolIds(): Promise<string[]> {
  const snap = await db
    .collection(RH_AGENT_SYMBOLS_COLLECTION)
    .where('enabled', '==', true)
    .get();
  return snap.docs.map((d) => d.data().symbol as string || d.id);
}

/** Check if overview data is still fresh (within TTL). */
function isOverviewFresh(fetchedAt: FirebaseFirestore.Timestamp | undefined): boolean {
  if (!fetchedAt) return false;
  const ageMs = Date.now() - fetchedAt.toMillis();
  return ageMs < OVERVIEW_TTL_DAYS * 24 * 60 * 60 * 1000;
}

/** Enqueue one overview sync task per symbol. */
async function enqueueOverviewTasks(symbols: string[], forceRefresh = false): Promise<{ enqueued: number; skipped: number }> {
  const queue = getFunctions().taskQueue(OVERVIEW_TASK_QUEUE);
  let enqueued = 0;
  let skipped = 0;

  for (const symbol of symbols) {
    try {
      await queue.enqueue({ symbol, forceRefresh }, {
        scheduleDelaySeconds: Math.floor(enqueued * 0.5), // 500ms spread to avoid thundering herd
      });
      enqueued++;
    } catch (err: any) {
      logger.error('rh_agent_overview_enqueue_error', { symbol, error: err?.message });
      skipped++;
    }
  }

  return { enqueued, skipped };
}

// ============================================================================
// Scheduler — weekly on Sundays at 6 AM UTC
// ============================================================================

export const rhAgentOverviewSyncWeekly = onSchedule(
  {
    schedule: '0 6 * * 0',
    timeZone: 'UTC',
    memory: '256MiB',
    timeoutSeconds: 60,
  },
  async () => {
    logger.info('rh_agent_overview_sync_weekly_start');
    const symbols = await loadEnabledSymbolIds();
    const result = await enqueueOverviewTasks(symbols, false);
    logger.info('rh_agent_overview_sync_weekly_complete', { total: symbols.length, ...result });
  }
);

// ============================================================================
// Admin callable — manual full backfill trigger
// ============================================================================

export const rhAgentOverviewSyncAdmin = onCall<
  { symbols?: string[]; forceRefresh?: boolean },
  Promise<{ enqueued: number; skipped: number; total: number }>
>(
  { cors: true, memory: '256MiB', invoker: 'public' },
  async (request) => {
    const forceRefresh = request.data.forceRefresh ?? true;
    const symbols = request.data.symbols?.length
      ? request.data.symbols
      : await loadEnabledSymbolIds();

    logger.info('rh_agent_overview_sync_admin_start', { total: symbols.length, forceRefresh });
    const result = await enqueueOverviewTasks(symbols, forceRefresh);
    logger.info('rh_agent_overview_sync_admin_complete', { total: symbols.length, ...result });

    return { total: symbols.length, ...result };
  }
);

// ============================================================================
// Task worker — fetches and writes overview for a single symbol
// ============================================================================

export const rhAgentOverviewSyncSymbol = onTaskDispatched<{ symbol: string; forceRefresh?: boolean }>(
  {
    retryConfig: { maxAttempts: 3, minBackoffSeconds: 10, maxBackoffSeconds: 120 },
    rateLimits: { maxConcurrentDispatches: 10, maxDispatchesPerSecond: 5 },
    memory: '256MiB',
    timeoutSeconds: 60,
  },
  async (req) => {
    const { symbol, forceRefresh = false } = req.data;

    const symbolRef = db.collection(RH_AGENT_SYMBOLS_COLLECTION).doc(symbol);

    // Skip if still fresh and not forced
    if (!forceRefresh) {
      const snap = await symbolRef.get();
      const data = snap.data() as any;
      if (isOverviewFresh(data?.overviewFetchedAt)) {
        logger.info('rh_agent_overview_sync_symbol_skip_fresh', { symbol });
        return;
      }
    }

    // Fetch from SA partner API — 404 = not an equity, skip gracefully
    let json: PartnerCompanyOverviewResponse;
    try {
      json = await callPartnerCompanyOverview(symbol);
    } catch (err: any) {
      if (err?.message?.includes('404')) {
        logger.info('rh_agent_overview_sync_symbol_not_equity', { symbol });
        return;
      }
      throw err;
    }

    if (!json.ok || !json.data) {
      logger.warn('rh_agent_overview_sync_symbol_bad_response', { symbol });
      return;
    }

    const parsed = parseOverviewData(json.data);
    const overviewFields: RhAgentOverviewFields = {
      ...parsed,
      overviewFetchedAt: FieldValue.serverTimestamp(),
    };

    // merge: true — preserves existing signal gate fields and config fields
    await symbolRef.set(overviewFields, { merge: true });

    logger.info('rh_agent_overview_sync_symbol_complete', {
      symbol,
      sector: parsed.sector,
      industry: parsed.industry,
      marketCapTier: parsed.marketCapTier,
    });
  }
);
