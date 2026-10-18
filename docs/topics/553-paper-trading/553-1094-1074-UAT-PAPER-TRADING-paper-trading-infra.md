**Topic:** Paper Trading Infra  
**Topic Slug:** paper-trading-infra  
**Thread:** Trade Analysis & Forensics  
**Thread Slug:** trade-analysis  
**Issue:** #1094  
**Thread Parent:** #1059  
**Topic Parent:** #553  
**Task:** #1074  
**Domain:** PAPER-TRADING  
**Type:** UAT  
**Status:** Complete — QA PASS  
**Created:** 2026-10-20  
**Last Updated:** 2026-10-20  

# UAT — #1074 trade-analysis CSV codec (serializeDataset + COLUMN_TYPES + golden fixture)

## Scope

Task #1074 acceptance criteria (issue body + SHARED IMPL §3):

1. `serializeDataset(rows, columns?)` emits the manifest column order
   as the CSV header.
2. Rows sort by `tradeId` with a codepoint comparison — same row set
   in different input order produces byte-identical CSV.
3. Duplicate `tradeId` rows keep input order (stable sort).
4. Empty row set emits the bare header + trailing LF.
5. RFC-4180 quoting for cells containing comma, double-quote, LF, CR;
   embedded quotes doubled.
6. Absent values (`null`/`undefined`) and non-finite numbers
   (`NaN`/`Infinity`/-`Infinity`) emit empty cells — never literal
   `"undefined"`/`"null"`/`"NaN"`.
7. Lossless numeric repr via shortest-round-trip `String(v)` —
   preserves 3–4-decimal fill prices and sub-cent realized P&L
   (deviation from the prototype's `toFixed(2)`, recorded as as-built
   in IMPL §3).
8. `COLUMN_TYPES` maps every manifest key to its declared kind for the
   future FE PapaParse consumer.
9. `AnalysisSlice` JSON round-trip + all three `SliceFilter` ops
   covered at unit level.
10. Real-Firestore verify relay green and read-only.
11. `@paper-trading/analysis-csv` alias registered in all three
    tsconfig/jest configs; relay indexed in README + run-all.

## Prerequisites

- Node + repo deps installed (`npm install`, `cd functions && npm install`).
- ADC credentials for the Firestore relay: `gcloud auth
  application-default login` or `GOOGLE_APPLICATION_CREDENTIALS`
  (project `rel-str`). The relay is read-only.
- IPv4 preload: `NODE_OPTIONS=--require
  C:\Users\bob\.config\node\ipv4-only.cjs`.

## Start instructions

```powershell
# unit evidence
npx jest shared/analysis-csv.spec.ts shared/analysis-dataset-contracts.spec.ts --coverage=false

# real-Firestore evidence
cd functions
npx tsx scripts/verify/paper-trading-analysis-1074-csv-codec.ts
```

## Scenarios

| # | Scenario | Steps | Expected | Result |
|---|----------|-------|----------|--------|
| 1 | Manifest-order header | Run codec spec | `csv[0]` equals the literal 46-key manifest header; column subset narrows header + cells together | **PASS** — both specs green |
| 2 | Byte-identical determinism | Run codec spec | 4 shuffles of the same row set produce identical bytes; codepoint sort (no localeCompare) | **PASS** — `sorts rows by tradeId — byte-identical output on shuffled input` green |
| 3 | Stable duplicate-key order | Run codec spec | Two rows sharing a `tradeId` keep input order after sort | **PASS** — `duplicate tradeIds keep input order — the sort is stable` green |
| 4 | Empty row set | Run codec spec | `serializeDataset([])` = header + `\n`, nothing else | **PASS** — `an empty row set emits the bare header + newline` green |
| 5 | RFC-4180 quoting | Run codec spec | Cells with `,` `"` `\n` `\r` are quoted; embedded `"` doubled | **PASS** — quoting + round-trip specs green |
| 6 | Empty-cell contract | Run codec spec | `null`, `undefined` (via `Partial`+delete), `NaN`, `±Infinity` all emit empty cells; no literal-marker cells | **PASS** — `null and undefined serialize to empty cells` + `non-finite numbers serialize to empty cells` green |
| 7 | Lossless numeric repr | Run codec spec + inspect golden | `112.465` stays `112.465` (not `112.47`); zero/negative percents literal; golden fixture byte-pinned | **PASS** — precision, sign, and golden specs green; IMPL §3 as-built recorded |
| 8 | `COLUMN_TYPES` parity | Run codec spec | Every manifest key carries its declared kind — no missing/extra entries | **PASS** — `covers every manifest key with its declared kind` green |
| 9 | Slice contract unit coverage | Run contracts spec | `AnalysisSlice` JSON round-trip deep-equals; `in`/`range`/`dateRange` each discriminate on a real manifest column | **PASS** — 2 added specs green |
| 10 | Real-data relay | Run `paper-trading-analysis-1074-csv-codec.ts` | 7/7: live trades fetched, stamped `ind.*` rows sampled, header/order/determinism/no-literal/deep-equal round-trip | **PASS** — 7/7 on prod: 247 signal trades, 25/25 stamped rows, 25-row deep-equal round-trip |
| 11 | Alias + index registration | Inspect `tsconfig.json`, `functions/tsconfig.json`, `jest.config.js`, `run-all.ts`, README | `@paper-trading/analysis-csv` resolves in all three; relay listed + guided | **PASS** — alias in 3 configs; `run-all.ts` + README + per-task guide updated |
| 12 | Regression — shared suites + typecheck | `npx jest` on the 4 shared specs; `npx tsc --noEmit -p functions/tsconfig.json` | All green | **PASS** — 89/89 across csv/contracts/ids/contracts suites; tsc clean |

## Automated evidence

- `shared/analysis-csv.spec.ts`: **13/13** (header, determinism,
  stable dup sort, empty set, RFC-4180, empty-cell contract incl.
  `undefined`, lossless repr, golden, `COLUMN_TYPES`).
- `shared/analysis-dataset-contracts.spec.ts`: **14/14** incl. slice
  round-trip + SliceFilter op coverage added in this task.
- `functions/scripts/verify/paper-trading-analysis-1074-csv-codec.ts`:
  **7/7** on real prod Firestore; guide at
  `functions/scripts/verify/paper-trading-analysis-1074.md`.
- Focused regression: 89/89 across the four shared suites; functions
  `tsc --noEmit` clean.
- Full suite at review time: 3822 pass / 44 fail — all failures
  pre-existing and unrelated (#1004 PositionType growth, order.component
  NG0201 provider, #1041 sidenav item).

## Traceability

| Acceptance criterion | Scenario(s) |
|---|---|
| Manifest-order header | 1, 10 |
| Byte-identical on shuffle (codepoint sort) | 2, 10 |
| Stable duplicate-key order | 3 |
| Empty row set | 4 |
| RFC-4180 quoting | 5, 10 |
| Absent/non-finite → empty cells | 6, 10 |
| Lossless numeric repr | 7, 10 |
| `COLUMN_TYPES` parity | 8, 10 |
| Slice serialization + filter ops | 9 |
| Real-data relay read-only | 10 |
| Alias + verification index | 11 |
| Regression | 12 |

## Refinement pass

Not applicable — no user-facing surface (SHARED codec task). The FE
consumers of this codec arrive in #1081–#1085.
