import { onCall } from 'firebase-functions/v2/https';
import * as logger from 'firebase-functions/logger';

import { callPartnerHistoricalOptionsContractV2, callPartnerListContractsV2 } from './options-contract-proxy';
import { RH_AGENT_ALLOWED_ORIGINS } from './rh-agent-cloud-function/rh-agent-cors';
import type {
  GetHistoricalOptionsContractRequest,
  PartnerHistoricalOptionsContractV2Response,
  GetListContractsRequest,
  PartnerListContractsV2Response,
} from '@options-contract/contracts';

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
