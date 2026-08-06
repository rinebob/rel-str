**Topic:** Spread Time Series Viewer  
**Issue:** #77  
**Domain:** SPREAD-VIEWER  
**Type:** Test Plan  
**Status:** Draft  
**Created:** 2026-08-05  
**Last Updated:** 2026-08-05  

# Test Plan: Spread Time Series Viewer — BACKEND

## E2E User Journeys

- Journey 1: Callable `submitSpreadRun` receives 3 spread definitions → creates run doc with `expectedJobs: 3` → enqueues 3 tasks → each worker calls SA single endpoint → writes job docs → run doc `status: COMPLETE` with `successJobs: 3`
- Journey 2: Worker receives a spread definition that SA rejects → retries 3 times → marks job `PERMANENT_FAILURE` → run doc `status: PARTIAL` with `failedJobs: 1`
- Journey 3: `fetchWithRetry` POST with body → SA returns 429 → retries with backoff → succeeds on attempt 2

## Integration Tests

**File:** `spread-run-orchestrator.test.ts`

- Orchestrator creates run doc with correct `expectedJobs` count
- Orchestrator enqueues correct number of Cloud Tasks
- Orchestrator returns `{ runId }` matching the Firestore doc
- Orchestrator rejects unauthenticated requests
- Orchestrator rejects empty spreads array
- Orchestrator rejects missing spread fields

**File:** `spread-run-worker.test.ts`

- Worker calls `callPartnerSpreadTimeSeries` with the correct definition
- Worker writes job doc with `SUCCESS` status and result data on happy path
- Worker increments `successJobs` on the run doc
- Worker sets job doc to `PERMANENT_FAILURE` after max retries
- Worker increments `failedJobs` on permanent failure
- Worker sets run doc `status: COMPLETE` when all jobs done
- Worker sets run doc `status: PARTIAL` when some jobs fail
- Worker does not double-count on retry (idempotent counter increment)

**File:** `spread-proxy.test.ts`

- Proxy constructs correct URL from `PARTNER_AUDIENCE` + `PartnerEndpointPath.SPREAD_TIME_SERIES`
- Proxy sets `Authorization: Bearer` header with OIDC token
- Proxy sets `Content-Type: application/json` header
- Proxy sends `JSON.stringify(definition)` as body
- Proxy uses `fetchWithRetry` with `method: 'POST'` and `body`
- Proxy throws `PartnerHttpError` on non-OK response
- Proxy returns parsed `SpreadTimeSeriesResponse` on success

## Unit Tests

**File:** `fetchWithRetry.test.ts` (existing file, add POST cases)

- `fetchWithRetry` with `method: 'POST'` and `body` calls `fetch` with correct options
- `fetchWithRetry` with no options defaults to GET (backward compatible)
- `fetchWithRetry` with `maxAttempts` in options object (new signature)
- `fetchWithRetry` with numeric third arg (old signature, backward compatible)

## Test Seams

- **Highest seam:** Orchestrator + worker integration tests with mocked Firestore and mocked SA proxy
- **Lower seams:** Proxy unit tests with mocked `fetch` and `generateIdTokenWithEmail`
- **Lowest seam:** `fetchWithRetry` unit tests with mocked `fetch` global

## Existing Test Coverage

- `fetchWithRetry` has existing tests for GET behavior — add POST cases
- `options-contract-proxy.ts` tests as pattern reference for proxy tests
- `backtest-orchestrator.ts` and `backtest-worker.ts` as pattern reference for queue tests

## Edge Cases

- **Empty spreads array:** Orchestrator rejects with error
- **SA timeout (60s):** Worker times out, Cloud Tasks retries
- **SA returns 429:** `fetchWithRetry` retries with backoff
- **SA returns 500:** `fetchWithRetry` retries, then worker fails
- **Firestore write failure:** Worker job doc write fails — task retries
- **Concurrent counter increments:** Multiple workers incrementing `successJobs` simultaneously
- **Run doc already complete:** Worker processes late task after run is marked complete — should still write job doc but not re-increment counters
- **Large spread definition:** Many legs (iron condor = 4, custom = N) — ensure serialization works
- **Missing auth:** Orchestrator callable called without authentication
