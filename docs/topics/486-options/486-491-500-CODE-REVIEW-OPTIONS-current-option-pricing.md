# Code Review — #500 Chain grid component (single type)

**Topic:** Current option pricing  
**Topic Slug:** current-option-pricing  
**Thread:** Today's option pricing view  
**Thread Slug:** today-option-pricing-view  
**Issue:** #491  
**Thread Parent:** #487  
**Topic Parent:** #486  
**Task:** #500  
**Domain:** OPTIONS  
**Type:** CODE-REVIEW  
**Status:** Complete  
**Created:** 2026-09-22  
**Last Updated:** 2026-09-22  

**Verdict: PASS** — all 415 option-chain-scope tests green, full suite
green (122/1667), `tsc` clean. Findings remediated during review.

Scope: `utils/chain.utils.ts` + spec, `components/chain-grid.component.ts`
+ spec, `option-chain.component.*` wiring (interim controls + stacked
calls/puts grids — documented placeholders for #501/#503).

## Standards

- `parseNum` reused from `contract-observation.utils` — no duplication.
- Contract conformance: `OptionType` enum, all-optional-string fields,
  `data.data` unwrap — all verified.
- Empty-state text matches the pct-change grid verbatim.
- Nits fixed: `closest<HTMLElement>` generic over `as` cast; dead
  `imports: []` dropped; shadowed `cells` var renamed in spec.

## Spec

All ACs met. Remediations:

- **priorMark = 0 dropped a valid chg$** — `chgText` now renders
  `+$2.50 / n/a` (money part kept, pct suppressed). Test added.
- **Float-noise `- $0.00`** — `chgAbs` clamps |Δ| < $0.005 to zero.
  Test added.
- Strike sort desc (high at top) confirmed against IMPL orientation
  default; IV rendered as fraction × 100 — assumption documented.

## Thermo-nuclear

- **Asymmetric intra-cell suppression** — `onCellOver` now mirrors
  `onCellOut`'s `relatedTarget` containment guard, so a cell visit emits
  exactly one enter/leave pair (prevents popup re-anchoring flicker in
  #502). Intra-cell transition test added; header/empty-cell negative
  test added.
- `data-cid` keys on contractID — deliberate (popup needs contract
  identity); duplicate contractIDs at one strike|expiration are
  pathological and last-win by construction.

## Test results

- `chain.utils.spec.ts`: 13 tests | `chain-grid.component.spec.ts`: 10
  | `option-chain.component.spec.ts`: 7 (incl. store-mock states)
- Full suite: 122 suites / 1667 tests pass
- `tsc -p tsconfig.app.json --noEmit`: clean

## Notes for #501/#502

- `ChainCellHover { cell, target }` is the popup anchor seam.
- Per-side strike orientation and BOTH layout hook through
  `buildChainGrid` (rows already sorted desc — add an order param).
