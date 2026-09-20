**Topic:** Signal Pipeline Maintenance  
**Topic Slug:** signal-pipeline-maint  
**Thread:** Misc fixes  
**Thread Slug:** misc-fixes  
**Issue:** #438  
**Task:** #439  
**Thread Parent:** #434  
**Topic Parent:** #433  
**Domain:** SIGNAL-REVIEW  
**Type:** CODE-REVIEW  
**Status:** Final  
**Created:** 2026-09-19  
**Last Updated:** 2026-09-20  

# Code Review: FE â€” Enable ACR actions on prior runs

## Scope

Task #439: redefine the shared `isActionableRun` gate from "viewed run === latest completed run" to "viewed run is a completed run (any vintage)". Per explicit user direction the unlock applies globally â€” signal-review ACR buttons plus all other consumers of the shared computed (chart-review actions, review-header, trade-row, signal-review-header).

### Files changed

| File | Change |
|------|--------|
| `stores/group.store.ts` | `isActionableRun` = `isCompletedRun(viewedRun())`; removed unused `StStore` inject in that computed block |
| `services/types.ts` | New shared `isCompletedRun(run)` predicate (SUCCESS/PARTIAL + `completedAt`) |
| `stores/st.store.ts` | `latestCompletedRun` now uses `isCompletedRun` (same semantics) |
| `stores/occurrence-decision.store.ts` | Injects `StStore`; `persistSignalDecisions` computes `isCurrent = runId === latestCompletedRun()?.id` and threads it into `buildDecision` + service |
| `services/occurrence-decision.service.ts` | `persistDecisionsBatch` gains `isCurrentInLatestRun` param; `PersistOccurrenceDecisionInput` gains required `isCurrentInLatestRun` field (no existing callers) |
| `stores/signal-review.facade.ts` | Doc comment on `runIfActionable` |
| `stores/group.store.spec.ts` | **New** â€” 7 tests on `isActionableRun` via public `setActiveRun` |
| `stores/signal-review.facade.spec.ts` | Rewritten to jest-native mocks (heals 10 pre-existing failures); +4 prior-run tests |
| `stores/occurrence-decision.store.spec.ts` | `StStore` mock + 2 tests on `isCurrentInLatestRun` write behavior |

## Standards axis

No hard violations. Mock signatures verified against real store/service contracts (`acceptSignals(signals, runId, marketDate)`, `persistDecisionsBatch`, `stageTicket`, `removeTicket`).

Judgement calls raised and **resolved in this round**:
- Mixed spy idioms (jasmine.createSpy vs jest.fn) â†’ group.store.spec.ts converted to `jest.fn()`.
- Hand-rolled `signal()` fake in facade.spec.ts â†’ replaced with real `@angular/core` `signal`.
- Incomplete store mocks (`signalHistoryLoading`, `latestBySymbol`, `loading`) â†’ added.
- Brittle `flush()` (3Ã— Promise.resolve) â†’ replaced with a single `setTimeout(0)` macrotask drain (`setImmediate` unavailable under jsdom).

Pre-existing advisories (not introduced by this diff):
- `group.store.ts` is 411 lines â€” over the 400-line "strong smell" threshold. Flag for decomposition; out of scope here.
- `_activeRunMarketDate` is a denormalized cache duplicating `viewedRun.marketDate` â€” two sources of truth; acceptable short-term.

## Spec axis

All 7 acceptance criteria met:

| AC | Verdict | Evidence |
|----|---------|----------|
| Non-latest completed run enables all five ACR buttons | MET | `group.store.ts` `isActionableRun`; `symbol-row.component.html` `[disabled]` |
| Accept on prior run stages ticket with viewed-run context | MET* | `facade.acceptSymbol` uses `activeRunId`/`activeRunMarketDate`; `decisionId` embeds viewed runId. *`signalContext` has no literal `runId` field â€” run referenced via `decisionId` prefix and `sourceRef.id`. |
| De-accept removes staged ticket | MET | toggle path calls `resetSymbol` + `removeTicket`; tested |
| Reject/Reset write/remove decisions against viewed run | MET | `persistDecisionsBatch(runId, â€¦)` keys docs by viewed runId; `resetSymbol` deletes only matching `runId` |
| Disabled when no run / non-completed run | MET | gate returns false for null/missing `completedAt`/non-SUCCESS-PARTIAL; tested |
| Latest-run behavior + stale indicator unchanged | MET | `decisionStale` untouched; new-run transition effect preserved |
| Facade/store specs cover prior-run paths | MET | 7 store tests + 4 facade prior-run tests + 2 flag tests |

Residual gate note: `markForReview`/`clearReviewFlags` remain behind `runIfActionable` â€” consistent with the new semantics (allowed on any completed viewed run, blocked on non-completed).

## Thermo-nuclear axis

Findings and dispositions:

- **C1 â€” `isCurrentInLatestRun` hardcoded `true`** (critical) â†’ **FIXED.** Prior-run decisions were persisted claiming to be current in the latest run; `loadCurrentDecisions` queries that flag. Now computed as `runId === latestCompletedRun()?.id` at write time and threaded through store â†’ service â†’ Firestore. Tests added.
- **C2 â€” Cross-run accept displaces the latest decision in the order pipeline** â†’ **ACKNOWLEDGED AS INTENDED.** Accepting a prior-run signal is the feature itself; the staged ticket carries the viewed run's `decisionId`/`barDate` in `signalContext`, so vintage is inspectable. Follow-up idea: surface signal vintage on the order ticket UI (candidate inventory item).
- **M1 â€” `isActionableRun` false for runs outside the 100-run stream window** â†’ **ADVISORY.** The run selector sources from the same stream, so an out-of-window run can't normally be selected; a deep link before hydration disables actions until the stream arrives, then enables. Documented limitation, no code change.
- **M2 â€” Duplicated completion predicate** â†’ **FIXED.** Extracted `isCompletedRun` to `services/types.ts`; used by `st.store`, `group.store`, and the spec mock.
- **M3 â€” New-run transition effect vs. prior-run viewing** â†’ **VERIFIED SAFE.** Screening state clears only when the viewed run was the previous latest; `markRunNotCurrent` firing regardless is correct.
- Minor: `trade-row` component may be a dead consumer of the gate (verify or delete â€” inventory candidate).

## Test results

- **Task-scoped suites: 39/39 green** â€” group.store (7), signal-review.facade (16), occurrence-decision.store (16).
- **Full suite at review baseline: 1319 passed / 98 failed** â€” all pre-existing `jest-preset-angular` migration breakage, none attributable to this change (jasmine shim `.calls` collision, missing `objectContaining`/`resolveTo`/`rejectWith`, `fakeAsync` cannot flush native `await`, Firebase DI stubs absent, ESM `jose` not transformed).
- **Resolved under #447**: the spec-infra heal was implemented immediately after this review â€” full suite now **1446/1446 green across 107 suites**.
- `tsc -p tsconfig.app.json --noEmit` â€” clean; `tsc -p tsconfig.spec.json` â€” clean.
- `git diff --check` â€” clean.

## Verdict

**PASS.** All task-scoped tests are green; the critical finding (C1) was found, fixed, and tested within this review round. The baseline suite failures seen during review were pre-existing jest-30 migration breakage â€” fully healed under #447, and the suite now runs clean (1446/1446).
