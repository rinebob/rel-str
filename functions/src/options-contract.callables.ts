import { onCall } from 'firebase-functions/v2/https';
import * as logger from 'firebase-functions/logger';

import { callPartnerHistoricalOptionsContractV2 } from './partner-proxy';
import { RH_AGENT_ALLOWED_ORIGINS } from './rh-agent-cloud-function/rh-agent-cors';
import type {
  GetHistoricalOptionsContractRequest,
  PartnerHistoricalOptionsContractV2Response,
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
