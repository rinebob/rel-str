# UAT — #1136 previewScan spec + row-model parser

**Topic:** RH Scanner  
**Topic Slug:** rh-scanner  
**Thread:** RH Scanner Page  
**Thread Slug:** rh-scanner-page  
**Issue:** #1149  
**Thread Parent:** #1099  
**Topic Parent:** #1098  
**Task:** #1136  
**Domain:** FE  
**Type:** UAT  
**Status:** Complete  
**Created:** 2026-10-20  
**Last Updated:** 2026-10-20  

## Scope

Task [#1136](https://github.com/rinebob/rel-str/issues/1136) — the FE
scanner data layer: `previewScan`/`evaluateUniverse` on
`RobinhoodMcpClient` plus the `scanner-rows` parsing utility. No UI, no
recipe catalog, no page wiring — those are #1137–#1141.

## Acceptance criteria (task body)

1. `previewScanSpec(recipe)` / `previewScan(recipe)` — parse
   `data.result` → `{totalItems, rows}`.
2. `evaluateUniverseSpec` + `evaluateUniverse` — symbol `ANY_OF` chunks
   (≤150) via `executeBatch`; per-chunk rejection isolation; dedupe by
   ticker.
3. `utils/scanner-rows.util.ts` — `parseScanRows`, `numericColumn`,
   `percentColumn`, `canonicalColumnName`/column-lookup resolution.
4. Specs: real capture fixture parse (`dep-prev-scan-*.json` row shape),
   coercions, batch chunking.

## Refinement

Not applicable — no user-facing surface.

## Prerequisites

- Repo root `C:\aa\projects\rel-str`, node_modules installed.
- No live services needed — the MCP boundary is mocked in specs; the
  wire shape is pinned by the captured fixture
  `functions/scripts/verify/fixtures/dep-prev-scan-01.json`.

## Scenarios

### 1. Focused suites — parser + client scanner specs

```powershell
npx jest src/app/features/savant-trader/utils/scanner-rows.util.spec.ts src/app/core/robinhood-mcp/robinhood-mcp-client.service.spec.ts
```

Expected: both suites green. Coverage includes the AC4 matrix — real
capture-fixture row parse, numeric/percent coercion (blank/whitespace/
invalid/non-finite → `null`, `0.149` → `14.9`), missing-ticker drop,
canonical column lookup + `display_title` counterexample, scope
replacement with `ANY_OF`, 150-chunking, >20-chunk batch grouping,
per-chunk rejection → `unevaluated`, transport-failure propagation,
input sanitization, cross-chunk dedupe, missing/`drifted` `data.result`
→ `RobinhoodMcpError`, `filtersApplied`/`sortedBy` surfacing.

### 2. Typecheck — new types compile clean

```powershell
npx tsc --noEmit -p tsconfig.json 2>&1 | Select-String 'scanner-rows|robinhood-mcp-client'
```

Expected: no diagnostics on the touched scanner files. (Repo-wide
pre-existing drift from other sessions may appear elsewhere — out of
scope.)

### 3. Wire-shape fidelity — fixture fields reach `ScanRow`

Read `dep-prev-scan-01.json` (`response.data.result.results[0]`) beside
`scanner-rows.util.spec.ts`'s capture-parse spec.

Expected: the spec's fixture block is verbatim wire shape — `ticker`,
`instrument_type`, `columns` keyed by display name with stringified
values — and `parseScanRows` maps them to
`{symbol, name, instrumentType, values, tracked}`.

### 4. No cross-domain drift — task diff footprint

```powershell
git status --short -- src/app/core/robinhood-mcp src/app/features/savant-trader/utils
```

Expected: modified/new files limited to
`robinhood-mcp-client.service{,.spec}.ts` and
`utils/scanner-rows.util{,.spec}.ts`. No recipe catalog, store, page, or
firestore changes from this task.

## Traceability

| Task AC | Scenario |
|---|---|
| AC1 — previewScan parse → `{totalItems, rows}` | 1, 3 |
| AC2 — evaluateUniverse chunking/isolation/dedupe | 1 |
| AC3 — scanner-rows util surface | 1, 3 |
| AC4 — fixture parse, coercions, chunking specs | 1, 3 |
| review-remediated hardening (data.result gate, metadata surfacing, drift guards) | 1, 2 |

## Results log

Executed 2026-10-20 — all scenarios PASS (fresh evidence):

1. `npx jest` both suites (`--coverage=false`) → **101/101 passed**
   (9.1s). Full AC4 matrix green: capture-fixture parse, numeric/percent
   coercion incl. whitespace→null, missing-ticker drop, canonical lookup
   + `display_title` counterexample, `ANY_OF` scope replacement,
   150-chunking, >20-chunk grouping, per-chunk rejection → `unevaluated`,
   transport propagation, input sanitization, cross-chunk dedupe,
   `data.result` gate (missing container AND drifted elements →
   `RobinhoodMcpError`), `filtersApplied`/`sortedBy` surfacing.
2. `npx tsc --noEmit` → **zero diagnostics** on
   `scanner-rows.util{,.spec}.ts` / `robinhood-mcp-client.service{,.spec}.ts`.
3. Fixture fidelity confirmed — `CAPTURE` rows in the util spec are
   verbatim `dep-prev-scan-01.json` (`docs/topics/657-rh-mcp/captures/`,
   response at `response.data.result`): BRK.A/NVR rows, stringified
   column values keyed by display name. Maps to
   `{symbol, name, instrumentType, values, tracked}`.
4. Task diff footprint scoped: `robinhood-mcp-client.service{,.spec}.ts`
   modified; `utils/scanner-rows.util{,.spec}.ts` new. No recipe, store,
   page, or rules changes. (Adjacent `analysis-stats.util.*` untracked
   files belong to another session — out of scope.)

**Verdict: PASS — QA issue #1149 eligible for closure.**
