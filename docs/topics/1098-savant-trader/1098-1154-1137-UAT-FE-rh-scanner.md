# UAT — #1137 scanner recipe catalog

**Topic:** RH Scanner  
**Topic Slug:** rh-scanner  
**Thread:** RH Scanner Page  
**Thread Slug:** rh-scanner-page  
**Issue:** #1154  
**Thread Parent:** #1099  
**Topic Parent:** #1098  
**Task:** #1137  
**Domain:** FE  
**Type:** UAT  
**Status:** Complete  
**Created:** 2026-10-20  
**Last Updated:** 2026-10-20  

## Scope

Task [#1137](https://github.com/rinebob/rel-str/issues/1137) — the
`preview_scan` recipe catalog: 12 field-guide-verified recipes +
`ScannerRecipe` FE metadata (`supportsPrune`, `noDataPred`,
`columnLookup`) + catalog-invariant spec. No store, no page, no live
proposal writes.

## Acceptance criteria (task body)

1. quality-mega/large/mid — ROE≥0.15 ∧ NPM≥0.10 ∧ EPS>0 ∧ PEG≤2 + mcap
   bounds, all expression filters (never enum PERCENTAGE).
2. high-52w, near-52w-high, low-52w, near-52w-low.
3. ivr-high (≥0.8) / ivr-low (≤0.2) scoped mcap≥2B; vol-spike;
   gainers/losers.
4. Per-recipe columns + sort + columnLookup; supportsPrune on quality.
5. Catalog spec: unique ids, filters typecheck, fraction-threshold
   regression guard.

## Refinement

Not applicable — no user-facing surface.

## Prerequisites

- Repo root `C:\aa\projects\rel-str`, node_modules installed.
- Scenario 3 needs the local RH MCP session (DPAPI credentials) +
  IPv4 shim (`NODE_OPTIONS=--require C:\Users\bob\.config\node\ipv4-only.cjs`).

## Scenarios

### 1. Catalog spec — invariants + regression guards

```powershell
npx jest src/app/features/savant-trader/scanner/scanner-recipes.spec.ts --coverage=false
```

Expected: 12/12 — unique kebab ids, ScanFilter-variant validation,
fraction-threshold guard (forbidden percent enums), ROE/NPM/IVR
fraction thresholds pinned, quality screen completeness + non-
overlapping mcap bounds, supportsPrune⇒noDataPred, sort-column and
columnLookup resolution, wire-legal keys only.

### 2. Typecheck — catalog compiles clean

```powershell
npx tsc --noEmit -p tsconfig.json 2>&1 | Select-String 'scanner-recipes'
```

Expected: no diagnostics on the two new files.

### 3. Live probe — requested columns resolve on the real backend

```powershell
cd functions
$env:NODE_OPTIONS="--require C:\Users\bob\.config\node\ipv4-only.cjs"
npx tsx src/rh-agent-mcp/diagnostics/run-tool-observation.ts preview_scan ../.devin/tmp/scan-cols-probe.json
```

Probe args: `symbol ANY_OF` scope (10 tickers) + the 7 non-standard
expression columns ('52w high', '52w low', 'Range pos', 'IV rank',
'IV 52w high', 'IV 52w low', 'Vol × 30d avg').

Expected: `success`; row `columns` maps carry every requested
`display_name` as its key with populated values — no canonicalization
to a different name (the F1 review gap, closed live).

### 4. No cross-domain drift — task diff footprint

```powershell
git status --short -- src/app/features/savant-trader/scanner/
```

Expected: only `scanner-recipes.ts` + `scanner-recipes.spec.ts`. No
store, page, route, or client changes.

## Traceability

| Task AC | Scenario |
|---|---|
| AC1 — quality recipes expression-filtered | 1 (bounds + forbidden-enum + threshold pins), 2 |
| AC2 — 52w recipe set | 1, 3 (column keys live-verified) |
| AC3 — ivr/vol-spike/gainers-losers | 1, 3 |
| AC4 — columns + sort + columnLookup + supportsPrune | 1, 3 |
| AC5 — catalog spec guards | 1 |

## Results log

Executed 2026-10-20 — all scenarios PASS (fresh evidence):

1. `npx jest scanner-recipes.spec.ts --coverage=false` → **12/12**
   (9.3s) — ids/kebab, filter-variant validation, forbidden-enum guard,
   ROE `0.15`/NPM `0.10`/IVR `0.8` fraction pins, quality screen +
   non-overlapping mcap bounds, supportsPrune⇒noDataPred, sort-column +
   columnLookup resolution, wire-legal keys only.
2. `npx tsc --noEmit` → **zero diagnostics** on `scanner-recipes{,.spec}.ts`.
3. Live `preview_scan` probe (10-ticker ANY_OF scope, all 7 non-
   standard expression columns) → `success`, 10/10 rows; row columns
   keyed exactly `52w high`, `52w low`, `Range pos`, `IV rank`,
   `IV 52w high`, `IV 52w low`, `Vol × 30d avg` — **zero missing**,
   no canonicalization. F1 review gap closed against the real backend.
4. Task diff footprint: `src/app/features/savant-trader/scanner/` new
   dir only — `scanner-recipes.ts` + `scanner-recipes.spec.ts`. No
   store/page/route/client changes.

**Verdict: PASS — QA issue #1154 eligible for closure.**
