/**
 * RH Agent Company Overview Sync Worker
 *
 * Cloud Task worker that fetches SA company overview data for a single symbol
 * and writes it back to the rh-agent-symbols document.
 */
import { onTaskDispatched } from 'firebase-functions/v2/tasks';
import { logger } from 'firebase-functions/v2';
import { FieldValue } from 'firebase-admin/firestore';

import { db } from '../firebase-admin-init';
import { callPartnerCompanyOverview } from '../partner-proxy';
import { PartnerCompanyOverviewResponse } from '../types/partner';
import { RH_AGENT_SYMBOLS_COLLECTION } from './rh-agent-config';

// ============================================================================
// Constants
// ============================================================================

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

/** Check if overview data is still fresh (within TTL). */
function isOverviewFresh(fetchedAt: FirebaseFirestore.Timestamp | undefined): boolean {
  if (!fetchedAt) return false;
  const ageMs = Date.now() - fetchedAt.toMillis();
  return ageMs < OVERVIEW_TTL_DAYS * 24 * 60 * 60 * 1000;
}

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
