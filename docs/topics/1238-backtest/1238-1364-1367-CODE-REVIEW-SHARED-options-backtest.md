**Topic:** Options Backtest  
**Topic Slug:** options-backtest  
**Thread:** Backtest Analytics  
**Thread Slug:** backtest-analytics  
**Issue:** #1364  
**Thread Parent:** #1266  
**Topic Parent:** #1238  
**Task:** #1367  
**Domain:** SHARED  
**Type:** CODE-REVIEW  
**Status:** Complete  
**Created:** 2026-11-02  
**Last Updated:** 2026-11-02  

# Code Review — #1367 Exit registry + analysis contracts

**Verdict:** **PASS** (fail-as-submitted → remediated in-cycle; all findings closed)  
**Test gate:** jest full suite **287 suites / 4,946 tests PASS**; targeted `shared/options-analysis|options-replay` 39/39; strict standalone `tsc` clean; verify script 17/17 checks.

Three axes run in parallel per review protocol. Findings are consolidated here.

---

## Thermo-Nuclear (deep structural review)

All three flagged majors were real and were fixed by converting both files to
discriminated unions — the `ContractListRow` precedent the codebase already uses.

| # | Finding | Disposition |
|---|---|---|
| TN-1 | **`AnalysisTradeRecord` was a flat interface** with comment-convention conditional fields — a malformed record (`outcome:'exit'` with no `exitPrice`, or carrying `expiredItm`) compiled silently. | **FIXED** — `AnalysisTradeRecord` is now `AnalysisExitTrade \| AnalysisExpiredTrade \| AnalysisErrorTrade`, sharing `AnalysisTradeBase`. Invalid combos are unrepresentable. The entry-day placeholder convention for error records (daysHeld 0, mae/mfe = entry mark/pickDate) is doc'd on the variant and spec'd. |
| TN-2 | **`ExitStrategyDef.params` was an all-optional bag** — `{kind:'absolute-price', params:{}}` compiled; invariants were runtime-only. | **FIXED** — union on `kind`: `target-pct-premium`→`{pct}`, `absolute-price`→`{price}`, `stop-pct-premium`→`{pct}`, `dte-time`→`{dte}`, `hold-to-expiry`→`Record<string,never>`. Curated-literal guards (pct ranges, int dte) stay as jest specs. |
| TN-3 | **`assignmentDistancePct` name vs. doc'd semantics** — "distance/closingPrice" read as a ratio while every neighboring `*Pct` field is ×100; 100× FE/BE silent divergence. | **FIXED** — doc + fixtures now use PERCENT (×100), e.g. 0.62% / 31%. |

## Standards

| # | Finding | Disposition |
|---|---|---|
| S-1 | Verify script duplicated 15+ registry-hygiene assertions already covered by `options-analysis-registry.spec.ts` | **FIXED** — script trimmed to its distinct value: alias resolution under tsx, `{list}_{exit}` doc-key path composition, outcome-variant conventions, payload shapes (17 checks). |
| S-2 | `OptionsReplayRetryRequest/Response` in analysis file — replay payloads canonically live in `options-replay-contracts.ts` | **FIXED** — moved to `options-replay-contracts.ts` (imported in verify script from `@options-replay/contracts`). |
| S-3 | No `ANALYSIS_RESULT_STATUSES` const alongside `AnalysisResultStatus` — breaks the codebase's const+type pair convention | **FIXED** — `ANALYSIS_RESULT_STATUSES` added (type-then-const pair, matching the `OPTIONS_REPLAY_RUN_STATUSES` precedent). |
| S-4 | IMPL doc type blocks diverged from shipped unions | **FIXED** — IMPL-SHARED updated to as-built. |
| — | Self-import spec header comment | N/A — header pattern is the house convention; spec file itself contains no self-import. |

## Spec conformance

