/**
 * Verification: partnerContractAvailabilityV1 proxy route (task #1336).
 *
 * Calls the real `callPartnerContractAvailabilityV1` against the live SA
 * endpoint — OIDC token exchange → upstream fetch → verbatim response —
 * the same code path the `queryContractAvailability` callable dispatches
 * to (callable = thin param pass-through + error-code mapping, covered by
 * tests/functions/options-contract-availability.test.ts).
 *
 * Checks:
 *  1. Live QQQ query (calls, 500–520, step 5) returns ok:true with
 *     availability-shaped entries (contractId/expiration/strike/type/
 *     firstObserved/lastObserved) and a boolean `truncated`.
 *  2. Missing symbol → PartnerHttpError 400 BAD_REQUEST before any fetch.
 *  3. Inverted ranges → PartnerHttpError 400 BAD_REQUEST before any fetch.
 *  4. Unknown symbol → SA's own response shape surfaces (ok:false or an
 *     HTTP error) — proves error propagation, not a hard-coded verdict.
 *
 * Run: npx tsx scripts/verify/options-contract-availability-1336.ts
 * Needs: ADC (or GOOGLE_IMPERSONATE_SERVICE_ACCOUNT) — same credential
 * path as the deployed function. Pass: all OK. Fail: FAIL lines + exit 1.
 */

import { callPartnerContractAvailabilityV1 } from '../../functions/src/options-contract-proxy';
import type { ContractAvailabilityEntry } from '../../shared/options-contract-contracts';

let checks = 0;
let failures = 0;

function check(name: string, ok: boolean, detail = ''): void {
  checks++;
  console.log(`${ok ? 'OK  ' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures++;
}

async function main(): Promise<void> {
  // ── 1. Live availability query ─────────────────────────────────────────

  const res = await callPartnerContractAvailabilityV1({
    symbol: 'QQQ',
    type: 'C',
    strikeGte: 500,
    strikeLte: 520,
    strikeStep: 5,
  });

  check('live query ok:true', res.ok === true);
  check('count matches contracts length', res.count === res.contracts.length,
    `count=${res.count} len=${res.contracts.length}`);
  check('contracts returned', res.contracts.length > 0, `${res.contracts.length} rows`);
  check('truncated flag is boolean', typeof res.truncated === 'boolean');

  const entry: ContractAvailabilityEntry | undefined = res.contracts[0];
  check('entry carries OCC contractId', typeof entry?.contractId === 'string' && entry.contractId.length > 10,
    entry?.contractId);
  check('entry carries expiration/strike/type', !!entry?.expiration && typeof entry?.strike === 'number' && (entry?.type === 'call' || entry?.type === 'put'));
  check('entry carries firstObserved/lastObserved', !!entry?.firstObserved && !!entry?.lastObserved,
    `${entry?.firstObserved}..${entry?.lastObserved}`);
  check('strikes honor bounds+step',
    res.contracts.every((c) => c.strike >= 500 && c.strike <= 520 && c.strike % 5 === 0));
  check('types honor the C filter', res.contracts.every((c) => c.type === 'call'));
  check('corpusDates present when advertised',
    res.corpusDateCount === undefined || res.corpusDateCount === 0
      || (Array.isArray(res.corpusDates) && res.corpusDates.length > 0),
    `corpusDateCount=${res.corpusDateCount} corpusDates=${res.corpusDates?.length}`);

  // ── 2/3. Local validation — BAD_REQUEST before any upstream call ───────

  for (const [name, params] of [
    ['missing symbol', {}],
    ['blank symbol', { symbol: '   ' }],
    ['inverted expiration range', { symbol: 'QQQ', expirationGte: '2026-12-31', expirationLte: '2026-01-01' }],
    ['inverted strike range', { symbol: 'QQQ', strikeGte: 500, strikeLte: 400 }],
    ['inverted firstObserved range', { symbol: 'QQQ', firstObservedGte: '2026-12-31', firstObservedLte: '2026-01-01' }],
  ] as [string, Parameters<typeof callPartnerContractAvailabilityV1>[0]][]) {
    try {
      await callPartnerContractAvailabilityV1(params);
      check(`validate: ${name} → BAD_REQUEST`, false, 'no error thrown');
    } catch (e) {
      const err = e as Error & { status?: number; partnerCode?: string };
      check(`validate: ${name} → BAD_REQUEST`,
        err.name === 'PartnerHttpError' && err.status === 400 && err.partnerCode === 'BAD_REQUEST',
        `${err.name} status=${err.status} code=${err.partnerCode}`);
    }
  }

  // ── 4. Unknown symbol surfaces SA's verdict, not a fabricated one ──────

  try {
    const bogus = await callPartnerContractAvailabilityV1({ symbol: 'ZZZNOTREAL' });
    check('unknown symbol → SA response', bogus.ok === false || bogus.count === 0,
      `ok=${bogus.ok} count=${bogus.count}`);
  } catch (e) {
    const err = e as Error & { status?: number };
    check('unknown symbol → surfaced error', err instanceof Error && (err.status ?? 0) >= 400,
      `${err.name} status=${err.status}`);
  }

  console.log('');
  console.log(`${checks - failures}/${checks} checks passed`);
  if (failures > 0) process.exit(1);
}

void main();
