import { onCall } from 'firebase-functions/v2/https';
import * as logger from 'firebase-functions/logger';
import { initializeApp, getApps } from 'firebase-admin/app';
import { getFirestore, Firestore } from 'firebase-admin/firestore';

import { callPartnerHistoricalOptionsContractV2, callPartnerListContractsV2, callPartnerContractCatalogV2 } from './options-contract-proxy';
import { RH_AGENT_ALLOWED_ORIGINS } from './rh-agent-cloud-function/rh-agent-cors';
import type {
  GetHistoricalOptionsContractRequest,
  PartnerHistoricalOptionsContractV2Response,
  GetListContractsRequest,
  PartnerListContractsV2Response,
  GetOptionsContractIndexRequest,
  OptionsContractIndexResponse,
  ExpirationIndexEntry,
  StrikeIndexEntry,
  QueryContractCatalogRequest,
  ContractCatalogResponse,
  ContractSummaryResponse,
} from '@options-contract/contracts';

const SA_PROJECT_ID = process.env.SA_PROJECT_ID || 'alpha-vantage-proxy-api';
const OPTIONS_FILE_INDEX = 'options-file-index';
const TS_EXPIRATIONS = 'ts-expirations';
const TS_STRIKES = 'ts-strikes';

let saDb: Firestore | null = null;
function getSaFirestore(): Firestore {
  if (saDb) return saDb;
  const appName = 'sa-options-index';
  const existing = getApps().find((a) => a.name === appName);
  const app = existing ?? initializeApp({ projectId: SA_PROJECT_ID }, appName);
  saDb = getFirestore(app);
  saDb.settings({ ignoreUndefinedProperties: true });
  return saDb;
}

/**
 * getHistoricalOptionsContract — Fetch historical time-series data for a single
 * options contract via the Savant Partner API.
 *
 * Wraps `callPartnerHistoricalOptionsContractV2` behind a callable so the FE
 * never calls the partner API directly. No caching — live fetch every request
 * to surface SA data issues directly.
 */
export const getHistoricalOptionsContract = onCall(
  { region: 'us-central1', cors: RH_AGENT_ALLOWED_ORIGINS },
  async (req): Promise<PartnerHistoricalOptionsContractV2Response> => {
    const { symbol, contractID, length } = (req.data || {}) as GetHistoricalOptionsContractRequest;
    const sym = String(symbol || '').trim().toUpperCase();
    const cid = String(contractID || '').trim().toUpperCase();
    const len = length ? String(length).trim().toUpperCase() : null;

    if (!sym || !cid) {
      throw new Error('symbol and contractID are required');
    }

    logger.info('getHistoricalOptionsContract', { symbol: sym, contractID: cid, length: len });

    try {
      const data = await callPartnerHistoricalOptionsContractV2({
        symbol: sym,
        contractID: cid,
        length: len,
      });

      logger.info('getHistoricalOptionsContract_response', {
        symbol: data.symbol,
        contractID: data.contractID,
        seriesCount: Array.isArray(data.series) ? data.series.length : 0,
      });

      return data;
    } catch (e: unknown) {
      logger.error('getHistoricalOptionsContract_error', {
        symbol: sym,
        contractID: cid,
        message: e instanceof Error ? e.message : String(e),
        stack: e instanceof Error ? e.stack : undefined,
        error: e,
      });
      throw e;
    }
  },
);

/**
 * listOptionsContracts — Discover available option contract IDs for a symbol
 * via the Savant Partner API (partnerListContractsV2).
 *
 * Returns contract IDs filtered by expiration, strike, and/or type. At least
 * one of expiration or strike must be provided (in addition to symbol) per the
 * SA endpoint contract.
 */
export const listOptionsContracts = onCall(
  { region: 'us-central1', cors: RH_AGENT_ALLOWED_ORIGINS },
  async (req): Promise<PartnerListContractsV2Response> => {
    const { symbol, expiration, strike, type } = (req.data || {}) as GetListContractsRequest;
    const sym = String(symbol || '').trim().toUpperCase();
    const exp = expiration ? String(expiration).trim().toUpperCase() : undefined;
    const stk = strike != null ? Number(strike) : undefined;
    const typ = type ? String(type).trim().toUpperCase() as 'C' | 'P' : undefined;

    if (!sym) {
      throw new Error('symbol is required');
    }
    if (!exp && stk == null) {
      throw new Error('at least one of expiration or strike must be provided');
    }

    logger.info('listOptionsContracts', { symbol: sym, expiration: exp, strike: stk, type: typ });

    try {
      const data = await callPartnerListContractsV2({
        symbol: sym,
        expiration: exp,
        strike: stk,
        type: typ,
      });

      logger.info('listOptionsContracts_response', {
        symbol: data.symbol,
        contractCount: data.count,
      });

      return data;
    } catch (e: unknown) {
      logger.error('listOptionsContracts_error', {
        symbol: sym,
        expiration: exp,
        strike: stk,
        type: typ,
        message: e instanceof Error ? e.message : String(e),
        stack: e instanceof Error ? e.stack : undefined,
        error: e,
      });
      throw e;
    }
  },
);

/**
 * getOptionsContractIndex — Fetch the options contract index (expirations + strikes
 * with cross-filter maps) for a symbol from SA's Firestore project.
 *
 * Reads cross-project from the alpha-vantage-proxy-api Firestore's
 * `options-file-index/{symbol}/ts-expirations` and `ts-strikes` subcollections.
 * Returns the data needed by the frontend to populate dropdowns with cross-filtering.
 */
