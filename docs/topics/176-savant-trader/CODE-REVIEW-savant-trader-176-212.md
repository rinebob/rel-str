**Topic:** Savant Trader — UAT cleanup + initial order tickets
**Issue:** #212
**Topic Parent:** #176
**Domain:** SAVANT-TRADER
**Type:** Code Review (Interim — issue is in 7_QA, not 5_IMPLEMENT)
**Status:** Complete
**Created:** 2026-09-02
**Last Updated:** 2026-09-02

---

## Summary

Three-axis interim review of the uncommitted Savant Trader UAT cleanup (#212 / topic #176). The diff covers UI polish across the run dashboard, signal review, and signal order pages; a refactor that separates the durable review flag (`isReviewed`) from the ephemeral ACR status (`reviewStatus`); persistence fixes so accepted decisions and review flags survive navigation; the prev/next navigation fix that follows grouped list order; removal of the `isEnabled` agent-status field; and a new scheduled cleanup function for occurrence decisions.

37 files touched (frontend + backend + docs).

### Verification

| Check | Result |
|---|---|
| `npm run build` (Angular, dev config) | **PASS** — exit 0, 17.4s |
| `npm run build` (functions, esbuild) | **PASS** — exit 0, 87ms |
| `ng test` (focused: utils, occurrence-decision, signal-review.facade, trading-config, order-execution) | **74/75 PASS** — 1 pre-existing failure (`buildSymbolGroups includes non-signal symbols when showAll is true`); confirmed pre-existing by stashing the diff and re-running on HEAD. |
| Pre-existing broken specs (not caused by this diff) | `strategy-builder.component.spec.ts` and `options-strategy-dashboard.component.spec.ts` import Node `fs`/`path`; `options-strategy.service.spec.ts` uses `jest` globals. All pre-existing. |

### Verdict: CONDITIONAL PASS

The diff meets the #212 acceptance criteria (UAT findings documented, fixes applied or explicitly accepted with notes, build passes). However, the thermo-nuclear axis surfaced **three critical correctness issues** in the review/accept separation refactor that should be resolved before the issue is closed:

1. `acceptSymbol` uses cross-run `acceptedSymbols()` for its toggle, but `resetSymbol` only clears the current run — stale accepts persist and the button misbehaves.
2. `markForReview` is still gated by `runIfActionable()`, contradicting the domain model that review flags are independent of the accept/ticket lifecycle.
3. `signal-review.facade.spec.ts` provides `StStore` as `{}`, which will crash the constructor effect that calls `latestCompletedRun()`.

The standards findings (file sizes, dead code, `any` usage) are cleanup items that can be deferred to #205.

---

## Standards

### Findings discovered and fixed during review

**S1. Test fixtures missing `isReviewed` field (MAJOR → fixed)**
- **Files:** `src/app/features/savant-trader/utils/utils.spec.ts:104-109, 115-122`
- The `SymbolRow` type gained a required `isReviewed` boolean, but two `rowHasDirection` test fixtures did not include it, causing TS2345 compile errors.
- **Fix:** Added `isReviewed: false` to both fixtures.

**S2. `baseInput` missing `reviewFlagSymbols` (MAJOR → fixed)**
- **File:** `src/app/features/savant-trader/utils/utils.spec.ts:127-140`
- `BuildSymbolGroupsInput` gained a required `reviewFlagSymbols: Set<string>` field, but the `buildSymbolGroups` test helper did not provide it, causing TS2327.
- **Fix:** Added `reviewFlagSymbols: new Set<string>()` to `baseInput`.

### Findings accepted (deferred to #205)

**S3. File size smells (MAJOR → deferred)**
- `signal-review.facade.ts` (512 lines), `utils.ts` (641 lines), `occurrence-decision.service.ts` (409 lines), `group.store.ts` (408 lines) all exceed the 400-line threshold.
- **Rationale:** These files were already large before this diff and the additions are small. Splitting them is a refactor that belongs in #205 (decision pipeline simplification), not a UAT cleanup.

**S4. Dead code — `DECISION_TTL_DAYS` defined but never imported (MAJOR → deferred)**
- **File:** `src/app/features/savant-trader/common/constants.ts:146`
- Added to document the backend TTL, but no TS file imports it. The backend `cleanup-st-occurrence-decisions.ts` hardcodes `DEFAULT_TTL_DAYS = 7` instead.
- **Suggested fix (deferred):** Either remove from the frontend, or wire the backend to read it from a shared config. Track in #205.

**S5. Dead code — `loadDecisionsForRun` legacy methods (MAJOR → deferred)**
- **Files:** `occurrence-decision.store.ts:271`, `occurrence-decision.service.ts:168`
- Marked "legacy — kept for backward compatibility" but only the spec file calls them. `loadRecentDecisions` is the production path.
- **Suggested fix (deferred):** Remove and update the spec to exercise `loadRecentDecisions`. Track in #205.

**S6. Dead code — `isCurrentInLatestRun` written but never read (MAJOR → deferred)**
- **Files:** `services/types.ts:134`, `occurrence-decision.service.ts:77,111,190,214,220`, `occurrence-decision.store.ts:90,319`
- The field is persisted, queried, and batch-updated by `markRunNotCurrent`, but the UI picks the latest decision by `decidedAt` and ignores it. `loadCurrentDecisions` (the only reader) is dead.
- **Suggested fix (deferred):** Remove the field, the parser line, the persistence payload key, and `markRunNotCurrent`. Track in #205.

**S7. Dead code — service methods with no production callers (MAJOR → deferred)**
- **File:** `occurrence-decision.service.ts:55,124,184,296`
- `persistDecision`, `deleteDecision`, `loadCurrentDecisions`, `listenToDecisionsForRun` have no callers in `src/`.
- **Suggested fix (deferred):** Delete or document. Track in #205.

**S8. Duplication — TTL days across frontend/backend boundary (MAJOR → deferred)**
- **Files:** `common/constants.ts:146` (`DECISION_TTL_DAYS = 7`), `functions/src/scheduled/cleanup-st-occurrence-decisions.ts:14` (`DEFAULT_TTL_DAYS = 7`)
- Same value in two places, across the boundary.
- **Suggested fix (deferred):** Move to a shared constant or environment config. Track in #205.

**S9. Duplication — collection path hardcoded (MAJOR → deferred)**
- **File:** `functions/src/scheduled/cleanup-st-occurrence-decisions.ts:20`
- Hardcodes `savant-trader/data/occurrence-decisions` while `ST_OCCURRENCE_DECISIONS_COLLECTION` exists in `st-collections.ts:52`.
- **Suggested fix (deferred):** Import the constant. Track in #205.

**S10. `any` usage in backend (MAJOR → deferred)**
- `signal-persister.ts:54` — `triggeredBy as any` instead of using `StTriggeredBy` union.
- `callables.ts:134` — `catch (error: any)` instead of `catch (error: unknown)`.
- **Rationale:** Pre-existing, not introduced by this diff. Track in #205.

**S11. `StStatus` type mirrored across boundary (MAJOR → deferred)**
- **Files:** `functions/src/common/st-runs.ts:40`, `services/types.ts:21`
- Both define `StStatus` and this diff edits both to remove `isEnabled`.
- **Suggested fix (deferred):** Place a side-effect-free shared type in a `shared/` folder. Track in #205.

**S12. Market-cap tier thresholds hardcoded in UI (MINOR → deferred)**
- **File:** `quick-charts-panel.component.ts:24`
- `marketCapLabel()` hardcodes 200B/10B/2B/300M thresholds while `MarketCapTier` and `MARKET_CAP_TIER_ORDER` exist elsewhere.
- **Suggested fix (deferred):** Centralize. Track in #205.

**S13. `runClicked` misnamed (MINOR → deferred)**
- **File:** `run-history-panel.component.ts:27,38`
- Emitted inside `toggleExpand`, not on a generic click.
- **Suggested fix (deferred):** Rename to `runExpanded` or `expandToggled`. Track in #205.

---

## Spec

### Issue #212 acceptance criteria

| Criterion | Verdict | Notes |
|---|---|---|
| All reported UI/UX issues documented | **Met** | `UAT-SAVANT-TRADER.md` covers every page scenario with pass/fail state, notes, and a Fix List (F1–F8). |
| Each issue fixed or explicitly accepted with a note | **Partial** | Fixed items marked `[x]` with "Fixed:" notes. Unfixed items either tracked in F1–F8 or skipped with `#205`. The `#205` skips are bypasses, not verified acceptances — appropriateness depends on #205 being scheduled. |
| Focused tests pass | **Met** | 74/75 pass; the 1 failure is pre-existing (confirmed by stashing). |
| `npm run build` passes | **Met** | Exit 0. |

### UAT fix list (F1–F8) — tracked but not implemented in this diff

| ID | Description | Status |
|---|---|---|
| F1 | Rename `PAST_SIGNALS` → `Monitor` | Tracked |
| F2 | Redesign "Clear review flags" header button | Tracked |
| F3 | Implement manual order creation (currently toasts) | Tracked |
| F4 | Default limit/stop prices to current price | Tracked |
| F5 | Filter non-numeric/negative input in Qty field | Tracked |
| F6 | Widen limit/stop fields, each on own line | Tracked |
| F7 | Add signal date to order, group queue by date | Tracked |
| F8 | Rename "intent" → "order ticket" | Tracked |

### PRD acceptance criteria map

27 of 30 PRD user stories are **Met**. 2 **Deferred** (target exit staging — obsolete per Robinhood simultaneous-order uncertainty; data migration — explicitly deferred in PRD). 1 **Partial** (review-list collection uses per-symbol doc subcollection rather than the single-doc `symbols map` the PRD described).

Key met items: accepted signals persist across refresh; review flags persist; ACR status reflects durable Firestore decisions; accepted signals stage order intents; signal context pre-fills the order ticket; staged intents persist in Firestore with stable `refId`; queue on left, ticket on right; all Robinhood parameters editable; confirmation dialog before submission; execution status visible; retry/cancel/remove work; stop loss stages as separate sell intent; account number stored in Firestore and used automatically; `rh-agent` renamed to `savant-trader`; all collections under `savant-trader/data/`.

---

## Thermo-nuclear

### Critical findings (must fix before closing #212)

**T1. `acceptSymbol` stale-accept toggle bug (CRITICAL)**
- **File:** `signal-review.facade.ts:347–367`
- `acceptSymbol` checks `acceptedSymbols()`, which is the latest `ACCEPT` across all loaded runs (last N days). When it thinks a symbol is already accepted, it calls `resetSymbol(symbol, runId)` — but that only deletes decisions for the **current runId**. A stale accept from a previous run stays in `occurrenceDecisions`, so `acceptedSymbols()` remains true and the button appears active, but no new accept for the active run is created.
- **Fix:** Determine `isAccepted` from the active run / active market date only. Add an `acceptedInActiveRun()` or `activeStatusBySymbol()` computed to `OccurrenceDecisionStore` and use it for ACR toggles, while keeping cross-run `latestBySymbol()` for display/staleness.

**T2. Review flag gated by `runIfActionable()` (CRITICAL)**
- **File:** `signal-review.facade.ts:336–345`
- `markForReview` wraps itself in `runIfActionable()`, which blocks the action when the viewed run is not the latest completed run. This contradicts `CONTEXT.md`: "Review Flag … independent of the accept/ticket lifecycle. Persists across runs." The same `!isActionableRun()` flag is passed to `SymbolAcrActionsComponent` as the single `disabled` input, so the review button is disabled for historical runs.
- **Fix:** Remove `runIfActionable()` from `markForReview()` and `clearReviewFlags()`. Split the ACR controls from the review/monitor controls in `SymbolAcrActionsComponent` so `disabled()` applies only to ACCEPT/CONSIDER/REJECT/RESET, not the review bookmark.

**T3. `signal-review.facade.spec.ts` will not construct (CRITICAL)**
- **File:** `signal-review.facade.spec.ts:131`
- The spec provides `StStore` as `useValue: {}`, but the façade constructor calls `this.agentStore.latestCompletedRun()` inside an `effect`. `latestCompletedRun` is `undefined` on `{}`, so the effect throws.
- **Fix:** Provide a real-enough mock: `{ provide: StStore, useValue: { latestCompletedRun: signal(null), runs: signal([]), loadData: jasmine.createSpy() } }`.
- **Note:** This spec was not in the focused test run above (it was excluded by the `--include` filters because of the broader pre-existing broken specs). It must be fixed and added to the verified set.

### Major findings (should fix, can defer to #205 with justification)

**T4. `setActiveRun` race condition (MAJOR)**
- **File:** `group.store.ts:145–153`
- `setActiveRun` kicks off `loadReviewFlags()`, `loadRecentDecisions()`, and `loadSymbolsWithSignals()` concurrently. If the user switches runs quickly, `loadSymbolsWithSignals()` can patch `signalSymbols` for an old run over the new one — it captures `runId` at call time but has no per-call cancellation.
- **Fix:** Use a `switchMap` on an `activeRun$` subject, or guard the `next` callback with `if (state.activeRunId() !== requestedRunId) return;`.

**T5. Optimistic updates can be overwritten by in-flight loads (MAJOR)**
- **Files:** `occurrence-decision.store.ts:295–311`, `triage.store.ts:90–106`
- Both `loadRecentDecisions` and `loadReviewFlags` replace the entire map on success. If a user clicks Accept or Review while the initial `setActiveRun` load is still in flight, the load's response (which did not see the new write) overwrites the optimistic local update.
- **Fix:** Add a request-sequence counter and discard responses from loads that started before the most recent local mutation, or merge server responses with local optimistic writes using `decidedAt` ordering.

**T6. Removing `clearDecisions()` not safe for active-run ACR (MAJOR)**
- **Files:** `group.store.ts:149–151`, `occurrence-decision.store.ts:334–337`
- `setActiveRun` no longer calls `clearDecisions()` before `loadRecentDecisions()` (removed to avoid an "empty flash"). Since `loadRecentDecisions` is not scoped to the active run (it fetches the last N days by `decidedAt`), and since it can fail, the previous run's decisions may remain and be used by ACR logic. `clearDecisions()` itself is now dead code.
- **Fix:** Either (a) call `clearDecisions()` then `loadDecisionsForRun(activeRunId)` for in-play ACR, plus `loadRecentDecisions()` only for stale display; or (b) keep `loadRecentDecisions()` but derive an `activeRunDecisions` map for ACR and clear the in-memory map at `setActiveRun`.

**T7. `TriageStore.markForReview` leaks into `screeningStatuses` (MAJOR)**
- **File:** `triage.store.ts:127–149`
- `markForReview()` sets `screeningStatuses[sym] = ReviewDecision.REVIEW` in addition to `reviewFlags[sym] = true`. The comments say `screeningStatuses` is for **ephemeral CONSIDER/WATCH only**. Worse, `loadReviewFlags()` sets only `reviewFlags`, so a symbol flagged on another device loads with `isReviewed = true` but `reviewStatus = PENDING` until toggled locally.
- **Fix:** Remove `screeningStatuses` updates from `markForReview()` and `unmarkFromReview()`. `reviewFlags`/`isReviewed` should be the single source of truth for the bookmark.

**T8. `flatFilteredSymbols` recomputes through heavy `groups()` signal (MAJOR)**
- **File:** `group.store.ts:311–315`
- `flatFilteredSymbols` reads `state.groups()`, which recomputes on every dependency change (~10 signals including `historyCache`, `historyLoading`, `screeningStatuses`, `reviewFlags`, `occurrenceDecisions`). The prev/next navigation list thus changes as individual signal histories finish loading.
- **Fix:** Build `flatFilteredSymbols` from `state.filteredProfiles()` plus `groupDimension`, not from `groups()`.

**T9. `GroupStore.groups` is a cross-store "god computed" (MAJOR)**
- **File:** `group.store.ts:246–276`
- `groups` reads 9+ stores in one computed. Any small change re-runs the full group-build/sort.
- **Fix:** Move view-row assembly (the part needing `historyCache`/`historyLoading`) into the façade or a new `SignalReviewViewStore`. `GroupStore` should own active run, symbol lists, and raw `signalSymbols` only.

**T10. `loadDecisionsForLastNDays` filters client-side (MAJOR)**
- **File:** `occurrence-decision.service.ts:253–270`
- Fetches **all** user decisions and filters by `decidedAt` in memory. For an active user this serializes thousands of docs only to discard most.
- **Fix:** Add a composite Firestore index `(userId, decidedAt)` and query with `where('decidedAt', '>=', cutoff)` plus `orderBy('decidedAt')`.

**T11. `OccurrenceDecisionStore` tests cover the legacy loader (MAJOR)**
- **File:** `occurrence-decision.store.spec.ts`
- The spec only calls `loadDecisionsForRun()` (marked legacy). It does not test `loadRecentDecisions()`, rollback on batch failure, cross-run staleness, or `markRunNotCurrent()`.
- **Fix:** Add tests for the actual production loader and its error/revert paths.

### Minor findings

**T12. `SymbolAcrActionsComponent` disables review with ACR (MINOR)**
- **File:** `symbol-acr-actions.component.ts:24`
- All ACR buttons share one `disabled` input, so the review button is disabled when the run is not actionable. Even after fixing T2 in the façade, the UI component will still suppress it unless the input is split.
- **Fix:** Add a separate `reviewDisabled` input; bind `markForReview` to `false` by default.

**T13. Patch file malformed (MINOR)**
- **File:** `.review-diff.patch`
- The saved patch starts with PowerShell CRLF warning text and is not valid UTF-8. Subagents could not `read` it directly and reviewed the post-change working tree instead.
- **Fix:** Regenerate with `git diff --no-color --binary > .review-diff.patch` in a clean shell.

---

## Recommended next steps

1. **Fix T1, T2, T3 before closing #212** — these are correctness issues in the core review/accept flow that the UAT explicitly exercised.
2. **Decide on T4–T11** — either fix in this diff or explicitly defer to #205 with a note in the UAT doc.
3. **Decide on F1–F8** — either implement in this diff or accept as tracked post-UAT work.
4. **Confirm #205 is scheduled** — the `SKIP #205` items in the UAT are only appropriate if #205 will actually remove the old CONSIDER/REJECT/RESET buttons.
5. **Regenerate the patch file** as plain UTF-8 so future reviews can read it.
