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

# Test Plan — SHARED: Multi-leg Templates

## E2E User Journeys

- (Shared layer — journeys live in the BE/FE plans. Contract-level journey: a variant registry entry → `legToPickDocCoordinate` → a `PickDocShardRequest` the SA client accepts; a v1 `pick` row → `v1PickToPosition` → a valid v2 position row.)

## Integration Tests

- Registry ↔ contract types: every `REPLAY_VARIANTS` entry produces valid `VariantLeg[]`; every `TemplateShapeLeg` band value falls on the Δ/DTE grid.
- `OptionsReplayStartRequest` discriminated forms: `{variantId}` xor `{legs}` — round-trips through the BE validator's expected shape.
- v1→v2 narrowing: a v1 `pick` row + v1 `no-selection` row → v2 `position`/`no-selection` rows preserve every field (contractId, marks, side, reason).

## Unit Tests

- `validateVariantRegistry()` — catches duplicate ids, off-grid Δ (e.g. -0.22), off-grid DTE (e.g. 40), option leg missing fields, stock leg carrying option fields, duplicate legs within a variant; empty list on a clean registry.
- `legToPickDocCoordinate` — put/call sign conventions; expiry `{mode:'nearestDte', dte}` shape.
- Type guards: `isPickDocPick` narrowing on `PositionLeg` unions; `kind` discriminators on `VariantLeg`.
- `pickDocDeltaPct` sign handling (already covered — extend for leg-based call sites).

## Test Seams

- Highest meaningful seam: pure contract validation — `validateVariantRegistry` over the real `REPLAY_VARIANTS`/`REPLAY_TEMPLATE_SHAPES` arrays (guards the shipped data, not just fixtures).
- Lower seams: individual guard/derivation functions against synthetic values.

## Existing Test Coverage

- `shared/options-replay-contracts.spec.ts` — v1 row/doc contracts; extend for v2 + shim.
- Registry spec exists for the four current templates — extend to the two-registry model.

## Edge Cases

- Variant with only a stock leg (legal? — validator decides; test pins it).
- `repeatsPrevious` on the first row of a doc (no prior row → false).
- v1 docs read after v2 ships — narrowing covers every field, including `repeatsPrevious` reset across no-selection gaps.
- Off-grid values in inline `legs[]` — rejected at validation, not silently snapped.
