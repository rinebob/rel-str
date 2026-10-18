# CODE REVIEW — #1074 Trade Analysis CSV Codec  
**Date:** 2026-05-09  
**Reviewer:** Devin  
**Task:** #1074  
**Blueprint:** #1072  
**Topic:** #553  
**Verdict:** PASS  

## Review scope  
- `shared/analysis-csv.ts` (new — `serializeDataset`, `COLUMN_TYPES`, `AnalysisColumn`)  
- `shared/analysis-csv.spec.ts` (new — 13 specs)  
- `functions/scripts/verify/paper-trading-analysis-1074-csv-codec.ts` (new — 7-check real-Firestore relay)  
- `shared/analysis-dataset-contracts.spec.ts` (updated — +2 specs: slice round-trip, SliceFilter ops)  
- `tsconfig.json`, `functions/tsconfig.json`, `jest.config.js` (`@paper-trading/analysis-csv` alias)  
- `functions/scripts/verify/{README.md,run-all.ts,paper-trading-analysis-1074.md}` (index + guide)  
- IMPL §3 as-built note (lossless repr)  

## Standards  
- File is 68 lines, single-purpose, zero deps — no SDK calls to validate against; pure I/O seam.  
- No duplication/dead code; `COLUMN_TYPES` derives from the manifest, no parallel key list.  
- Spec follows repo conventions; uses `Partial<TradeAnalysisRow>` + delete for the absent-key path rather than a cast that papers over the runtime shape.  
- Numeric formatting deliberately shortest-round-trip — deviation from the prototype's `toFixed(2)` documented in IMPL §3 (real prod fills carry 3–4 decimals; padding is view-layer).  

## Spec  
| AC | Result |  
|---|---|  
| Manifest-order header | PASS — `csv[0] === 'tradeId,signalId,...'` literal 46-key assert |  
| Byte-identical on shuffle | PASS — 4 shuffles + round-trip; codepoint sort (no localeCompare) |  
| RFC-4180 quoting / delimiters | PASS — commas, quotes, LF, CR; `""` doubling |  
| Absent → empty cell | PASS — `null`, `undefined` (via `Partial`+delete), `NaN`, ±`Infinity`; `"undefined"` literal gated |  
| Manifest⇄schema keys exact two-way match | PASS — contracts spec |  
| `COLUMN_TYPES` | PASS — kind parity across all 46 |  
| `AnalysisSlice` serialization round-trip | PASS — added this pass (`toJSON`↔`fromJSON` deep-equal) |  
| `SliceFilter` ops ×3 | PASS — `in`/`range`/`dateRange` each discriminate on a real manifest column |  
| Stable sort on dup `tradeId` | PASS |  
| Empty row set → header+`\n` | PASS |  
| Golden fixture | PASS — byte-pinned, `112.9` (lossless repr, not `112.90`) |  
| Real-data relay | PASS — 7/7 vs prod: 247 trades fetched, 25 stamped `ind.*` rows verified, shuffle-determinism, no literal-marker cells, deep-equal round-trip |  

## Thermo-nuclear  
- Codec is pure — no secrets, no storage writes; relay is read-only (`getDocs`, no `setDoc`/`updateDoc`).  
- Sort is total (`tradeId` key) and stable — the spec now proves it.  
- No regex on CSV (proper cell-walk parser in spec); no `eval`; no injection surface (all cells quoted on `\n`/`"`/`,`/`\r`).  

## Findings during review  
1. Empty-cell spec under-tested `undefined` — rectified via `Partial`+delete (honest runtime shape).  
2. TEST-doc slice seams (`AnalysisSlice` round-trip, `SliceFilter` op coverage) were missing from the #1073 spec — added here since no later task covers them before #1085.  

## Verification  
- `shared/analysis-csv.spec.ts` + `shared/analysis-dataset-contracts.spec.ts`: **27/27**  
- `paper-trading-analysis-1074-csv-codec` relay vs prod: **7/7**  
- `functions` tsc: clean · app build: pass (warnings all pre-existing, none in changed files)  

## Gate  
**PASS** — #1074 → `7_QA`; QA issue opened.
