**Topic:** Scanner Chart View  
**Topic Slug:** scanner-chart-view  
**Thread:** Chart View Extension  
**Thread Slug:** chart-view-extension  
**Issue:** #1248  
**Thread Parent:** #1233  
**Topic Parent:** #1232  
**Task:** #1254  
**Domain:** CHART-REVIEW  
**Type:** CODE-REVIEW  
**Status:** Complete  
**Created:** 2026-10-26  
**Last Updated:** 2026-10-26  

# Code Review — #1254 ScanLatestRun contract + collection paths + rules anchor

## Verdict

**PASS** — all 5 acceptance criteria met (Spec axis: 5/5 MET); no critical or
major findings on any axis; full suite green.

## Scope reviewed

- `shared/scanner-contracts.ts` — `ScanLatestRun` + `serializeScanLatestRun` /
  `parseScanLatestRun` (tail; mirrors the CurationProposal pair)
- `shared/st-collections.ts` — `StScannerKind` widening,
  `ST_SCANNER_LATEST_RUNS_ANCHOR`, `stScannerLatestRunsPath()`,
  `stScannerLatestRunDocPath()` (st-scanner section)
- `firestore.rules` — st-scanner write allowlist extended to `latest-runs`
- Specs: `shared/scanner-contracts.spec.ts`, `shared/st-collections.spec.ts`,
  `tests/functions/firestore-rules-indexes-1012.test.ts`
- Verify: `scripts/verify/scanner-chart-view-latest-run-1254.ts` + `.md` +
  README/run-all registration

Note: `st-collections.ts`, `firestore.rules`, the rules test, and
`st-collections.spec.ts` also carry uncommitted Topic #1238 selection-replay
hunks — excluded from this review's scope (marked to reviewers).

## Standards axis

No critical/major. Conforms to guidelines; mirrors the CurationProposal pair
deliberately; rules grant scoped exactly to the proposals posture.

- minor — `rows as ScanResultRow[]` narrows past an incomplete runtime check
  (instrument_* pass through unchecked) — plan-sanctioned per IMPL-SHARED and
  precedent at `parseCurationProposal`; cast now carries an honest comment
- nit — verify banner deviates from `=== ALL CHECKS PASSED ===` convention;
  REPO_ROOT style differs from sibling script; `isStringRecord` idiom
  duplicated (matches file style)
- observation — functions barrel deliberately not extended; correct scope
  (FE-only consumers this thread)

## Spec axis

**PASS — 5/5 ACs MET.** Faithful to the IMPL blueprint; rules line verbatim;
out-of-scope list honored (no Angular/BE code, no history retention).

Fixed during review (test-plan gaps):
- missing explicit `recipeId` mistype drift case — added
- TEST-doc 200-row-cap edge case not exercised — added a 200-row truncated
  round-trip pin

## Thermo-nuclear axis

Ship-able as-is — no critical/major. Data model judged correct (anchored
pattern beats flat root or doc-map); client `ranAt` correct (keeps serialize
pure, portable across SDKs); passthrough asymmetry defensible and documented;
`StScannerKind` widening safe (no kind-parameterized consumer).

- minor — `firestore.rules:456-461` orphaned/truncated `portfolio` comment —
  residue from the *other workstream's* #1013 deletion in the same file;
  routed to that workstream's owner, not this task
- nits — `toStrictEqual` now enforces the no-undefined claim (fixed);
  passthrough asymmetry now pinned by a spec (fixed); `delete` in allowlist
  broader than overwrite-only design needs (consistent with proposals —
  accepted); verify `JSON.stringify` key-order sensitivity (convention —
  accepted)

## Round 2 — fresh-eyes re-review (all three axes, new agents)

Round 2 produced **zero new defects** — both round-1 remediations verified
independently as landed. Findings were nits/observations only:

| Sev | Finding | Disposition |
|---|---|---|
| nit | Verify banner deviated from `=== ALL CHECKS PASSED ===` convention (flagged by both axes) | Fixed — script + `.md` guide aligned |
| nit | `columns` keys unvalidated at serialize; a future recipe display name with a Firestore-illegal char would throw silently under #1257's warn-only posture | Comment added on `serializeScanLatestRun` documenting the seam |
| obs | `runScan` returns camelCase `ScanRunResult` while `isScanTruncated`/`saveLatestRun` are wire-shaped — adapter precedent at `scanner.store.ts:347` | Routed to #1257 via issue comment |
| obs | Orphaned latest-run docs have no lifecycle (dead recipe ids linger); optional `d.id === parsed.recipeId` reader guard | Routed to #1258 via issue comment |
| obs | `firestore.rules:456-461` orphaned `portfolio` comment | Re-confirmed as the OTHER workstream's residue — routed to its owner |
| nit | `delete` in allowlist broader than overwrite-only design; loose scalar checks (NaN/float); allowlist pinned verbatim twice; `StScannerKind` zero-consumer | All consistent-with-precedent — accepted |
| adjudicated | `rows as ScanResultRow[]` narrowing past incomplete check | Re-confirmed plan-sanctioned; cast comment + spec pin already landed |

Round 3 consciously skipped: a ~250-line contract surface now holds two
convergent clean passes; remaining risk sits in the consumers (#1257/#1258),
which got the routed observations.

## Test results

- `shared/scanner-contracts.spec.ts` + `st-collections.spec.ts`: 46 tests green
- `tests/functions/firestore-rules-indexes-1012.test.ts` (node:test): 14 green
- Verify script: 13 checks green via real `@st/scanner`/`@st/collections` aliases
- Full suite: **269 suites / 4,637 tests — all green**
- Typecheck: app + functions tsconfigs clean

## Deferred / routed items

- `firestore.rules:456-461` orphaned portfolio comment — owner: Topic #1238
  workstream (its deletion left the fragment)
- If a functions-side reader/writer ever appears, add the three new names to
  `functions/src/common/st-collections.ts` barrel (none needed today)
