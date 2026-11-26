**Topic:** SA IV Data  
**Topic Slug:** sa-iv-data  
**Thread:** IV Metrics Consumer  
**Thread Slug:** iv-metrics-consumer  
**Issue:** #1744  
**Thread Parent:** #1738  
**Topic Parent:** #1737  
**Domain:** IMP-VOL  
**Type:** TEST  
**Status:** Draft  
**Created:** 2026-11-25  
**Last Updated:** 2026-11-25  

# Test Plan — BE: IV Metrics Consumer

## Scope

`iv-metrics-proxy.ts` (two SA callers), `iv-metrics.callables.ts`
(`getIvMetrics`, `getIvRank`), `types/partner.ts` additions, `index.ts`
exports, and the `scripts/verify/iv-metrics-1737.ts` dry + live legs.
Three BE tasks: proxy → callables → verify.

## E2E User Journeys

- `npx tsx scripts/verify/iv-metrics-1737.ts --live` — real calls to both
  SA endpoints (`partnerIvMetricsV2` for QQQ + a recent range;
  `partnerIvRankV2?sort=ivRank360&dir=desc&minN=20`) → typed rows back. A
  403 on either leg = upstream allowlist gap, reported as such.
- No UI journey — no FE surface in this Thread.

## Integration Tests

- Callable → proxy seam: handler invoked with a stubbed
  `callPartnerIvMetrics`/`callPartnerIvRank` — success passthrough
  (response returned verbatim), `PartnerHttpError` → mapped
  `HttpsError` code.
- Proxy → fetch seam: stubbed global `fetch` — URL, query params,
  `Authorization: Bearer` header, `fetchWithRetry` usage, non-2xx →
  `PartnerHttpError` with `status` + extracted `partnerCode`.

## Unit Tests

`tests/functions/iv-metrics-proxy.test.ts`:

- URL construction: `{host}/partnerIvMetricsV2?symbol=QQQ&from=…&to=…`;
  `metrics:['iv30','ivRank360']` → `metrics=iv30%2CivRank360`-style CSV;
  absent `metrics` → no param.
- `callPartnerIvRank` with no args → bare `{host}/partnerIvRankV2`; each
  of `sort`/`dir`/`minN` forwarded only when supplied.
- Local validation throws `PartnerHttpError` 400 **before any fetch**
  (fetch spy not called): blank symbol, bad date shape, `from > to`,
  span > 10y, negative/non-integer `minN`, non-whitelist `sort`, bad `dir`.
- 4xx/5xx → `PartnerHttpError` carrying status and `partnerCode`
  (`OPTIONS_NOT_ENABLED`, `NOT_FOUND`, `RESPONSE_TOO_LARGE`).

`tests/functions/iv-metrics-callables.test.ts`:

- Each validation failure → `HttpsError('invalid-argument')` — no proxy
  call made.
- `OPTIONS_NOT_ENABLED` → `failed-precondition`; `404` → `not-found`;
  `429` → `resource-exhausted`; `500` → `unavailable`
  (`partnerHttpErrorToCallableCode` pins).
- `metrics` array arrives as `string[]` and is forwarded to the proxy
  untouched.

## Test Seams

- **Highest seam:** the verify script calls the real exported callers —
  catches URL/auth/regression the mocks can't.
- **Proxy seam:** stub `globalThis.fetch` (prior art:
  `tests/functions/spread-proxy.test.ts`).
- **Callable seam:** stub the proxy module's exported functions (prior
  art: callable handler tests under `tests/functions/`).

## Test data / fixtures

- Live leg: `symbol='QQQ'`, a recent 30-day range, `metrics=['iv30',
  'ivRank360','ivN360']`; rank query `sort='ivRank360'`, `dir='desc'`,
  `minN=20` — the doc's own acceptance example.
- Mock response bodies: the discovery docs' literal example JSON (AAPL
  metrics rows; QQQ rank row, `ivN360=147`, `updatedAt` ISO string).
- Error body fixtures: `{code:'OPTIONS_NOT_ENABLED'}` and
  `{code:'NOT_FOUND'}` JSON bodies to pin `extractPartnerCode`.

## Existing Test Coverage

- `tests/functions/spread-proxy.test.ts` — fetch-mocked proxy test to
  imitate.
- `tests/functions/options-error-mapping.test.ts` — error-code mapping
  pins (extend the pattern, don't duplicate coverage of
  `partnerHttpErrorToCallableCode` itself).
- `tests/functions/fetch-with-retry.test.ts` — retry behavior is already
  covered at that seam; do not re-test it here.
- Gap filled: no tests exist for the IV endpoint family — it's uncalled
  today.

## Edge Cases

- `metrics` present but containing only unknown names → SA's `400` passes
  through as `PartnerHttpError` (not locally rejected — lenient server
  contract).
- Empty `rows[]` (in-range but no corpus coverage) → success, not error.
- `partnerIvRankV2` row missing `ivRank{W}` (thin `ivN`) → passes through
  as absent key; never synthesized.
- `413 RESPONSE_TOO_LARGE` surfaces unchanged for oversized ranges.

## Verify relay

- `cd functions && npm run test:iv-metrics`
- `npx tsx scripts/verify/iv-metrics-1737.ts` (dry)
- `npx tsx scripts/verify/iv-metrics-1737.ts --live` (ADC or
  `GOOGLE_IMPERSONATE_SERVICE_ACCOUNT`)
