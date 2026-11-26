**Topic:** SA IV Data  
**Topic Slug:** sa-iv-data  
**Thread:** IV Metrics Consumer  
**Thread Slug:** iv-metrics-consumer  
**Issue:** #1744  
**Thread Parent:** #1738  
**Topic Parent:** #1737  
**Domain:** IMP-VOL  
**Type:** IMPL  
**Status:** Draft  
**Created:** 2026-11-25  
**Last Updated:** 2026-11-25  

# Implementation Plan — BE: IV Metrics Consumer

## Architecture overview

Two modules following the established partner convention exactly:

- `iv-metrics-proxy.ts` — the SA transport: `callPartnerIvMetrics` and
  `callPartnerIvRank` mint an OIDC token (`generateIdTokenWithEmail`), GET
  the endpoints via `fetchWithRetry`, and throw `PartnerHttpError` on
  non-2xx. Pure pass-through, no persistence.
- `iv-metrics.callables.ts` — the `onCall` wrappers `getIvMetrics` /
  `getIvRank` that validate input, dispatch to the proxy, and map
  `PartnerHttpError` through `partnerHttpErrorToCallableCode`.

Plus a `scripts/verify/` script whose `--live` leg exercises both endpoints
for real — doubling as the upstream-allowlist check.

## Boundary

Covers: `PartnerEndpointPath` entries + type re-exports in
`types/partner.ts`, the proxy module, the callables module + `index.ts`
exports, both test files, the `test:iv-metrics` package script, and the
verify script + its `run-all.ts`/`README.md` registrations.

NOT scope: consumers (overnight sim, filters, scanner), any Firestore
writes, FE code, SA-side config.

## Files

```
functions/src/types/partner.ts          — modified: IV_METRICS_V2 + IV_RANK_V2 enum entries; re-export @iv-metrics/contracts types
functions/src/iv-metrics-proxy.ts       — NEW: callPartnerIvMetrics + callPartnerIvRank + URL/audience consts
functions/src/iv-metrics.callables.ts   — NEW: getIvMetrics + getIvRank onCall wrappers
functions/src/index.ts                  — modified: re-export both callables
tests/functions/iv-metrics-proxy.test.ts    — NEW: fetch-mocked caller tests (node:test)
tests/functions/iv-metrics-callables.test.ts — NEW: handler-level validation/error-mapping tests
functions/package.json                  — modified: "test:iv-metrics" tsx --test script
scripts/verify/iv-metrics-1737.ts       — NEW: dry + --live verification
scripts/verify/iv-metrics-1737.md       — NEW: verify doc
scripts/verify/run-all.ts               — modified: register script (needsAdc for live leg)
scripts/verify/README.md                — modified: index entry
```

## Modules

### 1. `types/partner.ts` — modified

```ts
export enum PartnerEndpointPath {
  // …existing…
  IV_METRICS_V2 = 'partnerIvMetricsV2',
  IV_RANK_V2 = 'partnerIvRankV2',
}
```

Plus `export type { IvMetricsRequest, IvMetricsRow, IvMetricsResponse,
IvRankRequest, IvRankRow, IvRankResponse, IvRankSortField, IvRankDirection,
GetIvMetricsRequest, GetIvRankRequest } from '@iv-metrics/contracts';` —
same re-export convention as `@options-contract/contracts`.

### 2. `iv-metrics-proxy.ts` — new (adapted from `spread-proxy.ts` / `options-contract-proxy.ts`)

```ts
const PARTNER_IV_METRICS_URL =
  process.env.PARTNER_IV_METRICS_URL ||
  `${PARTNER_AUDIENCE.replace(/\/$/, '')}/${PartnerEndpointPath.IV_METRICS_V2}`;
const PARTNER_IV_METRICS_AUDIENCE =
  process.env.PARTNER_IV_METRICS_AUDIENCE || PARTNER_IV_METRICS_URL;
// …identical pair for IV_RANK_V2

export async function callPartnerIvMetrics(
  params: IvMetricsRequest,
): Promise<IvMetricsResponse>
// GET ?symbol&from&to[&metrics=csv]; local validation (symbol, date shape,
// from<=to, ≤10y span) → PartnerHttpError(400) BEFORE any fetch — the
// options-contract-availability caller does the same.

export async function callPartnerIvRank(
  params: IvRankRequest = {},
): Promise<IvRankResponse>
// GET ?[sort][&dir][&minN]; no required params — whole table default.
```

Both: token via `generateIdTokenWithEmail(<endpoint audience>, CALLER_SA)`,
`fetchWithRetry(url, { Authorization: Bearer … })`, non-ok →
`PartnerHttpError(text, status, extractPartnerCode(text))`. Response JSON
returned verbatim — absent keys stay absent (no normalization to 0/null).

