**Topic:** Scanner Chart View  
**Topic Slug:** scanner-chart-view  
**Thread:** Chart View Extension  
**Thread Slug:** chart-view-extension  
**Issue:** #1239  
**Thread Parent:** #1233  
**Topic Parent:** #1232  
**Domain:** CHART-REVIEW  
**Type:** TEST  
**Status:** Draft  
**Created:** 2026-01-30  
**Last Updated:** 2026-01-30  

# Test Plan (SHARED): Scan Latest Run contract

Small surface — one contract type, its serialize/parse pair, path helpers, and a one-line rules extension. Almost everything is pure-function unit testing; the rules change is verified by emulator coverage conventions already used for anchored collections (or code-review inspection if no rules harness exists).

## E2E User Journeys

None — no user-visible behavior in this area. The consuming journeys live in the FE test plan.

## Integration Tests

- `stScannerLatestRunsPath()` / `stScannerLatestRunDocPath('quality-large')` produce `st-scanner/latest-runs/items` and `.../items/quality-large` — odd/even segment counts so AngularFire `collection()`/`doc()` accept them (same assertions the proposals helpers carry if tested).
- `firestore.rules` — `latest-runs` anchor: authed create/update/delete permitted; unauth denied. If the repo has a rules-emulator spec for `st-scanner` extend it; otherwise verify by inspection and note the gap (the proposals anchor set the precedent — check how it was covered).

## Unit Tests

Pure functions — `shared/scanner-contracts.ts`:

- `serializeScanLatestRun`:
  - round-trip fidelity: `parse(serialize(run))` deep-equals `run`
  - output is plain Firestore-safe data (no class instances, no undefined leaves under `rows[].columns`)
- `parseScanLatestRun`:
  - accepts a valid doc (all fields present, `rows` populated and empty)
  - throws on missing/mistyped scalars (`recipeId` non-string, `totalItems` non-number, `truncated` non-boolean, `ranAt` non-string)
  - throws when `rows` is not an array, when a row lacks `ticker: string`, or when `row.columns` isn't `Record<string, string>`
  - tolerates extra/unknown fields (forward-compat, same posture as `parseCurationProposal`)
- `isScanTruncated` reused unchanged — no new tests (already covered by scanner specs).

## Test Seams

- Highest seam: Jest unit suite against the pure functions — there is no async surface in this area.
- Lower seam: none needed beyond the pure calls.

## Existing Test Coverage

- `parseCurationProposal`/`serializeCurationProposal` coverage in scanner specs is the pattern to mirror.
- Path-helper coverage: check whether `stScannerProposalsPath`/`stScannerProposalDocPath` have spec coverage; match it (likely none — helpers are one-line joins; the IMPL doc's segment-parity assertion is the cheap guard).

## Edge Cases

- Empty `rows: []` — a scan that matched zero rows is still a valid latest run; serialize/parse must round-trip it.
- `rows` at the 200-row cap with `truncated: true` — no size guard needed at parse (under 1 MB), but parse must not choke on large `columns` maps.
- Row with `columns: {}` — valid (a coverage-style row has no metric columns); parse accepts.
- Drifted doc shapes — each malformed variant throws (FE read path treats throw as skip/absent).
