# CODE REVIEW — #1076 Dataset Writer + generateTradeDataset  
**Date:** 2026-10-20  
**Reviewer:** Devin  
**Task:** #1076  
**Blueprint:** #1075  
**Topic:** #553  
**Verdict:** PASS  

## Review scope  
- `functions/src/paper-trading/analysis/dataset-writer.ts` (new — `writeDataset`)  
- `functions/src/paper-trading/analysis/analysis-callables.ts` (new — `handleGenerateTradeDataset` + `generateTradeDataset` onCall + `mintDatasetId`)  
- `functions/src/paper-trading/analysis/analysis-dataset-task.ts` (new — stub onTaskDispatched, `maxAttempts: 1`, flips doc `failed`/"not implemented" until #1077/#1078)  
- `functions/src/index.ts` (+2 exports)  
- `shared/analysis-dataset-contracts.ts` (+`AnalysisRunParams`, `GenerateTradeDatasetRequest/Response`, `AnalysisDatasetTaskPayload`, `AnalysisEntryConvention`/`ENTRY_CONVENTIONS`, `SIGNAL_TYPES` exported, `entryFilters` on doc)  
- `tests/functions/paper-trading/{analysis-dataset-writer,generate-trade-dataset}.test.ts` (new — 19 specs, tsx `--test`)  
- `functions/scripts/verify/paper-trading-analysis-1076-dataset-writer.ts` + `.md` + README/run-all index entries  
- IMPL §2 as-built notes (id-hash input, stub task, explicit bucket, scope normalization, 3-family gate)  

## Standards  
- Callable is 219 lines, single seam (validate → mint → write → enqueue); deps-injected for hermetic specs — matches `autoPaper*` callable precedent.  
- Validation order correct: auth → shape → whitelists → grammar, all before any write. `exitRule` grammar parsed via the exit registry's `parseVariantKey` — no second parser.  
- Writer mirrors `overnight-simulation-writer.ts` storage conventions (`bucket().file().save()` with `contentType`, `db` merge-update on index doc).  
- No dead code; `GenerateTradeDatasetRequest = AnalysisRunParams` alias — provenance and payload share one type, can't drift.  
- Logging carries datasetId/origin/rowCount/error only — no params dumps, no secrets.  

## Spec  
| AC | Result |  
|---|---|  
| Bad exit grammar → 4xx, no index doc | PASS — `invalid-argument`, zero `createIndexDoc` calls asserted |  
| Index doc = full params provenance; `generating→ready` on success | PASS — doc deep-checked vs `AnalysisRunParams`; writer asserts `ready`+`rowCount`+`gcsPath` |  
| `→failed`+error on writer throw | PASS — upload-fail and ready-update-fail both attempted; failure-of-failure surfaces |  
| Two same-day runs → distinct ids | PASS — `ds-{yyyymmdd}-{origin}-{hash8}`, hash covers params+timestamp+nonce |  
| PRD grammar = 3 firing families | PASS — `limit-stddev` parses in registry but rejected (stubbed never-to-fire; would mint all-OPEN datasets) |  
| Real ISO dates, `from<=to` | PASS — regex + `Date.parse` validity + ordering |  
| `symbolScope` normalization | PASS — trim/uppercase/drop-blank (ledger keys uppercase) |  
| `entryFilters` object gate | PASS — string/array rejected; plain object flows to doc |  
| Signal-type whitelist | PASS — `SIGNAL_TYPES` (manifest enum) is the only list |  
| Empty scope = "all" | PASS — `[]`/`undefined` both accepted |  
| Empty rows → header-only CSV, `ready`, `rowCount: 0` | PASS |  
| Enqueue failure → doc `failed`, `unavailable` | PASS — added during this review |  

## Thermo-nuclear  
- Callable: auth required; admin-only collection (`analysis-datasets` rules-deny client writes — admin SDK bypasses); CORS pinned to `OPTIONS_STRATEGY_ALLOWED_ORIGINS`.  
- Id minting uses sha256 + crypto nonce — not a security control (just uniqueness), collision odds negligible at 8 hex chars over params+ts+nonce.  
- Failure containment: index doc written **before** enqueue (task can't race ahead of its own doc); enqueue failure flips `failed`; writer failure flips `failed`; stub task flips `failed` — no path wedges at `generating` except the documented failure-of-failure case.  
- Relay writes to real prod but uses probe ids (`verify-1076-*`) and cleans nothing destructively — additive objects only; bucket pinned to `rel-str.appspot.com` (ADC has no default).  

## Findings during review  
**Round 1**  
1. **Enqueue-failure wedge** — original code left the doc at `generating` if `enqueueTask` threw (Cloud Tasks outage / queue missing). Fixed: flip `failed` + `unavailable`, +1 spec.  
2. **Test runner** — specs are `node:test` style; repo convention is `tsx --test` (extensionless TS imports need tsx's resolver, raw `node --test` fails). Guide + README already say tsx.  
3. Verified zero overlap with concurrent #1006/#1043 working-tree edits (all #1076 files are new or single-hunk diffs).  

**Round 2**  
4. Enqueue-failure flip used `new Date()` instead of `deps.now()` — broke the injected-clock seam; fixed.  
5. Failed-transition `.catch(() => {})` swallowed silently — now logs `analysis_dataset_enqueue_failed_transition_failed`, matching the writer's surface-don't-hide rule.  
6. Stub task `set(merge)` could create a provenance-less doc if the index doc were missing — accepted (throwaway seam, replaced by the real read in #1077).  

**Round 3 — converged, no new findings.**  

## Verification  
- `tsx --test` on both spec files: **19/19** (5 writer + 14 callable)  
- `paper-trading-analysis-1076-dataset-writer` relay vs prod: **9 ✔ + 1 ⊘ SKIP** (real enqueue needs deployed task + service-account OIDC — honest skip, documented in guide)  
- `functions` tsc: clean · paper-trading function suite: 282/282 · shared codec/contracts: 27/27  

## Gate  
**PASS** — #1076 → `7_QA`; QA issue opened.
