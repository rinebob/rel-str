**Topic:** Options Backtest  
**Topic Slug:** options-backtest  
**Thread:** Selection Replay  
**Thread Slug:** selection-replay  
**Issue:** #1242  
**Thread Parent:** #1240  
**Topic Parent:** #1238  
**Domain:** BACKTEST  
**Type:** TEST  
**Status:** Draft  
**Created:** 2026-10-25  
**Last Updated:** 2026-10-26  

# Test Plan — BE: Selection Replay

## E2E User Journeys

- Journey 1: User submits a selection-replay run (template + symbols + startDate) → run doc created `pending`→`running` → per-symbol tasks execute → run reaches `completed` with `completedLists === totalLists`.
- Journey 2: One symbol's pick doc is missing for the coordinate → that list doc is `failed` with the coordinate named; other symbols succeed; run is `completed` with `failedLists === 1`.
- Journey 3: Invalid `templateId` → callable rejects `invalid-argument`, no run doc, no tasks.

## Integration Tests

- `optionsReplayStart` → Firestore + task enqueue: valid request creates run doc with correct shape and enqueues exactly `symbols.length` tasks carrying `OptionsReplayPermutationPayload`.
- `optionsReplayPermutation` → pick-doc client + mapper + Firestore (fixture doc + fixture symbol-data bars): writes list doc `{runId}_{symbol}` with rows, `pickDocMeta`, `status:'success'`; run counters increment; last task flips run `completed`.
- Task retry/idempotency: permutation invoked twice for the same symbol → second invocation short-circuits on `status === 'success'`; run counters unchanged.
- Partner proxy fetch: `pick-doc-client` builds the request through the same ID-token auth path as `partnerHistoricalOptions*` — assert the call shape, mock the transport.

## Unit Tests

- `mapPickDocToRows` (pure, highest-value seam):
  - every trading day whose `doc.days` entry is a pick → `kind:'pick'` row with all fields + `side` stamped
  - `doc.days` entry with miss status (`no_match`/`no_chain`) → `kind:'no-selection'` row, reason `'miss'`/`'gap'`
  - trading day absent from `doc.days` → `kind:'no-selection'` row
  - days past `doc.lastDate` within the trading-day window → `no-selection`
  - consecutive picks with same `contractId` → `repeatsPrevious: true` on later rows; resets after a `no-selection` day
  - `startDate` earlier than `doc.firstDate` → trading days before firstDate are markers, not crashes
- `optionsReplayStart` validation: unknown `templateId`, empty `symbols`, non-ISO `startDate`, symbol uppercase normalization.
- Run-status transitions: `pending`→`running` on enqueue; `completed` when all lists resolve; partial-failure math.

## Test Seams

- **Seam 1 — pick-doc client:** injectable fixture `PickDocument` (or fixture-transport behind `pick-doc-client`); the real SA wire stays untested until the endpoint exists — integration test asserted on request shape only.
- **Seam 2 — mapper:** pure function; fixture doc + synthetic trading-day array. No Firestore, no network.
- **Seam 3 — task handler:** Firestore emulator/test-harness pattern used by `stBacktestPermutation` tests; mock `pick-doc-client` + `data-loader` bar read.
- Symbol-data trading-day calendar behind `getCachedBarsFromSymbolData` — fixture bars control the window boundaries deterministically.

## Existing Test Coverage

- `stBacktestPermutation` task tests are the structural precedent — mirror their Firestore-harness + mock pattern.
- `partner-proxy`/`partnerHistoricalOptions*` tests are the precedent for asserting the ID-token fetch shape.
- `runReplay`/analysis tests reuse `getCachedBarsFromSymbolData` fixtures — same fixture pattern for trading days.
