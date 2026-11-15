**Topic:** Options Backtest  
**Topic Slug:** options-backtest  
**Thread:** Multi-leg Templates  
**Thread Slug:** multi-leg-templates  
**Issue:** #1485  
**Thread Parent:** #1270  
**Topic Parent:** #1238  
**Domain:** MULTI-LEG-SPREAD  
**Type:** TEST  
**Status:** Draft  
**Created:** 2026-11-14  
**Last Updated:** 2026-11-14  

# Test Plan — BE: Multi-leg Templates

## E2E User Journeys

- Multi-leg replay: start a 2-leg vertical variant run for SPY → list doc v2 contains `position` rows with two resolved legs on trading days, `no-selection` rows with `legMisses` where a leg failed → analyzer produces per-position records keyed `{listDocId}_{exitId}`.
- Single-leg parity: an existing 1-leg variant produces rows identical in shape to a 1-leg position.
- v1 doc compat: a pre-change list doc still analyzes — rows narrow to 1-leg positions.
- Live selection: an instance at a concrete coordinate fills at an RH quote whose contract matches `selectContractAtCoordinate`'s output.

## Integration Tests

- Worker: N `fetchPickDoc` calls (fake transports, one per leg) → mapper → list doc write — assert row count, `legMetas[]` ordering, `schemaVersion: 2`, `variantSnapshot` provenance.
- Analyzer: fake series fetch per leg → net mark series → exit evaluators — assert position-level records, settlement freezing, stock-leg marks from underlying close.
- Start callable: variantId resolution, inline-legs validation, snapshot stamping, per-symbol fanout.
- Live adapter: fixture RH chain/quotes → `selectContractAtCoordinate` → fill; assert the same coordinate semantics as the pick-doc path.

## Unit Tests

- `mapLegsToPositionRows` — date join: all-pick → position; one-leg miss → no-selection + `legMisses`; absent-in-range keys; out-of-range; `repeatsPrevious` all-legs semantics; stock legs always resolve.
- Net-series builder — signed sum; long/short asymmetry; leg expiry freezing while others continue; missing greek field → absent, not zero.
- `selectContractAtCoordinate` — SA semantics per the confirmed spec (nearest-Δ, nearest-expiry, tie-breaks); no candidates → null.
- `v1PickToPosition` — field-for-field mapping.

## Test Seams

- Highest seam: `ReplayPermutationDeps` fakes (fetchPickDoc per leg) + Firestore harness — covers worker E2E without SA.
- Analyzer: series-fetch dep fakes + in-memory list docs.
- **Parity harness:** `selectContractAtCoordinate(getEodChain(S,T), C)` vs `pickDoc[C].days[T].contractId` over a fixture matrix — the convergence check that live matches corpus.
- Pure functions for all mappers/combiners.

## Existing Test Coverage

- `pick-doc-mapper` spec (v1) — rewrite for position rows.
- `pick-doc-client` tests — unchanged (fetch contract identical).
- Analyzer worker tests — extend for multi-leg series combining.
- `expression-fill-pass` tests — extend for concrete-coordinate selection.

## Edge Cases

- Leg miss asymmetry: leg A picks, leg B `no_chain` → no-selection row, `legMisses` names B.
- All-legs all-404 → list doc `failed` naming the coordinate (existing terminal semantics).
- One leg's series fetch fails mid-analysis → `error` outcome record, other rows unaffected.
- Position where legs expire on different days — earlier leg frozen at settlement.
- Retry mid-worker: terminal list doc short-circuits; close-out idempotent (existing doctrine).
- Expression-fill: no in-band expiry near targetDte → `no_contract` ticket error (existing).
