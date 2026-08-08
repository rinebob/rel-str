**Topic:** Spread Time Series Viewer  
**Issue:** #77  
**Domain:** SPREAD-VIEWER  
**Type:** Code Review  
**Status:** Complete  
**Created:** 2026-08-06  
**Last Updated:** 2026-08-06  

# Code Review: Spread Time Series Viewer — BACKEND

## Scope

Task #83: Extend `fetchWithRetry` with POST support in `partner-infrastructure.ts`.
Also covers related BE files (#84–#86) for context: `spread-proxy.ts`, `spread-run-model.ts`, `spread-run-orchestrator.ts`, `spread-run-worker.ts`, `firestore.rules`.

## Standards Axis

### Findings

- **MAJOR: Missing `@topic #77` tags on all backend files.** Previous review claimed tags existed — this was incorrect. Verified by grep: zero `@topic` tags in `functions/src/`. Files missing tags: `partner-infrastructure.ts`, `spread-proxy.ts`, `spread-run-model.ts`, `spread-run-orchestrator.ts`, `spread-run-worker.ts`. `firestore.rules` is a config file — no tag applicable.

- **PASS:** All files well under 300 lines. Largest is `spread-run-worker.ts` at 169 lines.
- **PASS:** Single responsibility — each file has one purpose (proxy, model, orchestrator, worker).
- **PASS:** No duplication — enums re-exported from `@spread/contracts` rather than redefined. CORS allowlist reused from `rh-agent-cors.ts`.
- **PASS:** No dead code — all exported symbols are used.
- **PASS:** Security — orchestrator uses `RH_AGENT_ALLOWED_ORIGINS` (not `cors: true`). Auth check present. No `invoker: 'public'`.
- **PASS:** Pattern consistency — worker mirrors `backtest-worker.ts`, orchestrator mirrors `backtest-orchestrator.ts`, model mirrors `backtest-collections.ts`.
- **PASS:** `fetchWithRetry` backward compatibility — union type `number | FetchWithRetryOptions` cleanly preserves old `(url, headers, maxAttempts)` signature.

## Spec Axis

### Task #83 Acceptance Criteria

| Criterion | Status |
|-----------|--------|
| `fetchWithRetry` accepts optional options object with method, body, maxAttempts | ✅ Met — `FetchWithRetryOptions` interface |
| POST with body calls `fetch` with correct `{ method, body, headers }` | ✅ Met — verified in test + code |
| Existing callers passing `(url, headers)` or `(url, headers, maxAttempts)` still work | ✅ Met — union type handles both |
| Unit tests for POST method, body, and backward-compatible signatures | ✅ Met — 8 tests, all passing |
| Functions typecheck passes | ✅ Met |

### IMPL Plan Coverage (all BE tasks)

| Section | Component | Status |
|---------|-----------|--------|
| 1 | `fetchWithRetry` POST support | ✅ Met — backward-compatible `number \| FetchWithRetryOptions` union |
| 2 | `spread-proxy.ts` | ✅ Met — POST with auth, JSON body, `PartnerHttpError` on non-OK |
| 3 | `spread-run-model.ts` | ✅ Met — enums re-exported from shared layer instead of redefined |
| 4 | `spread-run-orchestrator.ts` | ✅ Met — auth check, empty spreads rejection, run doc, Cloud Tasks enqueue |
| 5 | `spread-run-worker.ts` | ✅ Met — retry config, job status transitions, counter increments, completion detection |
| 6 | `index.ts` exports | ✅ Met — both `submitSpreadRun` and `spreadRunWorker` exported |
| 7 | `firestore.rules` | ✅ Met — `spread-runs` read-only + `jobs` subcollection, `spread-lists` user-scoped CRUD |

### TEST Plan Coverage

| Test Target | Status |
|-------------|--------|
| `fetchWithRetry` POST + backward compat | ✅ 8 unit tests — all pass |
| `spread-proxy` URL/headers/body/error/response | ✅ 3 unit tests — all pass (but stale test data, see findings) |
| Orchestrator integration (auth, empty spreads, run doc) | ⏳ Deferred — requires Firebase SDK mocks |
| Worker integration (counters, status, completion) | ⏳ Deferred — requires Firestore emulator |
| E2E Journey 1 (3 spreads → COMPLETE) | ⏳ Deferred — requires deployed functions |
| E2E Journey 2 (SA rejects → PARTIAL) | ⏳ Deferred — requires deployed functions |
| E2E Journey 3 (429 → retry → success) | ✅ Covered by `fetchWithRetry` test |

## Thermo-nuclear Axis

### Findings

- **MINOR: Stale test data in `spread-proxy.test.ts`.** Test uses `side` (should be `direction`), `spreadPrice` (should be `price`), `contractId` (should be `contractID`), and missing `ok` field on `TEST_RESPONSE`. Tests pass because fetch is mocked and doesn't validate against real API, but test data is inconsistent with updated `spread-contracts.ts`. File: `tests/functions/spread-proxy.test.ts:17,29,32`.

- **MINOR: `console.log` in `spread-proxy.ts` instead of `logger`.** Worker and orchestrator correctly use `logger.info/error/warn` from `firebase-functions/v2`, but `spread-proxy.ts` uses `console.log/error`. Should use `logger` for consistency and Cloud Logging integration. File: `functions/src/spread-proxy.ts:20,27,30,34,38`.

- **PASS: Worker completion check race condition resolved.** Completion check wrapped in `db.runTransaction()` — run doc read and status set atomically, preventing concurrent workers from both seeing count as complete.

- **PASS: `SpreadRunStatus.FAILED` now emitted.** Worker sets `FAILED` when `successJobs === 0`, `PARTIAL` when mixed, `COMPLETE` when all succeed.

- **PASS: Orchestrator enqueues with stagger delay.** `scheduleDelaySeconds: Math.floor(i * 0.5)` prevents SA rate-limit spikes on large batches.

## Test Results

```
fetch-with-retry.test.ts: 8 tests, 8 pass, 0 fail
spread-proxy.test.ts: 3 tests, 3 pass, 0 fail
spread-contracts.test.ts: 43 tests, 43 pass, 0 fail
```

All tests run via `npx tsx --test`. Functions typecheck: clean.

## Verdict

**FAIL.** One major finding: missing `@topic #77` tags on all 5 backend TypeScript files. Two minor findings: stale test data in `spread-proxy.test.ts` and `console.log` instead of `logger` in `spread-proxy.ts`. All acceptance criteria for task #83 are met and tests pass, but the @topic tag violation is a coding standard requirement that must be fixed before shipping.

### Fix list
1. Add `@topic #77` tag comments to all 5 backend TS files
2. Update `spread-proxy.test.ts` test data: `side`→`direction`, `spreadPrice`→`price`, `contractId`→`contractID`, add `ok: true`
3. Replace `console.log/error` with `logger.info/error` in `spread-proxy.ts`
