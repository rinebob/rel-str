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
  console.log('[spread-proxy] callPartnerSpreadTimeSeries — definition:', JSON.stringify(definition).slice(0, 500));
  const idToken = await generateIdTokenWithEmail(PARTNER_SPREAD_TIME_SERIES_AUDIENCE, CALLER_SA);
  const headers = {
    Authorization: `Bearer ${idToken}`,
    'Content-Type': 'application/json',
  };
  const cleaned: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(definition)) {
    if (value != null) cleaned[key] = value;
  }
  const body = JSON.stringify(cleaned);
  console.log('[spread-proxy] POST to:', PARTNER_SPREAD_TIME_SERIES_URL, 'body length:', body.length);
  const resp = await fetchWithRetry(PARTNER_SPREAD_TIME_SERIES_URL, headers, { method: 'POST', body });

  console.log('[spread-proxy] response status:', resp.status, resp.ok);

  if (!resp.ok) {
    const errorText = await resp.text();
    console.error('[spread-proxy] error response:', errorText);
    throw new PartnerHttpError(errorText, resp.status);
  }
  const json = await resp.json() as SpreadTimeSeriesResponse;
  console.log('[spread-proxy] success — series length:', json.series?.length, 'ok:', json.ok);
  return json;
}
