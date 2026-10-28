**Topic:** Options Backtest  
**Topic Slug:** options-backtest  
**Thread:** Selection Replay  
**Thread Slug:** selection-replay  
**Issue:** #1242  
**Thread Parent:** #1240  
**Topic Parent:** #1238  
**Task:** #1279  
**QA Issue:** #1299  
**Domain:** BACKTEST  
**Type:** UAT  
**Status:** Complete  
**Created:** 2026-10-26  
**Last Updated:** 2026-10-26  

# UAT — Task #1279 (Pick-doc client)

BE plumbing task — the deliverable is a transport-seamed client matching the
confirmed SA contract. Scenarios verify request construction, merge/error
semantics, and seam honesty; no user-facing surface exists yet.

## Scenarios

| # | Scenario | Evidence | Result |
|---|---|---|---|
| 1 | Grid-key derivation: signed `targetDelta` → `deltaPct` (puts −0.20→20, calls +0.30→30); `pickDocCellId` produces `QQQ-put-20-45` | unit tests ×2 | PASS |
| 2 | Request shape per confirmed contract — one `(symbol, type, deltaPct, dte, year)` call per calendar year; symbol uppercased | captured-request assertion | PASS |
| 3 | Year-boundary span fetches + merges: 2024–2026 shards → unioned `days`, min `firstDate`, max `lastDate`, summed pick/miss counts, freshest `gridVersion` | unit test, 3 captured calls | PASS |
| 4 | Sparse coverage tolerated — a 404 year shard is skipped; remaining shards merge | unit test | PASS |
| 5 | Missing doc → Journey-2 contract: all shards 404 → `PartnerHttpError(404)` naming `QQQ-put-20-45` for the list-doc `failed` path | unit test + message match | PASS |
| 6 | Bad input ≠ missing data — malformed `startDate` → 400 naming the coordinate, never a misattributed 404 | unit test | PASS |
| 7 | Hard failures propagate — off-grid 400 surfaces immediately (not swallowed by the 404-skip) | unit test | PASS |
| 8 | Seam honesty — default production transport is the ID-token GET path; tests never touch the real SA wire; provisional constants (endpoint name, `deltaPct`, raw-doc parse) are single-point for SA#225 | code read + test structure | PASS |
| 9 | Harness registration — `npm run test:options-replay` runs the suite | functions/package.json + run output | PASS |

## Traceability (issue ACs)

| AC | Scenario(s) |
|---|---|
| Client builds the SA request per the confirmed contract | 1, 2, 3 |
| Transport injectable/mocked in tests | 8 |
| Endpoint-missing path surfaces a named error carrying the coordinate | 5, 6 |
| Tests assert request shape per TEST-BE | 2, 3, 4, 7 |

## Refinement

N/A — no user-facing surface; the client is consumed by #1280's worker.

## Verdict

**PASS** — 9/9 unit tests, `functions tsc --noEmit` clean, esbuild bundle OK,
all 4 ACs covered with fresh-gate evidence.
