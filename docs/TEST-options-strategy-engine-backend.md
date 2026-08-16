**Topic:** Options Position Strategy Engine  
**Issue:** #108  
**Domain:** OPTIONS  
**Area:** BE  
**Type:** Test Plan  
**Status:** WIP. Journeys 3-5 (settlement + held-shares) tested. Remaining journeys pending.  
**Created:** 2026-08-13  
**Last Updated:** 2026-08-16

# Test Plan: Options Position Strategy Engine (BE)

**Note on E2E automation:** no E2E framework (Cypress or otherwise) is currently installed in this repo. The journeys below describe scenarios to validate, but for this Topic they are implemented as integration-level tests (direct function invocation with mocked SA/Firestore/scheduler seams — see Test Seams below), not real scheduler-triggered/browser E2E runs. Standing up an E2E framework is out of scope here and deferred to a future, dedicated effort.

## E2E User Journeys

- Journey 1: Scheduled open-pass fires for the `QQQM-WHEEL` instance at its configured open time → a live quote is fetched, the nearest-to-target-delta put within the DTE band is selected → a new position document is created with `premiumCollected`, `capitalRequired`, `status = OPEN`, and a `PUT` leg.
- Journey 2: Nightly pass runs after `symbol-data-sync` completes, for a position not expiring today → a `daily-updates/{date}` doc is written and the position's `currentValue`/`unrealizedPnl`/`currentValueAsOf` are refreshed from EOD data.
- Journey 3: Nightly pass runs on a position's expiration day, underlying closes **above** the strike (OTM put) → position `status = EXPIRED_WORTHLESS`, no `shares` field created, `premiumCollected` retained as final realized gain.
- Journey 4: Nightly pass runs on a position's expiration day, underlying closes **below** the strike (ITM put) → position `status = ASSIGNED_HOLDING_SHARES`, `assignment.strikePrice`/`assignment.underlyingCloseAtExpiration` set, `shares.costBasis = strikePrice`, `premiumCollected` unchanged.
- Journey 5: A position in `ASSIGNED_HOLDING_SHARES` status is updated on a subsequent nightly pass → `currentValue` tracks the day's underlying close (not the strike), `unrealizedPnl = (currentValue - costBasis) * 100 * quantity`.
- Journey 6: `options-strategy-stats/QQQM-WHEEL` and `options-strategy-stats/ALL` are both updated after open-pass and nightly-pass runs, with `equity-curve/{date}` receiving a new cumulative P&L point each day.

## Integration Tests

- `open-pass.ts` + `sa-quote-client.ts`: open pass correctly consumes the (mocked) SA real-time quote response shape and passes it through the contract-selection adapter.
- `open-pass.ts` + `position-repository.ts`: new position, leg, and raw-quote docs are all written atomically (or with a documented partial-failure/retry behavior) for a single open action.
- `nightly-pass.ts` + `symbol-data-sync` completion signal: nightly pass only runs after (not concurrently with, not before) the day's closing bar lands in `symbol-data/{symbol}/daily`.
- `nightly-pass.ts` + `position-repository.ts`: settlement correctly transitions `status`, sets `assignment`/`shares` fields, and appends a `daily-updates` doc in the same pass.
- `position-repository.ts` + Firestore: stats rollup (`options-strategy-stats`) increments/updates correctly across multiple positions opened/closed in sequence.

## Unit Tests

- Pure functions: contract-selection adapter (SA quote response → `HistoricalOptionContract[]` shape expected by the relocated `functions/src/common/option-contract-selection.ts` helpers); P&L/unrealized-P&L calculation for both OPEN (option mark based) and ASSIGNED_HOLDING_SHARES (share price based) phases; max-drawdown calculation over a cumulative P&L series.
- Services: `sa-quote-client.ts` (mocked HTTP responses — full-chain and per-contract paths); `position-repository.ts` CRUD helpers.
- Utils: instance-due-today check (given `frequency`, `openTimePT`, and current date/time in PT, is this instance due to open now).

## Test Seams

- Highest seam: `open-pass.ts`/`nightly-pass.ts` invoked directly as testable functions (not via the actual Cloud Scheduler trigger), with `sa-quote-client.ts` and `symbol-data` reads mocked — mirrors the existing pattern for testing `symbolDataSyncSymbol`/`enqueueAllSymbols` in `@c:\aa\projects\rel-str\functions\src\symbol-data-sync\symbol-data-sync.ts`.
- Lower seams: pure calculation functions (P&L, max drawdown, contract scoring reuse) tested with plain input/output, no Firestore or network involved.

## Existing Test Coverage

- `option-contract-selection.ts`'s `selectOptionContract`/`selectOptionSpread` already have test coverage under their current location — this coverage should move with the file during the relocation to `functions/src/common/`, not be rewritten from scratch.
- No existing coverage exists for position-lifecycle management, settlement, or assignment — this is entirely new ground for this Topic.

## Edge Cases

- No contract in the live quote response satisfies the DTE band (empty eligible pool) — open pass must skip and log, not throw or open a wrong-band contract silently.
- SA quote request fails or times out — open pass must not create a partial/incomplete position document.
- Nightly pass runs on a day with no corresponding `symbol-data` closing bar yet (holiday, data delay) — settlement check for positions expiring that day must be deferred, not falsely resolved with stale/missing data.
- Multiple positions expire on the same date — nightly pass must settle all of them independently without one failure blocking the others.
- Underlying closes exactly at the strike (boundary ITM/OTM) — verify against the $0.01 auto-exercise threshold discussed during planning, not a naive `<` vs `<=` assumption.
- Position already in `ASSIGNED_HOLDING_SHARES` when a later phase's covered-call logic doesn't yet exist — nightly pass must continue marking shares daily indefinitely without erroring on the "missing" next-phase logic.
