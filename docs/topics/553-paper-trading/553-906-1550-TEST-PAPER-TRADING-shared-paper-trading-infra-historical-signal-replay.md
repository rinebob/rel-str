**Topic:** Paper Trading Infra  
**Topic Slug:** paper-trading-infra  
**Thread:** Historical Signal Replay  
**Thread Slug:** historical-signal-replay  
**Issue:** #1550  
**Thread Parent:** #906  
**Topic Parent:** #553  
**Domain:** PAPER-TRADING  
**Type:** TEST  
**Status:** Complete  
**Created:** 2026-11-15  
**Last Updated:** 2026-11-17  

# SHARED TEST — Historical Signal Replay

Contract-level coverage for the mint/delete surfaces, the curated
variant set, and the governing-policy constants.

## E2E User Journeys

- Pick signals on a symbol → `generatePaperSignalTrades` → ledger rows
  appear with backdated fills + marks → groom → `deletePaperTrades`
  removes them entirely. (Journey verification lives in the BE plan.)

## Integration Tests

- Request/response shapes round-trip through the callable boundary
  unchanged (no Date→string surprises — plain string/number/array
  shapes only).
- `SignalPick` validation: malformed `signalBarDate`, missing
  `signalType`, empty `items`, oversized `items` → typed error codes.

## Unit Tests

- `CURATED_VARIANT_KEYS` — `trailing-8` always present (the policy
  fallback must resolve); keys unique; every key matches the
  `{family}-{param}` grammar shape. The `parseVariantKey` round-trip
  for `ma-close-*`/`target-*` lives in TEST-BE (#1574) — the families
  don't exist in the registry yet, so it can't be a shared-seam test.
- `GoverningPolicy` marker — `CURATED_GOVERNING_POLICY` value pinned
  ('deepest-stop-else-trailing-8'); `PaperTrade.governingPolicy`
  optional-field shape.
- `OptionQuoteSource.SDS_BARS` — enum member present; existing members
  unchanged.
- `DeletePaperTradesRequest` shape — `tradeIds` array, bulk-bounded.
- Deterministic ids — `buildTradeId(barDate,'sig',symbol,desc)` and
  `signalDedupeKey` produce identical ids for live-ingest and
  backfill inputs of the same signal (the dedupe contract).

## Test Seams

- Highest seam: shared module import under jest — constants + type
  shapes.
- Lower seams: none needed — no logic lives in shared beyond constants.

## Existing Test Coverage

- `paper-trading-contracts.spec.ts` pins `SIGNAL_GOVERNING_VARIANT`/
  `SIGNAL_SHADOW_VARIANT_KEYS` — must keep passing (constants retained
  for non-signal trades).
- `data-pipeline-st-ids-999` verify script pins `stSignalOccurrenceId`
  layout — the mint path's id source.

## Edge Cases

- `items: []` → validation error, not an empty-success response.
- Duplicate picks within one request — second resolves `deduped`.
- `tradeIds` containing the same id twice → deleted once, no error.
