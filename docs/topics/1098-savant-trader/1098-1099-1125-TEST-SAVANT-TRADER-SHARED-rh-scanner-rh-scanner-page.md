**Topic:** RH Scanner  
**Topic Slug:** rh-scanner  
**Thread:** RH Scanner Page  
**Thread Slug:** rh-scanner-page  
**Issue:** #1125  
**Thread Parent:** #1099  
**Topic Parent:** #1098  
**Domain:** SAVANT-TRADER  
**Type:** TEST  
**Status:** Draft  
**Created:** 2026-10-20  
**Last Updated:** 2026-10-20  

# Test Plan: RH Scanner contracts (SHARED)

Pure types + pure helpers — the meaningful seam is **shape-correctness
against live wire data**, not behavior.

## E2E User Journeys

- n/a — contracts only.

## Integration Tests

- None at this layer; the FE verify relay (`rh-scanner-*` script) exercises
  these types end-to-end against the real session.

## Unit Tests — `shared/scanner-contracts.spec.ts`

- `stScannerProposalsPath()` → `'st-scanner/proposals/items'`;
  `stScannerProposalDocPath('x')` → `'st-scanner/proposals/items/x'`
  (4 segments — a valid doc path).
- `isExpressionFilter` / `isEnumFilter` narrow correctly on both shapes.
- `chunkSymbols([0..924], 150)` → 7 chunks (last = 25); a full-universe
  prune stays inside the 20-call `/batch` cap.
- `CurationProposal` round-trip: construct → serialize → parse → same
  fields (the FE writes this doc shape; drift here = unreadable history).

## Test Seams

- **Highest seam:** the capture-fixture parse — a real
  `dep-prev-scan-*.json` row parsed through the FE previewScan spec proves
  the wire types (lives in the FE test plan, depends on these contracts).
- **Lower seam:** the pure helpers above.

## Existing Test Coverage

- `shared/st-collections.spec.ts` — sibling anchor-path specs to mirror.
- `tests/functions/rh-agent-mcp-*.test.ts` — executor/schema-validation
  suites already cover `preview_scan` arg validation server-side; the
  shared types must not contradict `schema-validation`'s accepted shapes.

## Edge Cases

- `columns` values are always `string` — even numerics (`"758092.93"`,
  `"0.00437595..."`); consumers must coerce, never assume number.
- A standard column carries `display_name` only; an expression column
  carries both — typing must not require `expression`.
- `instrument_type` values seen live: `EQUITY`, plus ETF/crypto/futures
  rows — type as `string`, not a closed enum.
- Empty `results` with `total_items: 0` is a valid scan outcome, not an
  error.
