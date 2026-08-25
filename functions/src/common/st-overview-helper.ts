/**
 * ST Company Overview Helper
 *
 * Shared logic for fetching SA company overview data and writing it to a
 * symbol-meta document. Used by both the overview sync worker and the
 * symbol-added ingestion path.
 */
import { logger } from 'firebase-functions/v2';
import { FieldValue } from 'firebase-admin/firestore';

import { db } from '../firebase-admin-init';
import { callPartnerCompanyOverview } from '../partner-proxy';
import { PartnerHttpError } from '../partner-infrastructure';
import { PartnerCompanyOverviewResponse } from '../types/partner';
import { ST_SYMBOLS_COLLECTION, StOverviewFields, StSymbol } from './st-collections';
import { isTimestamp } from './type-guards';

/** Parse a string field to number — returns undefined for "None" or non-numeric. */
export function parseNum(val: string | undefined): number | undefined {
  if (!val || val === 'None' || val === '-') return undefined;
  const n = parseFloat(val);
  return isNaN(n) ? undefined : n;
}

/** Derive market cap tier from raw market cap value in USD. */
export function deriveMarketCapTier(marketCap: number | undefined): StOverviewFields['marketCapTier'] {
  if (marketCap == null) return undefined;
  if (marketCap >= 200e9) return 'mega';
  if (marketCap >= 10e9) return 'large';
  if (marketCap >= 2e9) return 'mid';
  if (marketCap >= 300e6) return 'small';
  return 'micro';
}

/** Refetch overview if it is older than this many days. */
const OVERVIEW_TTL_DAYS = 7;

/** Map raw AV data fields (all strings) to our stored overview shape. */
export function parseOverviewData(data: Record<string, string>): StOverviewFields {
  const marketCap = parseNum(data['MarketCapitalization']);
  const analystBuys =
    (parseNum(data['AnalystRatingBuy']) ?? 0) +
    (parseNum(data['AnalystRatingStrongBuy']) ?? 0);
  const analystSells =
    (parseNum(data['AnalystRatingSell']) ?? 0) +
    (parseNum(data['AnalystRatingStrongSell']) ?? 0);

  return {
    name: data['Name'] || undefined,
    sector: data['Sector'] || undefined,
    industry: data['Industry'] || undefined,
    exchange: data['Exchange'] || undefined,
    assetType: data['AssetType'] || undefined,
    marketCap,
    marketCapTier: deriveMarketCapTier(marketCap),
    beta: parseNum(data['Beta']),
    peRatio: parseNum(data['PERatio']),
    forwardPe: parseNum(data['ForwardPE']),
    week52High: parseNum(data['52WeekHigh']),
    week52Low: parseNum(data['52WeekLow']),
    ma200: parseNum(data['200DayMovingAverage']),
    ma50: parseNum(data['50DayMovingAverage']),
    dividendYield: parseNum(data['DividendYield']),
    analystTarget: parseNum(data['AnalystTargetPrice']),
    analystBuys: analystBuys > 0 ? analystBuys : undefined,
    analystSells: analystSells > 0 ? analystSells : undefined,
  };
}

/**
 * Fetch SA company overview for a symbol and merge it into the symbol doc.
 * Returns the parsed overview fields on success, or undefined if skipped
 * (e.g., 404 = not an equity).
 */
export async function fetchAndWriteSymbolOverview(
  symbol: string,
  options: { forceRefresh?: boolean } = {}
): Promise<StOverviewFields | undefined> {
  const { forceRefresh = false } = options;
  const symbolRef = db.collection(ST_SYMBOLS_COLLECTION).doc(symbol);

  // Skip if still fresh and not forced
  if (!forceRefresh) {
    const snap = await symbolRef.get();
    const data = snap.data() as Partial<StSymbol> | undefined;
    const overviewFetchedAt = data?.overviewFetchedAt;
    if (isTimestamp(overviewFetchedAt)) {
      const fetchedAt = overviewFetchedAt.toDate();
      const ageMs = Date.now() - fetchedAt.getTime();
      if (ageMs < OVERVIEW_TTL_DAYS * 24 * 60 * 60 * 1000) {
        logger.info('st_overview_helper_skip_fresh', { symbol });
        return undefined;
      }
    }
  }

  let json: PartnerCompanyOverviewResponse;
  try {
    json = await callPartnerCompanyOverview(symbol);
  } catch (err: any) {
    if (err instanceof PartnerHttpError && err.status === 404) {
      logger.info('st_overview_helper_not_equity', { symbol });
      return undefined;
    }
    throw err;
  }

  if (!json.ok || !json.data) {
    logger.warn('st_overview_helper_bad_response', { symbol });
    return undefined;
  }

  const parsed = parseOverviewData(json.data);
  await symbolRef.set(
    { ...parsed, overviewFetchedAt: FieldValue.serverTimestamp() },
    { merge: true }
  );

  logger.info('st_overview_helper_complete', {
    symbol,
    sector: parsed.sector,
    industry: parsed.industry,
    marketCapTier: parsed.marketCapTier,
  });

  return parsed;
}
