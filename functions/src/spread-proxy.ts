/**
 * POST handler delegating to SA's partnerSpreadTimeSeries endpoint.
 * Follows the same pattern as options-contract-proxy.ts.
 */

import { PARTNER_AUDIENCE, CALLER_SA, PartnerHttpError, generateIdTokenWithEmail, fetchWithRetry } from './partner-infrastructure';
import { PartnerEndpointPath } from './types/partner';
import type { SpreadDefinition, SpreadTimeSeriesResponse } from '@spread/contracts';

const PARTNER_SPREAD_TIME_SERIES_URL =
  process.env.PARTNER_SPREAD_TIME_SERIES_URL ||
  `${PARTNER_AUDIENCE.replace(/\/$/, '')}/${PartnerEndpointPath.SPREAD_TIME_SERIES}`;

const PARTNER_SPREAD_TIME_SERIES_AUDIENCE =
  process.env.PARTNER_SPREAD_TIME_SERIES_AUDIENCE || PARTNER_SPREAD_TIME_SERIES_URL;

export async function callPartnerSpreadTimeSeries(
  definition: SpreadDefinition,
): Promise<SpreadTimeSeriesResponse> {
  const idToken = await generateIdTokenWithEmail(PARTNER_SPREAD_TIME_SERIES_AUDIENCE, CALLER_SA);
  const headers = {
    Authorization: `Bearer ${idToken}`,
    'Content-Type': 'application/json',
  };
  const body = JSON.stringify(definition);
  const resp = await fetchWithRetry(PARTNER_SPREAD_TIME_SERIES_URL, headers, { method: 'POST', body });

  if (!resp.ok) {
    throw new PartnerHttpError(await resp.text(), resp.status);
  }
  return resp.json() as Promise<SpreadTimeSeriesResponse>;
}
