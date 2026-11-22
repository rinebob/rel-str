**Topic:** Paper Trading Infra  
**Topic Slug:** `paper-trading`  
**Thread:** Signal Selection  
**Thread Slug:** `signal-selection`  
**Issue:** #1642  
**Thread Parent:** #1117  
**Topic Parent:** #553  
**Domain:** PAPER-TRADING  
**Type:** TEST  
**Status:** Complete  
**Created:** 2026-11-20  
**Last Updated:** 2026-11-20  

# SHARED TEST — signal-selection contracts

## Scope

The new contract section in `shared/paper-trading-contracts.ts`, the
`SIGNAL_REVIEW_CONFIG_DOC` constant, and the
`signalPickFromReviewOccurrence` mapper. Type-level work — the test
surface is narrow: the mapper's field mapping and the constants' exact
values (a typo in a doc id or field name is the entire failure mode).

## E2E User Journeys

N/A — contracts only.

## Integration Tests

N/A — no cross-module behavior at this layer. The BE TEST doc covers
handlers consuming these shapes; the FE TEST doc covers the store.

## Unit Tests

### `signalPickFromReviewOccurrence`

- Maps `{symbol, signalBarDate, signalType}` exactly — a full
  `SignalReviewOccurrence` fixture in, a `SignalPick` literal out.
  This is the regression pin against swapping `barDate`/`signalBarDate`
  or `signalType` at the seam (the dedupe-key order hazard).
- Output satisfies `SignalPick` structurally — spec asserts the exact
  object so a contract field rename breaks loudly.
- Extra occurrence fields (`occurrenceId`, `indicators`, `checked`,
  `tradeId`) do not leak into the pick.

### Constants

- `SIGNAL_REVIEW_CONFIG_DOC === 'signalReview'` — literal pin; the doc
  id is shared writer/reader state.

### Contract stability (type-level, pinned via fixtures)

- `SignalReviewOccurrence` fixture round-trips the fields the join
  contract promises: `checked` required; `tradeId`/`tradeStatus`
  optional and present only when `checked` (documented pairing — not a
  runtime guard).
- `GetSignalReviewBundleResponse.previousOpenedAt` is `string | null`
  (null = first visit — the divider renders as "all new").

## Test Seams

- Pure functions/types — no seams. Specs import from
  `@paper-trading/contracts` (or the direct shared path the sibling
  specs use) and assert literals.

## Test data / fixtures

- One `SignalReviewOccurrence` fixture covering a checked row
  (tradeId + tradeStatus present) and one unchecked row.
- Fixture `signalType` should use a real type from the ingest allowlist
  (`D_ST_TREND_RIDER_V1_LONG` or the current equivalent) — keeps the
  fixture honest about the values that actually flow.

## Existing Test Coverage

- `shared/paper-trading-contracts.spec.ts` (or sibling) — existing
  `SignalPick`/request-shape pins; new specs extend the same file.

## Edge Cases

- Occurrence with `tradeId` absent and `checked: false` → mapper output
  identical (mapper ignores join fields entirely).
- `previousOpenedAt: null` typed and spec'd — first-open render path
  depends on it.

## Verify relay

- `npx jest shared/paper-trading-contracts` — new specs green alongside
  existing
- `cd functions && npm run build` — shared types compile into the
  functions bundle
- FE `tsc --noEmit` — FE can import every new type (registration of the
  `CallableName` entries is an FE-task AC, not this one)