export const getOptionsContractIndex = onCall(
  { region: 'us-central1', cors: RH_AGENT_ALLOWED_ORIGINS },
  async (req): Promise<OptionsContractIndexResponse> => {
    const { symbol } = (req.data || {}) as GetOptionsContractIndexRequest;
    const sym = String(symbol || '').trim().toUpperCase();

    if (!sym) {
      throw new Error('symbol is required');
    }

    logger.info('getOptionsContractIndex', { symbol: sym });

    try {
      const db = getSaFirestore();

      const expCol = db.collection(`${OPTIONS_FILE_INDEX}/${sym}/${TS_EXPIRATIONS}`);
      const strikeCol = db.collection(`${OPTIONS_FILE_INDEX}/${sym}/${TS_STRIKES}`);

      const [expSnap, strikeSnap] = await Promise.all([
        expCol.get(),
        strikeCol.get(),
      ]);

      const expirations: ExpirationIndexEntry[] = [];
      for (const doc of expSnap.docs) {
        const data = doc.data() as { date?: string; strikes?: number[] };
        if (data.date) {
          expirations.push({
            date: data.date,
            strikes: Array.isArray(data.strikes) ? data.strikes : [],
          });
        }
      }
      expirations.sort((a, b) => a.date.localeCompare(b.date));

      const strikes: StrikeIndexEntry[] = [];
      for (const doc of strikeSnap.docs) {
        const data = doc.data() as { strike?: number; expirations?: string[] };
        if (data.strike != null) {
          strikes.push({
            strike: data.strike,
            expirations: Array.isArray(data.expirations) ? data.expirations : [],
          });
        }
      }
      strikes.sort((a, b) => a.strike - b.strike);

      logger.info('getOptionsContractIndex_response', {
        symbol: sym,
        expirationCount: expirations.length,
        strikeCount: strikes.length,
      });

      return {
        ok: true,
        symbol: sym,
        expirations,
        strikes,
      };
    } catch (e: unknown) {
      logger.error('getOptionsContractIndex_error', {
        symbol: sym,
        message: e instanceof Error ? e.message : String(e),
        stack: e instanceof Error ? e.stack : undefined,
        error: e,
      });
      throw e;
    }
  },
);

/**
 * queryContractCatalog — Query the Savant Partner Contract Catalog V2 endpoint
 * for metadata-rich contract listings with filtering, sorting, and pagination.
 *
 * Supports two modes:
 * - Summary mode (summary=true): returns length-bucket histogram for the symbol
 * - Catalog mode (default): returns paginated contract entries with latest greeks
 *
 * SA enforces at most one range field dimension per request. If the user sends
 * conflicting range filters (e.g. deltaGte + ivGte), SA returns 400 and the
 * error surfaces to the caller.
 */
export const queryContractCatalog = onCall(
  { region: 'us-central1', cors: RH_AGENT_ALLOWED_ORIGINS },
  async (req): Promise<ContractCatalogResponse | ContractSummaryResponse> => {
    const data = (req.data || {}) as QueryContractCatalogRequest;
    const sym = String(data.symbol || '').trim().toUpperCase();

    if (!sym) {
      throw new Error('symbol is required');
    }

    const params: QueryContractCatalogRequest = {
      symbol: sym,
      summary: data.summary,
      expiration: data.expiration,
      contractLengthBucket: data.contractLengthBucket,
      type: data.type,
      strike: data.strike,
      strikeGte: data.strikeGte,
      strikeLte: data.strikeLte,
      deltaGte: data.deltaGte,
      deltaLte: data.deltaLte,
      ivGte: data.ivGte,
      ivLte: data.ivLte,
      minObservationCount: data.minObservationCount,
      sortBy: data.sortBy,
      sortOrder: data.sortOrder,
      pageSize: data.pageSize,
      pageToken: data.pageToken,
    };

    logger.info('queryContractCatalog', {
      symbol: sym,
      summary: params.summary ?? false,
      expiration: params.expiration ?? null,
      contractLengthBucket: params.contractLengthBucket ?? null,
      type: params.type ?? null,
      sortBy: params.sortBy ?? null,
      sortOrder: params.sortOrder ?? null,
      pageSize: params.pageSize ?? null,
      hasPageToken: !!params.pageToken,
    });

    try {
      const result = await callPartnerContractCatalogV2(params);

      if (params.summary) {
        const summary = result as ContractSummaryResponse;
        logger.info('queryContractCatalog_summary_response', {
          symbol: summary.symbol,
          totalContracts: summary.totalContracts,
          expirationCount: summary.expirationCount,
        });
      } else {
        const catalog = result as ContractCatalogResponse;
        logger.info('queryContractCatalog_response', {
          symbol: catalog.symbol,
          contractCount: catalog.count,
          hasMore: !!catalog.nextPageToken,
        });
      }

      return result;
    } catch (e: unknown) {
      logger.error('queryContractCatalog_error', {
        symbol: sym,
        summary: params.summary ?? false,
        message: e instanceof Error ? e.message : String(e),
        stack: e instanceof Error ? e.stack : undefined,
        error: e,
      });
      throw e;
    }
  },
);
