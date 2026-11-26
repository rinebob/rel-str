**Topic:** SA IV Data  
**Topic Slug:** sa-iv-data  
**Thread:** IV Metrics Consumer  
**Thread Slug:** iv-metrics-consumer  
**Issue:** #1755  
**Thread Parent:** #1738  
**Topic Parent:** #1737  
**Task:** #1747  
**Domain:** IMP-VOL  
**Type:** UAT  
**Status:** Complete  
**Created:** 2026-11-26  
**Last Updated:** 2026-11-26  

# UAT — SHARED-IMPL: @iv-metrics/contracts types + alias registration (#1747)

## Scope

Shared TypeScript contracts for the SA IV endpoints so the backend proxy
callers (#1748), callable wrappers (#1749), and future FE consumers all
share one source of truth: `shared/iv-metrics-contracts.ts` (request/row/
response types for `partnerIvMetricsV2` + `partnerIvRankV2`,
`IV_RANK_WINDOWS` const, `GetIvMetricsRequest`/`GetIvRankRequest` aliases),
its companion spec, and the `@iv-metrics/contracts` alias registered in
all three resolution layers.

Task acceptance criteria:
1. `shared/iv-metrics-contracts.ts` exports typed request params, response
   rows, and response envelopes for both endpoints.
2. `ivN` fields and rank/pct fields typed to preserve absent-key semantics
   (optional, not defaulted; `ivN{W}` required on `IvRankRow`).
3. `@iv-metrics/contracts` registered in root `tsconfig.json` paths,
   `functions/tsconfig.json` paths, and `jest.config.js` `moduleNameMapper`.
4. Companion spec validates contract shapes (absent-key/optional-field
   behavior pinned).
5. `npx tsc --noEmit` clean at root and in `functions/`; jest suite green.

## Prerequisites

- Repo root `C:\aa\projects\rel-str`, branch `prod`, Node toolchain
  installed (jest 30 + jest-preset-angular already configured).
- No credentials, services, dev server, or browser needed — all scenarios
  are command-line compile/test checks.
- Working tree may contain other sessions' uncommitted work; root `tsc`
  errors in `portfolio-dashboard.store.spec.ts` are pre-existing foreign
  noise, not this task's.

## Getting to the feature

No route or UI surface — the "feature" is a shared types module. Exercise
it from the repo root with the commands in each scenario.

## Automated evidence (executed this session)

- `npx jest shared/iv-metrics-contracts.spec.ts --coverage=false` — 22/22 green.
- `cd functions && npx tsc --noEmit` — clean.
- `npx tsc --noEmit` (root) — 15 errors, all in
  `portfolio-dashboard.store.spec.ts` (foreign-session work); none touch
  `iv-metrics` or the three alias registrations.
- `npx jest --coverage=false` — 343/343 suites, 21,912 tests green.

## Scenarios

### S1 — Contract shapes + jest alias resolution
- **Confirms:** AC1, AC2, AC4, and the `jest.config.js` leg of AC3 (the
  spec imports via `@iv-metrics/contracts`, so a green run proves the
  `moduleNameMapper` registration).
- **Steps:** from repo root run
  `npx jest shared/iv-metrics-contracts.spec.ts --coverage=false`.
- **Expected:** all 22 tests pass, including `@ts-expect-error` pins for
  absent-key semantics (missing `date` on `IvMetricsRow`, missing `ivN{W}`
  on `IvRankRow`, `date` rejected as an `IvMetricField`) and the
  `IV_RANK_WINDOWS` contents pin.
- **Result:** ☒ PASS ☐ FAIL ☐ BLOCKED ☐ SKIPPED — 22/22 green, 2026-11-26.

### S2 — Root tsconfig alias leg
- **Confirms:** AC3 (root `tsconfig.json` paths registration).
- **Steps:** `grep -n "iv-metrics" tsconfig.json` shows the paths entry;
  `npx tsc --noEmit` at root.
- **Expected:** `"@iv-metrics/contracts": ["./shared/iv-metrics-contracts.ts"]`
  present; no tsc errors referencing `iv-metrics`, `tsconfig`, or
  `jest.config`.
- **Result:** ☒ PASS ☐ FAIL ☐ BLOCKED ☐ SKIPPED — entry at `tsconfig.json:37`;
  root tsc errors are all pre-existing `portfolio-dashboard.store.spec.ts`
  implicit-any issues (foreign session), 2026-11-26.

### S3 — functions/ tsconfig alias leg (real consumer check)
- **Confirms:** AC3 (`functions/tsconfig.json` paths registration) — the
  backend compile actually resolves the alias, which plain `tsc --noEmit`
  cannot prove while nothing imports the module.
- **Steps:**
  1. Create `functions/src/tmp-iv-metrics-alias-check.ts` containing
     `import type { IvMetricsRow, IvRankRow } from '@iv-metrics/contracts';
      export const check: [IvMetricsRow['date'], IvRankRow['ivN30']] =
      ['x', 0];`
  2. `cd functions && npx tsc --noEmit`
  3. Delete the temp file; re-run `npx tsc --noEmit`.
- **Expected:** step 2 compiles clean (alias resolves to
  `../shared/iv-metrics-contracts.ts`); step 3 clean.
- **Result:** ☒ PASS ☐ FAIL ☐ BLOCKED ☐ SKIPPED — consumer file compiled
  clean, 2026-11-26.

### S4 — Full-suite regression
- **Confirms:** AC5 (jest suite green) and no collateral breakage.
- **Steps:** `npx jest --coverage=false`.
- **Expected:** all suites pass.
- **Result:** ☒ PASS ☐ FAIL ☐ BLOCKED ☐ SKIPPED — 343/343 suites,
  21,912 tests green, 2026-11-26.

## Manual UI/UX refinement pass

- Not applicable — pure types module, no user-facing surface.
- **Result:** ☒ N/A

## Findings

None. (Review-round finding carried forward as a note for the BE thread:
`IvRankResponse.sort/dir/minN` echo optionality — the #1750 `--live`
verify leg will confirm whether SA always echoes effective params.)

## Traceability

| Acceptance criterion | Scenario |
|---|---|
| AC1 — typed request/rows/envelopes for both endpoints | S1 |
| AC2 — absent-key optionality (`ivN`/rank/pct) | S1 |
| AC3 — alias registered in all three configs | S1 (jest), S2 (root), S3 (functions) |
| AC4 — companion spec pins contract shapes | S1 |
| AC5 — tsc clean + jest green | S2, S3, S4 |

## Regression / smoke

- [x] `npx jest --coverage=false` — 343/343 green (S4)
- [x] `cd functions && npx tsc --noEmit` — clean (S3)

## Verdict

PASS — all scenarios green; no user-facing surface; no open findings.

## Results log

- 2026-11-26 — S1–S4 executed and passed; refinement pass N/A; verdict PASS.
