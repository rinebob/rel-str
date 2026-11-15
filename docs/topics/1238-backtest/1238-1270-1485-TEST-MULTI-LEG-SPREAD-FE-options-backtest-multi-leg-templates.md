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

# Test Plan — FE: Multi-leg Templates

## E2E User Journeys

- Pick a named variant in the replay dialog → run starts → contract-list table shows position rows with expandable legs.
- Pick a base template → dial Δ/DTE per leg → composed preview → run inline (legs[] submitted).
- Compose from scratch → Copy JSON → output is paste-valid against `ReplayVariant` (verify by pasting into the registry spec).
- Open builder from `/options/strategy/build` and from the new-strategy dialog → return populates the form's coordinate fields (1-leg variants only this thread).
- v1 list doc → table renders legacy `pick` rows as 1-leg positions (visual parity).

## Integration Tests

- Builder dialog ↔ registry: band bounds render correct Δ/DTE options per leg; composed `legs[]` matches the shape's structure.
- Run dialog → `optionsReplayStart` call args: `{variantId}` vs `{variantName, legs}` — assert the request form per selection path.
- Contract-list component + list-doc store: v1 narrowing shim applied at read; `legMisses` render on no-selection rows; `legMetas[]` coverage display.
- Strategy form: variant return → coordinate fields populated; multi-leg variants filtered/disabled on this surface.

## Unit Tests

- Builder component: band → picker option generation; add/remove leg rows; copy-JSON output shape; variantName propagation.
- Row renderers: position summary chips; leg detail expansion; no-selection per-leg miss display.
- `v1PickToPosition` shim usage in the table selector (consumed, not re-implemented).

## Test Seams

- Highest seam: TestBed component tests with stubbed store/registry — builder → submit → assert callable args.
- Lower seams: pure composition helpers (band → options, legs preview builder).

## Existing Test Coverage

- Replay run dialog + contract-list table specs (v1) — update for two-section layout and position rows.
- Strategy-form dialog specs — extend for the builder entry point.

## Edge Cases

- Shape with a stock leg — renders a fixed leg row (no Δ/DTE controls).
- Same legs composed twice → identical `legs[]` (deterministic ordering).
- Empty variantName → falls back to a derived label on the run doc.
- Dialog cancelled mid-compose → no partial submission; form state untouched.
- no-selection row where `legMisses` is empty (all-legs out-of-range) → renders the day-level reason.
