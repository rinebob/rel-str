**Topic:** Options Backtest  
**Topic Slug:** options-backtest  
**Thread:** Multi-leg Templates  
**Thread Slug:** multi-leg-spread  
**Issue:** #1489  
**Thread Parent:** #1270  
**Topic Parent:** #1238  
**Task:** #1500  
**Domain:** BE  
**Type:** CODE-REVIEW  
**Status:** Complete  
**Created:** 2026-11-18  
**Last Updated:** 2026-11-18  

# Code Review — #1500 Analyzer: position net series + records

**Verdict: PASS** — 3 axes found one critical (net-debit posture) plus
convergent majors/minors; all remediated in-cycle and re-verified.

## Pass sequence

```text
First pass complete — 3 axes in parallel: Standards (file-size strong smells on records.ts 415/worker.ts 334; redundant PositionNetBar redeclaring ExitScanBar.expiry; hardcoded registryVersion in verifier; assignmentDistancePct min-vs-max divergence vs the #1544 manage pass; duplicated signFor/legIntrinsic/placeholderExcursion/parseMark helpers across the two multi-leg writers), Spec (literal Σ long − Σ short formula wrong-in-spirit — confirmed as spec-text deviation, not impl bug; gamma/theta/vega literal shortfall — no record fields exist; stock-only-remainder PRD ambiguity; missing failed-position+healthy-sibling test), Thermo (CRITICAL: net-debit/LONG positions emit negative entryMark → day-0 garbage fires on every premium-decay rule + expiredItm always false for a long leg — the registry HAS long/debit variants so this is live, not theoretical; MAJOR: shared contract docs still describe per-contract semantics; MAJOR: assignmentDistancePct convention split; minors: stale worker comments, unreachable minDistancePct ?? 0, no contractId fetch dedup, pickDocMeta required on the start view type).
Second pass complete — remediation applied and re-verified: posture normalization (cost-to-close legs, whole analysis flips to liquidation value when entryMark < 0 — debit positions evaluate as positive-decaying premium exposure; v1 short parity holds byte-for-byte since postureSign = 1); outcome layer extracted to position-outcomes.ts (records.ts 415→270); PositionNetBar deleted (ExitScanBar carries expiry); worker fetch dedups by contractId (repeatsPrevious rows share one widened window); shared contract docs updated to net/posture semantics; pickDocMeta made optional; minDistancePct ?? 0 → explicit error; stale comments + hardcoded registryVersion + untyped verify fixture fixed; 7 new tests (debit flip, long-put ITM expiredItm, stock-only error, unusable type multi-leg, stock head-truncation, sibling isolation, contractId dedup).
Convergence: PASS — the critical is fixed at the root (posture normalization makes the spec's own Σ long − Σ short formula literally true for debit postures while preserving v1 short parity) and every convergent finding is resolved or dispositioned; 103/103 options-analysis, 127/127 options-replay, 26/26 DRY, build clean. Documented divergences: assignmentDistancePct min-vs-max vs the #1544 pass (contract doc now says closest-leg; flagged for reconciliation — one convention must win); gamma/theta/vega absent (no record destination — spec-text shortfall accepted); FE consumers lose expiry dots/ROCs on joined 'A+B' contractIds (forward note, no FE in this task's scope).
```

## Diff summary

