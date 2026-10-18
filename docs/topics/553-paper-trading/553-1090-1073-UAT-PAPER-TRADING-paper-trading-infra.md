**Topic:** Paper Trading Infra  
**Topic Slug:** paper-trading-infra  
**Thread:** Trade Analysis & Forensics  
**Thread Slug:** trade-analysis  
**Issue:** #1090  
**Thread Parent:** #1059  
**Topic Parent:** #553  
**Task:** #1073  
**Domain:** PAPER-TRADING  
**Type:** UAT  
**Status:** Complete — QA PASS  
**Created:** 2026-10-20  
**Last Updated:** 2026-10-20  

# UAT — #1073 trade-analysis contracts (row schema + manifest + index/slice types + paths)

## Scope

Task #1073 acceptance criteria (issue body + SHARED IMPL §1–2):

1. `ANALYSIS_COLUMNS` is the single ordered source of truth for CSV
   header order and FE table/filter dispatch.
2. Manifest ⇄ row-schema bijection spec passes (no orphan key either
   direction).
3. Path helpers return `paper-trading/analysis-datasets/items` and
   `paper-trading/analysis-slices/items`.
4. Percent-units + ISO-date conventions documented on the types.
5. `AnalysisDatasetDoc` / `AnalysisSlice` / `SliceFilter` /
   `AnalysisCohort` contracts exist and round-trip through real
   Firestore under the anchor pattern.
6. `firestore.rules` permits FE CRUD on `analysis-slices` and keeps
   `analysis-datasets` server-write-only.

## Prerequisites

- Node + repo deps installed (`npm install`, `cd functions && npm install`).
- ADC credentials for the Firestore round-trip: `gcloud auth
  application-default login` or `GOOGLE_APPLICATION_CREDENTIALS`
  (project `rel-str`).
- IPv4 preload: `NODE_OPTIONS=--require
  C:\Users\bob\.config\node\ipv4-only.cjs`.

## Start instructions

```powershell
# unit evidence
npx jest shared/analysis-dataset-contracts.spec.ts --coverage=false

# real-Firestore evidence
cd functions
npx tsx scripts/verify/paper-trading-analysis-1073-contracts.ts
```

## Scenarios

| # | Scenario | Steps | Expected | Result |
|---|----------|-------|----------|--------|
| 1 | Manifest is single source of truth | Inspect `ANALYSIS_COLUMNS` in `shared/analysis-dataset-contracts.ts` — every def carries key/label/kind/filterable/defaultVisible; enum defs carry enumValues | 46 ordered columns; enum kind ⇔ enumValues presence enforced | **PASS** — spec `enum columns declare enumValues; non-enum columns do not` + `every column has a label and consistent flags` green |
| 2 | Manifest ⇄ schema bijection | Run the jest spec | `manifest ⇄ row-schema bijection` and `sparse rows still carry every manifest key` pass — no orphan key either direction | **PASS** — both specs green; FULL_ROW + all-null SPARSE_ROW pin the key set |
| 3 | Anchor paths | Run the jest spec or verify script | `analysisDatasetsPath()` = `paper-trading/analysis-datasets/items`; `analysisSlicesPath()` = `paper-trading/analysis-slices/items`; doc paths even-segment; `analysisDatasetGcsPath(id)` = `analysis-datasets/{id}.csv` | **PASS** — 4 path specs + 3 verify checks green |
| 4 | Unit conventions documented | Read module header + field comments | Percent fields documented as percent-units; dates as ISO `YYYY-MM-DD`; timestamps full ISO | **PASS** — header block + per-field comments (`tradeRetPct`, `signalBarDate`, `generatedAt`, …) |
| 5 | Dataset + slice docs round-trip on prod | Run `paper-trading-analysis-1073-contracts.ts` | Probe `AnalysisDatasetDoc` (generating status, barRange, tags, gcsPath) and `AnalysisSlice` (all three SliceFilter ops) write→read→delete cleanly; probes removed | **PASS** — 16/16 checks, `verify-1073-*` docs deleted and re-queried absent |
| 6 | Repository-pattern guards | Run the jest spec | `isAnalysisDatasetDoc`/`isAnalysisSliceDoc` narrow on kind, reject sibling kinds | **PASS** — 2 specs pin positive + 2 negative cases each |
| 7 | Rules change | `firebase deploy --only firestore:rules`; inspect `firestore.rules` `paper-trading/{anchor}/items/{docId}` block | `analysis-slices` allows authed create/update/delete; `analysis-datasets` stays read-only for clients | **PASS** — deployed by user 2026-10-20 ("rules compiled successfully"); read/write asymmetry as designed |
| 8 | Regression — st- path contract | `npx jest shared/st-collections.spec.ts shared/paper-trading-ids.spec.ts shared/paper-trading-contracts.spec.ts` | All green; `StPaperTradingKind` unaffected (analysis kinds throw on st- anchors — deliberate, legacy root per AC) | **PASS** — 80/80 |
| 9 | Regression — typecheck/build | `npx tsc --noEmit -p functions/tsconfig.json`; `npm run build` (functions) | Clean | **PASS** |

## Automated evidence

- `shared/analysis-dataset-contracts.spec.ts`: **12/12** (paths,
  bijection both directions, sparse-key completeness, enum hygiene,
  kind guards).
- `functions/scripts/verify/paper-trading-analysis-1073-contracts.ts`:
  **16/16** on real prod Firestore; guide at
  `functions/scripts/verify/paper-trading-analysis-1073.md`.
- Full suite at review time: 3807 pass / 44 fail — all failures
  pre-existing and unrelated (#1004 PositionType, order.component
  NG0201, #1041 sidenav).

## Traceability

| Acceptance criterion | Scenario(s) |
|---|---|
| Manifest single source of truth | 1, 2 |
| Bijection spec | 2 |
| Anchor paths | 3, 5 |
| Unit/date conventions documented | 4 |
| Index + slice contracts on real store | 5, 6 |
| Rules permit FE slice CRUD, datasets server-only | 7 |
| Regression | 8, 9 |

## Refinement pass

Not applicable — no user-facing surface (SHARED contracts task). The
FE consumers of these contracts arrive in #1081–#1085.
