**Topic:** Paper Trading Infra  
**Topic Slug:** `paper-trading`  
**Thread:** Signal Selection  
**Thread Slug:** `signal-selection`  
**Issue:** #1642  
**Thread Parent:** #1117  
**Topic Parent:** #553  
**Domain:** PAPER-TRADING  
**Type:** TEST  
**Status:** Approved  
**Created:** 2026-11-20  
**Last Updated:** 2026-11-20  

# BE TEST — signal-selection: review callables, wipe, retire

## Scope

- `handleGetSignalReviewQueue` — list-union, symbol-meta merge,
  review-state merge.
- `handleGetSignalReviewBundle` — occurrence read (D-only),
  `signalDedupeKey` ledger join, read-then-stamp `lastOpenedAt`.
- `groom-legacy-signal-trades` — eligibility parity with the delete
  callable, dry/apply, idempotent re-run.
- Auto-mint retire — config assertion + zero-mint proof (verify script;
  the flip is an ops step).

## E2E User Journeys

N/A at this layer — pane-level journeys live in the FE TEST/UAT docs.
LIVE verify runs the real Firestore reads for smoke evidence.

## Integration Tests

### `handleGetSignalReviewBundle` (deps-injected)

- Occurrence → row mapping: `StSignal` fixture fields land on
  `SignalReviewOccurrence` (`occurrenceId` = `stSignalOccurrenceId`,
  `signalBarDate` = doc `barDate`, indicators passthrough).
- Join: a trade whose `signalId` equals `signalDedupeKey(symbol,
  signalType, barDate)` for occurrence O → O renders `checked: true`
  with `tradeId` + `tradeStatus`; a trade for a different occurrence
  does not check O (proves key-shape match, not "any trade on symbol").
- Newest-first ordering asserted on multi-occurrence fixtures.
- `previousOpenedAt` = value the state doc held *before* the read;
  `openedAt` = `now()` injected; `stampOpened` called exactly once with
  `(symbol, now)` — even when `occurrences` is empty.
- First visit (`getReviewState` returns `{}`) → `previousOpenedAt: null`.
- `invalid-argument` on empty/non-string symbol.
- Stamp write throw → handler throws `internal` (no silent unstamped
  serve).

### `handleGetSignalReviewQueue` (deps-injected)

- Union semantics: members present in both list docs appear once;
  members in only one appear once each; non-members never appear.
- `lastDailySignalDate` merged from symbol-meta results; member with no
  symbol doc → field absent (picker still lists it).
- `lastOpenedAt` merged from the review-state map; absent → `undefined`
  (first-open state).
- `ownerUid` sourced from `st-config/autoPaper` — the dep resolves the
  same user the retired ingest resolved.

### `groom-legacy-signal-trades` (deps/DB-fixture spec)

- Eligibility parity: fixture trades carrying `cohortId`,
  `positionGroupId`, or `ticket` are skipped + reported — never deleted
  (same refusal set as `handleDeletePaperTrades`).
- Eligible curated-origin trade → cascade invoked with its trade id.
- `--dry` reports the census without any delete calls; `--apply` deletes.
- Re-run after apply → all ids report `notFound`/absent — idempotent.

## Unit Tests

- `signalDedupeKey` join helper: swapped-args regression — building the
  key as `(symbol, barDate, signalType)` (the `stSignalOccurrenceId`
  order) must NOT match a trade `signalId`; the correct order must.
  (Pins the documented non-interchangeability at the seam that joins.)
- Occurrence filtering: only `timeframe=='D'` rows reach the mapper
  (assert the query dep receives the filter, or the mapper drops W).

## Test Seams

- `SignalReviewDeps` — every I/O leg injected: `listOccurrences`,
  `listSignalTrades`, `listMembers`, `getSymbolSignalDates`,
  `getReviewState`, `stampOpened`, `now()`. Specs never touch Firestore.
- Groom script — the same `DeletePaperTradesDeps`-shaped seam
  (`deleteTradeCascade` stubbed + eligibility predicate exercised
  against fixture docs).

## Test data / fixtures

- `StSignal` fixtures: two D occurrences (one matching a trade, one
  not), one W occurrence (excluded).
- `PaperTrade` fixtures: curated-origin (`signalId` = dedupe key, no
  cohort/ticket fields) and accept-flow (`signalId` + `cohortId` —
  joins `checked` in the bundle but is skipped by the wipe).
- `st-symbol-lists` member fixtures: overlapping PRIMARY/SECONDARY
  membership.

## Existing Test Coverage

- `tests/functions/paper-trading/delete-paper-trades.test.ts` —
  eligibility/refusal cases the wipe spec mirrors.
- `signal-trade-callables.ts` prod-deps factories — the prod wiring
  pattern for the new module.

## Edge Cases

- Symbol never opened → `previousOpenedAt: null` and every occurrence
  renders "new" on the FE.
- Trade whose `signalId` matches an occurrence but whose doc is missing
  `tradeStatus` → `checked` still true; `tradeStatus` absent.
- Duplicate occurrences (doc id uniqueness guarantees this can't exist;
  defensive spec optional).
- Queue: `st-config/autoPaper` missing `ownerUid` → handler falls back
  or throws `failed-precondition` (decide + spec — do not silently pick
  a user).
- Wipe run while a pane mints concurrently — out of scope; ops orders
  wipe before pane ships (documented in AC).

## Verify relay

- `cd functions && npm run test:paper-trading` — new spec file added to
  the batch list in `functions/package.json`
- `cd functions && npm run build`
- `functions/scripts/verify/paper-trading-signal-review-callables-{task}.ts`:
  DRY (fixture deps, run-all safe); LIVE (real Firestore — a known
  symbol's bundle: occurrence count > 0, join sanity, stamp written).
- `functions/scripts/verify/paper-trading-signal-review-retire-{task}.ts`:
  DRY census math; LIVE asserts `st-config/autoPaper.enabled == false`,
  `source==SIGNAL` trade count == 0 post-wipe, and reports the last
  ingest run's mint count == 0.
- `scripts/verify/run-all.ts` + `README.md` registration rows.
