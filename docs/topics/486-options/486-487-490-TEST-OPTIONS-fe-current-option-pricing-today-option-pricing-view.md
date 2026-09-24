# Test Plan — FE: Today's Option Pricing View

**Topic:** Current option pricing  
**Topic Slug:** current-option-pricing  
**Thread:** Today's option pricing view  
**Thread Slug:** today-option-pricing-view  
**Issue:** #490  
**Thread Parent:** #487  
**Topic Parent:** #486  
**Domain:** OPTIONS  
**Type:** TEST  
**Status:** Complete  
**Created:** 2026-09-22  
**Last Updated:** 2026-09-24  

## E2E User Journeys

- Open page → chain for resolved latest session renders without input
- Click "Today" → re-resolves and reloads the latest session
- Pick a past date (datepicker or manual) → that session's chain renders,
  chg vs its prior session
- Toggle CALLS / PUTS / BOTH → layout switches; BOTH shares strike column
- Flip orientation per side in BOTH mode → sides reorder independently
- Hover a cell → corner info icon appears; hover the icon → popup with
  full contract payload; move to an adjacent cell's icon → popup
  re-anchors
- Narrow delta/strike/expiration filters → grid shrinks to matching
  contracts
- Open page intraday → resolved date is prior session; post-1PM PT → today
  or fallback

## Integration Tests

- Component + Store: filter/type/orientation changes recompute grids
  without new fetches (snapshots cached in state)
- Store + Service: `getHistoricalOptionsChain$` mocked per-date — walk-back
  consumes candidate dates in order; parallel session+prior fetch
- Store + Service: `getDailyBarsForRange$` mocked — header picks session &
  prior closes at/before resolvedDate
- Store + service error → error state set; loading flags clear

## Unit Tests

- Pure functions:
  - `resolveSessionDate` — before/after 1PM PT boundary, weekends, Monday
    post-holiday cases
  - walk-back iterator — skips Sat/Sun, caps at 7 days
  - `buildChainCells` — chg $/% vs prior by contractID; missing mark →
    "n/a"; missing prior → chg "n/a"
  - filter application — delta band ±0.6 on calls (+) and puts (−), strike
    and expiration ranges
  - strike union for BOTH layout; per-side orientation ordering
  - date/cell formatting (mark "n/a", signed chg, IV %, delta)
- Store: state transitions, guards (symbol+date required), cache
  invalidation on symbol/date change
- Component: layout toggle renders 1 vs 2 grids; popup content binds
  contract fields

## Test Seams

- Highest seam: Angular TestBed on `OptionChainComponent` — mocked
  `OptionsContractService` (per-date chain fixtures), `LocalBarReadService`
  (bar fixtures), Firestore/Auth/Functions stub providers
- Lower seams: pure utils (session resolution, cell building, filters);
  store tests with mocked services
- No E2E for this Thread — Jest coverage only

## Existing Test Coverage

- `option-chain-pct-change` specs cover the *old* grid's pct-change
  semantics — not reused; new specs live under `pages/option-chain/`
- `local-bar-read.service.spec.ts` already covers bar fetching
- `options-contract.service.ts` is a thin callable wrapper — mocked at the
  store seam

## Edge Cases

- Empty chain response → walk-back continues; 7-day exhaustion → no-data
  state
- Snapshot returns contracts but all filtered out → filter-empty message
- Contract present today but not in prior snapshot (new listing) → chg
  "n/a", price shown
- Contract missing `mark` → price "n/a" — never falls back to `last`
- Prior-session snapshot itself missing (coverage gap) → grid renders with
  all chg "n/a"
- Symbol with no chain coverage at all → resolution exhausts → clear
  no-data message
- VERY large chain (hundreds of strikes × dozens of expirations) →
  delegated handlers only; no per-cell bindings
- Invalid/unparseable manual date → validation message, no fetch