### 3. `iv-metrics.callables.ts` — new (adapted from `options-contract.callables.ts`)

```ts
export const getIvMetrics = onCall(
  { region: 'us-central1', cors: ST_ALLOWED_ORIGINS },
  async (req): Promise<IvMetricsResponse> => { /* validate → proxy → map */ },
);
export const getIvRank = onCall(
  { region: 'us-central1', cors: ST_ALLOWED_ORIGINS },
  async (req): Promise<IvRankResponse> => { /* validate → proxy → map */ },
);
```

Validation → `HttpsError('invalid-argument', …)` before any partner call:
`symbol` non-blank; `from`/`to` match `YYYY-MM-DD` and `from <= to` with
span ≤ 10 years; `sort` in the rank-field whitelist; `dir` ∈ `asc|desc`;
`minN` non-negative integer. `PartnerHttpError` →
`HttpsError(partnerHttpErrorToCallableCode(e), e.message)` — preserves the
`OPTIONS_NOT_ENABLED` → `failed-precondition` path.

### 4. `scripts/verify/iv-metrics-1737.ts` — new (adapted from `options-contract-availability-1336.ts`)

- **Dry checks:** missing symbol / malformed date / inverted range /
  >10y span / bad `sort` / bad `dir` / negative `minN` → `PartnerHttpError`
  400 before any fetch.
- **`--live` leg:** `callPartnerIvMetrics({symbol:'QQQ', from, to,
  metrics:['iv30','ivRank360','ivN360']})` — assert `ok`, row count > 0,
  `date`/`iv30` present, rows date-ascending; `callPartnerIvRank({sort:
  'ivRank360', dir:'desc', minN:20})` — assert `ok`, `count ===
  rows.length`, fields echo back, first row's `ivN360 ≥ 20`, missing ranks
  are absent keys not 0. A 403 on either leg prints
  "upstream allowlist/onboarding gap — SA-side, not a code defect".

## Contracts

`getIvMetrics`/`getIvRank` callable request/response = the shared types —
no additional cross-area surface. Firestore: none.

## Decisions

- New `iv-metrics-proxy.ts` over folding into `partner-proxy.ts` or
  `options-contract-proxy.ts` — one endpoint family per small file
  (`spread-proxy.ts` precedent); IV is symbol-level, not contract-level.
- Validate in **both** layers: proxy callers (keeps BE-internal callers
  safe) and callables (maps to `invalid-argument` for the FE) — mirrors
  `callPartnerContractAvailabilityV1`, which validates 400-before-fetch.
- `metrics` stays a typed array on the request; the proxy joins to CSV —
  callers never hand-format query strings.
- No request caching, no response normalization — SA's absent-key
  semantics must reach consumers unchanged (a synthesized `0` would read
  as a real zero rank).

## Sequence / phases

1. Proxy callers + tests *(blocked by SHARED types)*
2. Callables + `index.ts` + tests *(blocked by proxy)*
3. Verify script + registrations *(blocked by callables)*

## Prior art / regression

- `functions/src/spread-proxy.ts` — proxy-module shape.
- `functions/src/options-contract.callables.ts` — onCall config, validate-
  then-proxy, error mapping.
- `tests/functions/spread-proxy.test.ts` — fetch-mocked caller tests.
- `tests/functions/options-error-mapping.test.ts` — `PartnerHttpError` →
  callable-code pins.
- `scripts/verify/options-contract-availability-1336.ts` — live-SA verify
  shape (`needsAdc`, OK/FAIL checks, validation-before-fetch checks).
- Nothing existing is modified behaviorally — `types/partner.ts` and
  `index.ts` are additive only.

## Verify relay

- `cd functions && npm run test:iv-metrics` — both test files green.
- `npx tsx scripts/verify/iv-metrics-1737.ts` — dry checks green.
- `npx tsx scripts/verify/iv-metrics-1737.ts --live` — real calls green
  (needs ADC or `GOOGLE_IMPERSONATE_SERVICE_ACCOUNT`); 403 = upstream
  allowlist gap, escalate to SA, not a code fix.

## Risks / open seams

- **Allowlist unknown** until the live leg runs — flagged in every output.
- **Audience drift:** default aud = function URL; SA's permanent entry is
  the base host. If SA repins `EXPECTED_GOOGLE_AUDIENCE` to base-host only,
  the `{ENDPOINT}_AUDIENCE` env override fixes it without a deploy — same
  escape hatch the availability endpoint needed (its aud quirk documented
  in `options-contract-proxy.ts`).
- **10 MiB cap:** wide ranges × all fields can 413 — surfaced to callers
  as `PartnerHttpError(413)`; consumers narrow ranges themselves.