- `functions/src/options-analysis/position-net.ts` — **new** pure
  net-series builder: cost-to-close leg signing, inner-join (a date
  missing from any living leg is unpriceable and drops), settlement
  freezing (`frozenMark` past a leg's own expiry), per-bar nearest
  living option expiry, absent-field → absent-value for net delta/iv.
- `functions/src/options-analysis/records.ts` — `buildPickRecords`
  replaced by `buildPositionRecords`: per-leg fetch results →
  normalized maps → net series → posture flip (debit → liquidation
  value) → same evaluators → position records.
- `functions/src/options-analysis/position-outcomes.ts` — **new**
  outcome layer (error records, leg settlement/intrinsic, shared
  no-fire outcome mapping with posture-aware net settlement).
- `functions/src/options-analysis/worker.ts` — v1→v2 narrowing via
  `v1ListDocToV2`, one fetch per UNIQUE contractId (widened to the
  earliest holding entry), stock legs never fetched, bounded
  concurrency, `prodAnalysisDeps` exported.
- `functions/src/options-analysis/exit-evaluators.ts` — `ExitScanBar`
  gains `expiry?`; `dte-time` prefers the bar's nearest living expiry.
- `functions/src/options-analysis/start.ts` — v2 `failed-precondition`
  gate removed (v2 docs enqueue); `pickDocMeta` optional on the view;
  gridVersion-0 manage-instance guard retained.
- `shared/options-analysis-contracts.ts` — doc comments updated to
  net/posture-normalized semantics (`entryMark` always ≥0-at-entry,
  `contractId` joined, `expiredItm`/`intrinsicAtExpiry`/
  `assignmentDistancePct` position semantics). No field changes.
- Tests: `position-net.test.ts` (14), `worker.test.ts` v2 block (17),
  `start.test.ts` enqueue path — 103/103.
- `functions/scripts/verify/options-analysis-position-1500.ts` + `.md`
  — DRY fake-deps (26 assertions) + LIVE real-Firestore/SA path;
  registered in `run-all.ts` + READMEs.

## Axis reports

### Standards

**Findings (all remediated or dispositioned):**

- `records.ts` 415 lines past the 400 strong-smell — **fixed**: outcome
  layer extracted to `position-outcomes.ts` (records.ts → 270).
- `worker.ts` ~350 lines — judgement call; the dedup refactor is the
  cohesive core; further extraction adds indirection. Dispositioned.
- `PositionNetBar extends ExitScanBar { expiry }` redundant — **fixed**:
  deleted; the builder returns `ExitScanBar[]`.
- Verifier hardcoded `registryVersion: 2` — **fixed** →
  `EXIT_REGISTRY_VERSION`.
- `signFor`/`legIntrinsic`/`placeholderExcursion`/`numOrUndef`/`parseMark`
  duplicated vs `manage-exit-scan-pass.ts` — dispositioned: extraction
  into shared code would edit a committed foreign-domain file; tracked
  as a follow-up consolidation candidate, not this task's scope.

### Spec

- **Sign-formula deviation — resolved by design.** The issue's literal
  `Σ long − Σ short` breaks the v1-parity AC (negates short-pick
  entryMark → day-0 fires) AND credit positions; the impl's pure
  `Σ short − Σ long` breaks debit positions. Posture normalization is
  the union: credit → cost-to-close, debit → liquidation value — each
  posture gets the formula that makes its premium exposure positive
  and decaying. IMPL-BE §4 as-built note records the deviation.
- `gamma/theta/vega` — literal shortfall accepted: the wire carries
  them but `AnalysisTradeRecord` has no destination fields; delta/iv
  only. Documented in IMPL §4.
- Stock-only remainder — PRD ambiguous ("keeps marking" vs "lives to
  last expiry"); bounded reading implemented (a stock-only position is
  a 'no option leg' error). Documented.
- Missing test (failed + healthy sibling) — **added**.
- `gridVersion: 0` guard — confirmed pre-existing (#1499), not this diff.

### Thermo-Nuclear

- **CRITICAL — debit/LONG garbage** — **fixed**: posture flip; 7 new
  tests cover debit spread exit, long-put ITM `expiredItm`, stock-only,
  unusable-type multi-leg, stock head-truncation, sibling isolation,
  dedup.
- **MAJOR — contract doc drift** — **fixed**: contract comments now
  describe net/posture semantics. Forward notes (not this task):
  `parseOccContractId` returns null on `'A+B'` → FE loses expiry dots +
  capitalRoc on multi-leg rows; covered-call `expiredItm` reads
  package-value semantics.
- **MAJOR — `assignmentDistancePct` split** — dispositioned: kept MIN
  (closest-to-money drives assignment; also the field's "how far are
  we forced to buy" framing); `manage-exit-scan-pass.ts` uses MAX —
  the contract doc now states closest-leg and the divergence is
  flagged for a follow-up reconciliation; one convention must win.
- Minors — all fixed (stale comments, `?? 0` → error, `pickDocMeta`
  optional) or dispositioned (`LegFetchResult` tri-state — tolerated;
  stock delta per-share vs per-contract units — internally consistent,
  documented; dedup — implemented).

## Test evidence

- `tests/functions/options-analysis`: **103/103** (14 net-builder + 17
  v2 worker incl. narrowing byte-parity + 7 remediation tests).
- `tests/functions/options-replay`: **127/127** (regression — unchanged).
- DRY verify: **26/26**; LIVE verify: **10/10** earlier run (real
  Firestore + real SA fetches on a #1499-produced doc).
- `npm run build`: clean.
- Full-repo baseline: 4 pre-existing failures in
  `paper-trading/analysis-dataset-writer.test.ts` (stale fixture vs
  `deps.writeChunks`, committed at `8be72113`/`c1354e60`) — unrelated,
  zero overlap with this change.

## Verdict

PASS — the only blocking finding (debit posture) is remediated at the
root and covered by new tests; spec deviations are documented in the
IMPL as-built note; remaining divergences are dispositioned with
reasons and follow-ups flagged.
