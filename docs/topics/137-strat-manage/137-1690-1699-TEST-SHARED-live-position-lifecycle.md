**Topic:** Strategy Manager  
**Topic Slug:** strat-manage  
**Thread:** Live Position Lifecycle  
**Thread Slug:** live-position-lifecycle  
**Issue:** #1699  
**Thread Parent:** #1690  
**Topic Parent:** #137  
**Domain:** SHARED  
**Type:** TEST  
**Status:** Draft  
**Created:** 2026-11-23  
**Last Updated:** 2026-11-23  

# TEST-SHARED: contract specs for the lifecycle math + identity

## Scope

Pure-function and contract tests for: signed netMark + uniform P&L, the option-legs selection predicate, and canonical variant ID/name. No Firestore, no providers — all injectable/pure seams.

## E2E User Journeys

None — SHARED contracts surface through BE/FE consumers; their journeys live in the BE/FE TEST docs.

## Integration Tests

None — pure `shared/` specs only (`npx jest shared/`).

## Unit Tests

- **`netMark`** — 2-leg credit (CCS/PCS), 2-leg debit (CDS/PDS), naked strangle (both short → net = −gross), 4-leg IC; `×100×qty` verified; sign convention pinned.
- **`unrealizedPnl(signedEntryPremium, netMark)`** — credit `C − V`, debit `V − D`, both through the one formula; round-trip vs entry.
- **`signedEntryPremium`** — credit `+premium`, debit `−cost`; absent field → spec-defined zero/error semantics.
- **`hasOptionLegs`** — option trade ✓; stock signal trade ✗; empty/absent legs ✗; legacy + manage shapes both ✓.
- **Variant ID ↔ name** — `SPY-CDS-30-50-40-ALL` → correct name; CDS segment order pinned (the regression); all catalog families round-trip parse → render → re-parse; malformed ids fail honestly.
- **Catalog contract** — every catalog entry's id parses + renders; no duplicate display names.

## Test Seams

- `shared/*.spec.ts` beside the contracts — the established convention; no DI, no mocks needed.

## Test data / fixtures

- Leg fixtures per posture (strike/mark/qty/side tuples) — literal, minimal.
- Real catalog ids for the name round-trips (no fabricated ids — read from the actual catalog).

## Existing Test Coverage

- `manage-variant-catalog` + `manage-instance-contracts.spec.ts` — extend, don't fork.
- Backtest net-mark specs — consolidate expectations so both surfaces pin the same convention.

## Edge Cases

- Zero/qty-multiplied marks; legs with absent marks (should a missing leg mark zero or exclude — pin the choice).
- Malformed/partial variant ids — honest failure, no silent reorder.

## Verify relay

- `npx jest shared/` green → hands to BE (helpers consumed by passes) and FE (name + signed fields bound).
