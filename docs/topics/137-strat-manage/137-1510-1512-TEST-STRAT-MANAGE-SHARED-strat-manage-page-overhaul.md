**Topic:** Strategy Builder UI  
**Topic Slug:** strat-manage  
**Thread:** OpsStrat Manage Page Overhaul  
**Thread Slug:** page-overhaul  
**Issue:** #1512  
**Thread Parent:** #1510  
**Topic Parent:** #137  
**Domain:** STRAT-MANAGE  
**Type:** TEST  
**Status:** Draft  
**Created:** 2026-11-14  
**Last Updated:** 2026-11-14  

# Test Plan (SHARED) — OpsStrat Manage Page Overhaul

## Unit Tests

- `generateManageInstanceId`:
  - `{SYM}-{SPREAD}-{DTE}-{ΔLEGS}-{STOP}` format, all caps
  - multi-leg spread codes (CDS, PDS, IC, CSP, CC)
  - leg-delta ordering follows template leg order
  - `ALL` vs concrete stop suffix
  - throws on empty legs / missing template
- Catalog module:
  - `MANAGE_TEMPLATES`/`MANAGE_VARIANTS` seed entries parse against the
    contract types (template legs have no Δ/DTE; variant legs do)
  - lookup helpers hit/miss
- Contract invariants:
  - paper ⇒ `stopType === 'ALL'`; real ⇒ `stopType !== 'ALL'` (validator fn)
  - `ManageInstance` embeds variant snapshot

## Edge Cases

- Delta formatting: 0.5 vs 0.50 vs 50 (Δ segment is integer-percent style
  per the ID examples: `50-40`)
- Variant with >2 legs (iron condor: 4 legs, 2 short deltas in ID)
- `STOP` code vocabulary placeholder until real codes land

## Existing Coverage

- `shared/strategy-instance-id.ts` spec — pattern to mirror; old generator
  untouched (separate function, no shared mutation).