| Finding | Disposition |
|---|---|
| Error-record fixture in verify script violated its own documented convention (`daysHeld:10`, real excursions) | **FIXED** — fixture now uses `daysHeld:0` + entry-day mae/mfe. |
| `getExitStrategy` miss-case tested but hit-case not jest-spec'd | **FIXED** — spec now round-trips every seeded id (`toBe` identity) + miss case. |
| Callable payload structural shape untested in jest | ACCEPTED — TEST doc scopes payload boundary checks to the BE layer (#1369–1372); shape is exercised in the verify script. |
| Vacuous appendability test (tested `Array.find`, not the lookup) | **FIXED** — replaced by the real round-trip test. |

## Round 2 — re-review of the remediated files

Three axes re-run on the post-remediation state. Full suite re-run:
**287 suites / 4,945 tests PASS**; targeted `options-analysis|options-replay`
41/41; strict `tsc` clean; verify script 18/18.

| # | Finding | Disposition |
|---|---|---|
| TN2-1 (major) | `'expired'` conflated "ran to expiration" with "series ended early" — a truncated series would write fabricated `expiredItm`/`assignmentDistancePct` | **FIXED** — `AnalysisExpiredTrade`/`AnalysisErrorTrade` docs now pin the writer contract: 'expired' only when the last series bar is the expiry bar (`PickDocDay.expiration` is on the row for the comparison); early-ending series → 'error'. IMPL-BE evaluator section updated to match. (A 4th 'truncated' outcome was considered — deferred; the two-outcome split covers it without widening the union.) |
| S2-1 (major) | Verify guide `.md` described the pre-trim script | **FIXED** — guide + README row rewritten to the script's actual scope. |
| TN2-2 | `ExitTypeAggregate` mixed three "no data" encodings (0-sentinel, absence, required-zeroed) | **FIXED** — uniform convention: every stat optional, absent when its population is empty; populations documented per field (`worstMae`/`maeP50`/`maeP90` over non-error records). This also resolves the round-1 `hitRatePct` 0/0 deferral — absent, not 0. |
| S2-2 / TN2-4 | `ExitRuleKind` + `AnalysisOutcome` dead, hand-maintained exports | **FIXED** — renamed `ExitStrategyKind`, both now derive from their unions (`X = Union['kind'|'outcome']`) — can't drift. |
| S2-3 | `ANALYSIS_RESULT_STATUSES` + callable payloads never spec'd (neighbor convention does) | **FIXED** — spec now asserts the statuses array + fixture-constructs all three payload types. |
| S2-4 / TN2-10 | `Extract<>` filter duplicated ×4 in registry spec | **FIXED** — `byKind` helper. |
| TN2-5 | `exitId` charset unguarded despite doc-key role | **FIXED** — spec guards `/^[a-z0-9][a-z0-9-]*$/` (no `/` → nested path; no `_` → ambiguous suffix split). |
| TN2-3 | `worstMae`/`maeP50`/`maeP90` + `expiredItm`/`intrinsicAtExpiry` lacked population/semantics docs | **FIXED** — field-level docs added (put/call sign conventions; template-side interpretation note). |
| — | Stale `OutcomeDoc` in IMPL mermaid; missing deferral annotations on IMPL module 4 / TEST rules-indexes; IMPL-BE 'expired' conflation | **FIXED** — mermaid → `AnalysisResultDoc`/`ExitTypeAggregate`; both docs annotate "deferred to #1368"; IMPL-BE line now states the last-bar-is-expiry rule. |
| — | Verify `check()` signature diverged from sibling scripts; near-tautological doc-key check | **FIXED** — `check(name, actual, expected)` per 1275/1276; check now compares the composed key directly. |

**Accepted / deferred (not blockers):**
- Error-variant placeholder convention (entry-day mae/mfe, daysHeld 0) — a comment-enforced invariant, deliberately kept: the alternative (excursions only on non-error variants) forces every consumer to narrow for table rendering. Uniform record shape wins for the FE use case.
- `params.pct` carries different formulas on `target-pct-premium` (capture) vs `stop-pct-premium` (level) — documented per-variant; `kind` dispatch scopes semantics. The adjacent sim/backtest family uses fraction-style `*Pct` — flagged again for #1372 (the 100×-divergence hazard lives there, not here).
- `OptionsAnalysisStartRequest` shape now jest-covered; BE boundary validation remains #1370's scope.

**Round-2 verdict: PASS — no remaining critical/major findings; minors all remediated or consciously accepted.**

## Non-blocking notes for downstream tasks

- **#1368**: the `{listDocId}_{exitId}` result-doc key overwrites on registry-version bump — old-version docs are replaced, not preserved. Acceptable for v1 (results are regenerable); flagging so the FE knows stale-vs-fresh is "version stamped", not "version preserved".
- **#1368**: add a `stOptionsAnalysisResultDocId(listDocId, exitId)` builder next to the collection constant so the key format has a single home.
- **#1372** (analyzer worker): aggregate stats are ABSENT when their population is empty (round-2 contract change) — write nothing, don't fabricate 0s; the FE renders '—'. Truncated series (last bar ≠ expiry bar) → `outcome:'error'`, never 'expired'. Mind the fraction-vs-percent trap when porting sim stop/target logic into evaluators — `params.pct` here is ×100.
- Registry seeds remain **provisional** pending the user's final exit list — constants edit + version bump.
