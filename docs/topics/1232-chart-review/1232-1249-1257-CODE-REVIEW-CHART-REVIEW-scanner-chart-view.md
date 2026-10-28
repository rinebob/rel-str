**Topic:** Scanner Chart View  
**Topic Slug:** scanner-chart-view  
**Thread:** Chart View Extension  
**Thread Slug:** chart-view-extension  
**Issue:** (QA issue created on PASS)  
**Thread Parent:** #1233  
**Topic Parent:** #1232  
**Task:** #1257  
**Domain:** CHART-REVIEW  
**Type:** CODE-REVIEW  
**Status:** Complete  
**Created:** 2026-10-27  
**Last Updated:** 2026-10-27  

# CODE-REVIEW — #1257 ScannerService.saveLatestRun + discovery call sites

## Verdict: PASS

Two review rounds, three axes each (Standards / Spec / adversarial), all
findings remediated and re-verified in the working tree before this doc.

## Scope reviewed

- `src/app/features/savant-trader/services/scanner.service.ts` —
  `saveLatestRun` seam (+40)
- `src/app/features/savant-trader/stores/scanner.store.ts` — two call
  sites: `launchRecipe` success, `runScan` success (+10)
- Both spec files (+~90)

## Round 1 — findings and dispositions

| Sev | Finding | Disposition |
|---|---|---|
| MINOR | `ScanLatestRun` construction + `isScanTruncated` outside `try` — malformed result → unhandled rejection at `void` call sites | Fixed — whole body inside `try`; warn-only is now structural |
| MINOR | Three `as never` fixtures violate typed-fixture guideline | Fixed — typed `PreviewScanResult` literals with full `ScanResultRow` fields |
| MINOR | No spec pins "superseded run does not write" | Fixed — non-assertion added to the stale-`runScan` test AND `toHaveBeenCalledTimes(1)` + `calledWith(FRESH)` pin on the overlapping-relaunch test (`recipeSeqs` side) |
| NIT | Warn prefix deviates from bracketed-owner convention | Fixed — `[ScannerService] saveLatestRun failed — run unaffected` |
| NIT | File-header JSDoc missing the seam | Fixed — latest-runs bullet added |
| NIT | `warn.mockRestore` not in finally; redundant `as PreviewScanResult` | Fixed — `try/finally`; cast removed |
| MINOR | `runSeq`/`recipeSeqs` are disjoint supersession domains — a same-recipe `runScan`/`launchRecipe` overlap could last-writer-wins stale data (currently unreachable: `runScan` isn't wired in the live page) | Acknowledged — comment added at the `runScan` write site flagging the caveat for future re-wiring |
| MINOR | Commit-order race: guard checks completion order, `setDoc` commit order is unordered | Acknowledged — inherent to fire-and-forget LWW, same tradeoff `persist()` already accepts; self-heals on next run |
| MINOR | Failed-compare/superseded runs never cache (freshness gap) | Deliberate-consistent — write tied to run *acceptance*, matching `persist()`'s ghost-write policy; contract wording noted |
| NIT | Two `ranAt` stamps per run (doc vs `runs[].ranAt`) | Accepted — harmless ms divergence |
| adjudicated | `runScan` write precedes parse/compare/persist — cache lands even if downstream throws | Confirmed intended — the doc caches the *wire result*, which did succeed; flagged by both axes as defensible |

## Spec axis result

All six ACs verified implemented AND spec'd: deterministic path write,
`runScan` adapter reuse, `launchRecipe` wire pass-through, `evaluateTracked`
explicit non-assertion, warn-only failure path, `truncated` via
`isScanTruncated`. `runAllRecipes`/`refreshRecipe` coverage by construction
(both funnel through `launchRecipe`).

## Thermo-nuclear axis result

Attack vectors verified clean: single write per accepted completion,
guard-before-write ordering synchronous in one microtask, every failure
path resolves through the catch (post-fix), types check out
(`filters_applied`/`sorted_by` optional on `PreviewScanResult`), rules
already permit the write (#1254), client `ranAt` is the adjudicated
tradeoff consistent with `CurationProposal.ranAt`.

## Round 2 — fresh pass on the post-remediation tree

User-requested second pass. Regenerated the scoped diff (the r1 diff was
stale after remediation) and ran three fresh reviewers — Standards, Spec,
adversarial — against the working tree.

**Axes verdicts:** Standards CLEAN · Spec PASS · adversarial — no
functional defects, no CRITICAL/MAJOR.

Spec and adversarial independently converged on the same finding class —
the r1 remediation's own invariants weren't spec-pinned:

| Sev | Finding | Disposition |
|---|---|---|
| MINOR | Malformed-result warn-only unpinned — a regression hoisting construction back above `try` would reintroduce `void`-ed rejections with zero failing tests | Fixed — `saveLatestRun({} as PreviewScanResult)` test: resolves, warns with `[ScannerService]` prefix, `setDoc` untouched |
| MINOR | Failure paths don't pin "no cache write" — `runScan` rejection, `previewScanRaw` per-recipe failure, empty-universe early-throw | Fixed — `not.toHaveBeenCalled()` pins on the AUTH-rejection and empty-universe specs; `times(N-1)` on the per-recipe-failure wave spec; `not.toHaveBeenCalled()` on the all-failed wave spec |
| NIT | `setDoc` call-count/arg-count unpinned — a `{merge:true}` regression invisible | Fixed — `toHaveBeenCalledTimes(1)` + `calls[0]` length 2 + `Date.parse(ranAt)` pins |
| NIT | Unauthenticated warn-path unspec'd | Fixed — `of(null)` authState spec: resolves, warns, no write |

All spec-only additions; implementation untouched.

## Test results

- Targeted: `scanner.service.spec.ts` 14 + `scanner.store.spec.ts` 44 —
  green through both rounds
- Full suite: **269 suites / 4,648 tests, 0 failures**
- Typecheck: app clean

Round 2 findings were confined to spec-coverage pins on already-correct
implementation — the seam itself is converged. Remaining observations are
adjudicated tradeoffs documented in the round-1 table, not defects. No
third pass needed.
