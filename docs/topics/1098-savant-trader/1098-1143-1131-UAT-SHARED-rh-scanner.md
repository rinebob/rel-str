**Topic:** Savant Trader  
**Topic Slug:** rh-scanner  
**Thread:** RH Scanner Page  
**Thread Slug:** rh-scanner-page  
**Issue:** #1143  
**Thread Parent:** #1099  
**Topic Parent:** #1098  
**Task:** #1131  
**Domain:** SHARED  
**Type:** UAT  
**Status:** Complete  
**Created:** 2026-10-19  
**Last Updated:** 2026-10-19  

# UAT — #1131: Scanner wire + domain contracts

## Scope

Shared scanner contracts for the RH Scanner page. This task delivers type
contracts and pure helpers only — no UI, no Firestore paths, no runtime
service. Acceptance is therefore CLI-verifiable: the unit spec, both
typechecks, and a live `preview_scan` contract check against the real
Robinhood MCP session.

Covered task acceptance criteria (issue #1131):

- `preview_scan` wire types in `shared/robinhood-mcp-contracts.ts`:
  `ScanEnumFilter`, `ScanExpressionFilter`, `ScanFilter`, `ScanColumn`,
  `ScanSort`, `PreviewScanArgs`, `ScanResultRow`, `PreviewScanResult`
  (`total_items`, `results`, `sorted_by`, `filters_applied`), plus
  `ScanAppliedFilter`, `PreviewScanResponse`, `PREVIEW_SCAN_ROW_CAP`.
- `shared/scanner-contracts.ts`: `ScanRecipe`, `CurationProposalBuckets`,
  `CurationProposal` (recipeId/ranAt/universeSize/matchedCount/truncated/
  buckets/dropDetail).
- Pure helpers: `isExpressionFilter`/`isEnumFilter` narrowing,
  `chunkSymbols`, `isScanTruncated`, `serialize/parseCurationProposal`.
- `shared/scanner-contracts.spec.ts` per the TEST doc.
- `@st/scanner` alias registered in `tsconfig.json`,
  `functions/tsconfig.json`, `jest.config.js`.
- Live verify script `functions/scripts/verify/rh-scanner-contracts-1131.ts`.

Verified schema deviation (recorded in code review): `preview_scan` accepts
`filters` + `columns` only — no `sort`/`limit`. `ScanSort` is a
client-side recipe post-sort field; `sorted_by` is a display string.

## Prerequisites

- Repo checkout at `C:\aa\projects\rel-str`, Node 24, deps installed.
- `NODE_OPTIONS=--require C:\Users\bob\.config\node\ipv4-only.cjs`
  (inherited from user env; required for Firebase/MCP network calls).
- **Live verify only:** a valid Robinhood MCP session/credentials. If the
  script reports an auth failure, refresh the RH session the same way the
  `rh-agent-mcp` diagnostics runs do before re-running.
- No feature flags, seed data, or services are required.

## Scenarios

### S1 — Unit spec green

- **Confirms:** narrowing guards, `chunkSymbols` (incl. invalid size and
  the 925-symbols/150-chunk = 7 batches case), `isScanTruncated` (row cap,
  `total_items > results.length`, complete sets), captured
  `PreviewScanResult` shape with string columns, expression columns
  carrying `display_name` + `expression`, empty results, proposal
  serialize→parse round-trip, malformed-doc rejection, `dropDetail`
  validation.
- **Steps:** from repo root run `npx jest shared/scanner-contracts.spec.ts --coverage=false`
- **Expected:** 1 suite passed, 13/13 tests passed.
- **Result:** PASS — 13/13 (see execution log below).

### S2 — Root typecheck clean for scanner files

- **Confirms:** `shared/scanner-contracts.ts` and the appended types in
  `shared/robinhood-mcp-contracts.ts` compile under the FE/shared tsconfig;
  the `@st/scanner` alias resolves.
- **Steps:** `npx tsc --noEmit -p tsconfig.json`
- **Expected:** zero errors mentioning `scanner` or `robinhood-mcp`.
  (Other threads' files may report unrelated errors in a dirty tree —
  they are out of scope.)
- **Result:** PASS — zero scanner-related diagnostics.

### S3 — Functions typecheck clean

- **Confirms:** the shared contracts compile under the functions tsconfig
  and the alias resolves there too.
- **Steps:** `cd functions && npm run typecheck`
- **Expected:** `tsc --noEmit` exits clean.
- **Result:** PASS.

### S4 — Live `preview_scan` contract check (enum filter)

- **Confirms:** wire types match the real MCP response — `total_items`
  number ≥ `results.length`; every row has `ticker`, `instrument_id`,
  `instrument_type`; all `columns` values are strings; `filters_applied`
  echoes `filter_type_enum`; `isScanTruncated` agrees with row/total
  counts.
- **Steps:** `cd functions && npx tsx scripts/verify/rh-scanner-contracts-1131.ts`
- **Expected:** first four checks `OK`. Requires live RH session (see
  Prerequisites).
- **Result:** PASS — 4/4 enum-scan checks OK.

### S5 — Live `preview_scan` contract check (symbol-scoped / expression filter)

- **Confirms:** expression/`ANY_OF` scoped scans return exactly the scoped
  tickers with the same row contract.
- **Steps:** same script as S4 (it runs both scans).
- **Expected:** final three checks `OK`; summary `7 passed, 0 failed`.
- **Result:** PASS — 7/7 total.

### S6 — Negative: parser rejects malformed proposals

- **Confirms:** `parseCurationProposal` throws on missing required fields
  and on malformed optional `dropDetail` (nested shape validated).
- **Steps:** covered by spec cases in S1 (`parse rejects docs missing
  required fields`, dropDetail variants).
- **Expected:** rejection assertions pass.
- **Result:** PASS — within S1 evidence.

### S7 — Boundary: `chunkSymbols` rejects non-positive sizes

- **Confirms:** `chunkSymbols(symbols, 0)` / negative sizes throw instead
  of looping forever (review finding).
- **Steps:** covered by spec case in S1.
- **Expected:** rejection assertion passes.
- **Result:** PASS — within S1 evidence.

## Traceability

| Acceptance criterion | Scenario |
|---|---|
| preview_scan wire types present + correct | S2, S3, S4, S5 |
| ScanRecipe / CurationProposal(Buckets) types | S1, S2 |
| isExpressionFilter / isEnumFilter narrowing | S1 |
| chunkSymbols | S1, S7 |
| spec per TEST doc | S1 |
| @st/scanner alias in 3 configs | S2, S3 |
| live verify script exists and exercises real session | S4, S5 |
| proposal parse hardening (review) | S6 |

## Regression / smoke checklist

- [x] Broader shared-suite run during review: 42 suites pass; 1 failure in
      `shared/screenshot-capture-contracts.spec.ts` — unrelated
      (concurrent options/screenshot thread: `PositionType` now has 4
      members vs expected 1). Not a #1131 regression.
- [x] No changes to `st-collections.ts` / `firestore.rules` — correctly
      deferred to #1132.
- [x] No behavioral changes to existing modules — additive types +
      helpers only.

## Execution log

Run on 2026-10-19:

- `npx jest shared/scanner-contracts.spec.ts --coverage=false`
  → **13/13 PASS**
- `cd functions && npm run typecheck` → **clean**
- `npx tsc --noEmit -p tsconfig.json` → **zero scanner/robinhood-mcp
  diagnostics** (unrelated errors in other threads' files present, out
  of scope)
- `cd functions && npx tsx scripts/verify/rh-scanner-contracts-1131.ts`
  → **7/7 PASS** against the live RH MCP session

## Refinement pass

Not applicable — no user-facing surface. This task delivers shared type
contracts and pure helpers; all UI/UX lands under FE tasks #1136–#1141.
