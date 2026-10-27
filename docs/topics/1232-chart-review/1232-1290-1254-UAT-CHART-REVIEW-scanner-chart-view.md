**Topic:** Scanner Chart View  
**Topic Slug:** scanner-chart-view  
**Thread:** Chart View Extension  
**Thread Slug:** chart-view-extension  
**Issue:** #1290  
**Thread Parent:** #1233  
**Topic Parent:** #1232  
**Task:** #1254  
**Domain:** CHART-REVIEW  
**Type:** UAT  
**Status:** Complete  
**Created:** 2026-10-26  
**Last Updated:** 2026-10-26  

# UAT — #1254 ScanLatestRun contract + collection paths + rules anchor

## Scope

SHARED contract landing before its consumers — no Angular or functions code
uses it yet (#1257 writes, #1258 reads). The acceptance surface is therefore
executable: specs, the rules content-test, and the real-alias verify script.
There is no user-facing UI.

Delivered by this task:

- `ScanLatestRun` + `serializeScanLatestRun`/`parseScanLatestRun`
  (`shared/scanner-contracts.ts`)
- `latest-runs` anchor + `stScannerLatestRunsPath()` /
  `stScannerLatestRunDocPath(recipeId)` + `StScannerKind` widening
  (`shared/st-collections.ts`)
- `firestore.rules` st-scanner write allowlist → `latest-runs` (authed CRUD)
- Specs + `tests/functions` rules assertion
- `scripts/verify/scanner-chart-view-latest-run-1254.ts` + `.md` guide +
  README/run-all registration

## Prerequisites

- Repo: `rel-str`, current work branch
- `npm install` already run (tsx + jest available)
- No Firestore access, credentials, or dev server needed — all checks are
  credential-free

## Test scenarios

### S1 — Contract round-trip + drift suite

- **Feature:** serialize/parse fidelity and shape-drift rejection
- **Steps:** `npx jest shared/scanner-contracts.spec.ts --coverage=false`
- **Expected:** all tests pass, including ScanLatestRun describes —
  round-trip, `toStrictEqual` no-undefined-leaves, 200-row truncated run,
  empty rows, forward-compat extras, scalar drift (recipeId/totalItems/
  truncated/ranAt), malformed rows (not-array/no-ticker/bad-columns),
  instrument_* passthrough pin
- **Result:** ☑ PASS — 21 tests green (2026-10-26)

### S2 — Path-helper parity suite

- **Feature:** collection/doc path shapes for AngularFire
- **Steps:** `npx jest shared/st-collections.spec.ts --coverage=false`
- **Expected:** all pass; the latest-runs its assert
  `st-scanner/latest-runs/items` (odd segments) and
  `.../items/quality-large` (even segments)
- **Result:** ☑ PASS — included in 46-test combined green run (2026-10-26)

### S3 — Rules allowlist assertion

- **Feature:** `latest-runs` authed-CRUD grant
- **Steps:** `npx tsx --test tests/functions/firestore-rules-indexes-1012.test.ts`
- **Expected:** all pass; the st-scanner `it` pins the verbatim line
  `allow create, update, delete: if anchor in ['proposals', 'latest-runs'] && request.auth != null;`
- **Result:** ☑ PASS — 14 tests green (2026-10-26)

### S4 — Real-alias verify script

- **Feature:** `@st/scanner` + `@st/collections` alias resolution under tsx
  for the exact modules #1257/#1258 will import
- **Steps:** `npx tsx scripts/verify/scanner-chart-view-latest-run-1254.ts`
- **Expected:** 13 `OK` lines + `=== ALL CHECKS PASSED ===`, exit 0
- **Result:** ☑ PASS — 13 checks green (2026-10-26)

### S5 — Typecheck

- **Feature:** contract compiles under both consuming tsconfigs
- **Steps:** `npx tsc --noEmit -p tsconfig.app.json` and `cd functions && npx tsc --noEmit`
- **Expected:** clean (pre-existing unrelated-workstream errors aside)
- **Result:** ☑ PASS — both clean (2026-10-26)

## Automated verification summary

| Check | Command | Result |
|---|---|---|
| Contract spec | `npx jest shared/scanner-contracts.spec.ts` | ✅ 21 tests |
| Collections spec | `npx jest shared/st-collections.spec.ts` | ✅ (46 combined) |
| Rules test | `npx tsx --test tests/functions/firestore-rules-indexes-1012.test.ts` | ✅ 14 tests |
| Verify script | `npx tsx scripts/verify/scanner-chart-view-latest-run-1254.ts` | ✅ 13 checks |
| Typecheck | `tsc --noEmit` (app + functions) | ✅ clean |
| Full suite | `npx jest --coverage=false` | ✅ 269 suites / 4,637 tests |

## Traceability

| Task AC | Scenario(s) |
|---|---|
| ScanLatestRun interface (5 fields) | S1, S4 |
| serialize/parse round-trip + drift | S1, S4 |
| StScannerKind + anchor + path helpers | S2, S4 |
| rules allowlist → latest-runs | S3, S4 |
| Unit tests per test plan | S1–S3 |

## Regression / smoke checklist

- [x] No Angular/BE code consumes the contract yet (verified by grep — correctly staged for #1257/#1258)
- [x] `firestore.rules` has no syntax drift beyond the allowlist line (rules test green)
- [x] `st-collections.ts` / `firestore.rules` carry the other workstream's #1238 hunks — verified #1254 hunks are additive and independent
- [x] No new composite index needed (unfiltered getDocs reads)

## Refinement pass

Not applicable — no user-facing surface (SHARED contract task).
