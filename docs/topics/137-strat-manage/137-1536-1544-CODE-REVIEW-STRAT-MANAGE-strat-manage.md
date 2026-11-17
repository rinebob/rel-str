**Topic:** Strategy Builder UI  
**Topic Slug:** strat-manage  
**Thread:** OpsStrat Manage Page Overhaul  
**Thread Slug:** page-overhaul  
**Issue:** #1536  
**Thread Parent:** #1510  
**Topic Parent:** #137  
**Task:** #1544  
**Domain:** STRAT-MANAGE  
**Type:** CODE-REVIEW  
**Status:** Complete  
**Created:** 2026-11-17  
**Last Updated:** 2026-11-17  

# Code Review — #1544 BE: Manage exit-scan pass

## Scope reviewed

New: `paper-trading/engine/passes/manage-exit-scan-pass.ts`
(`runManageExitScan` + `scanInstance` + `scanPosition` +
`positionExitRecord` + `buildNetSeries`/`netMark`),
`options-strategy-engine/passes/manage-exit-scan-pass.ts` shim,
`manage-exit-scan-pass.test.ts` (22 specs),
`strat-manage-exit-scan-1544.{ts,md}` verify harness (34 checks).
Modified: `open-pass-timer.ts` (`manageExitScanTimer` 2 PM PT cron),
`index.ts` export, `options-analysis/start.ts` (manual-rerun gate +
`pickDocMeta` on the list view), `options-analysis/start.test.ts`
(gate spec + real `PickDocMeta` fixtures), `run-all.ts`/`README.md`
registry entries, IMPL §3 as-built + post-review note. Foreign
in-flight edits elsewhere in the tree were excluded.

## Axes

### Standards — PASS (1 major + 6 minors fixed in-cycle)

- **FIXED (major)** per-instance failure isolation — an unguarded
  `listOpenPositions`/`writeResultDoc` throw aborted the whole day's
  matrix for every later instance (once-daily timer, no retry). The
  instance body is now `scanInstance` wrapped in try/catch → warn +
  continue, matching `optionsMarkPass`'s documented rationale.
- **FIXED** `parseMark` accepted `''`/`' '` as `0.00` — a blank SA mark
  fabricated a real bar that could spuriously fire price rules
  (worker's `toScanBars` trims first).
- **FIXED** bar dates normalized `o.date.slice(0,10)` + clipped to
  `[openDate, endBound]` (worker parity — an ISO datetime would have
  degraded outcomes to `error`).
- **FIXED** `'expired'` `terminalMark` = intrinsic, matching the
  worker's documented contract ("the mark the outcome's economics
  resolved at") — was the possibly-stale expiry-bar mark.
- **FIXED** `resp.ok === false` → error records (worker treats it as
  fetch failure; a partial-series `ok:false` was silently trusted).
- **FIXED** uniform fetch-failure error — a throw on the last leg
  previously fell through to a misleading "no net series" message.
- **FIXED** `loadUnderlyingClose` hoisted per instance (was per
  position), `generatedAt` hoisted per run, `!leg.contractID` hoisted
  before the fetch loop.
- Unused test import removed; `PickDocMeta` test fixtures corrected to
  the real shape (`coordinate{type,targetDelta,expiry}` + `missCount`).

### Spec — PASS-WITH-NITS → PASS (3 minors fixed in-cycle)

- **FIXED** same-day-opened positions produced `'error'` records on
  their first scan (noon open → 2 PM scan; the EOD corpus can't carry
  an entry-day bar). `openDate >= today` → null → warn-skip.
- **FIXED** timer moved `30 13` → `0 14` PT: under PDT the mark-pass's
  UTC grid ends 13:30 PT — the old slot fired at the same minute as
  the last mark tick. Ceremonial (the scan reads the SA corpus, not
  persisted marks) but "after mark-pass" is now literal year-round.
- **FIXED** `loadUnderlyingClose` per instance (was per position);
  added a warn when the close map is empty (silent symbol-data outage
  → every 'expired' degrades to 'error' — worker logs the same event).
- **NOTE (accepted)** real-mode evaluates nothing + warns — the AC's
  "configured stopType" has no registry `exitId` mapping yet
  (`STOP_CODES` is placeholder `T8`; `getExitStrategy('T8')` is
  undefined) and the reader gates to paper-only, so the branch is
  prod-unreachable. Satisfied-in-spirit for v1.
- **NOTE (accepted)** `expiredItm` = net intrinsic > 0 and
  `assignmentDistancePct` = max per-leg distance — a defensible
  package generalization of per-leg flags; v1 catalog is
  short-premium.
- **NOTE (accepted)** SA-corpus rebuild vs "extend its mark series" —
  the only viable reading: `listActiveInstances` excludes manage docs
  so mark-pass never marks them, and `markPosition` is single-leg.
  Mirrors the worker's own source.

### Thermo — PASS-WITH-NITS → PASS (1 major + 3 minors fixed in-cycle)

- **FIXED (major — F1 doc-id collision)** `optionsAnalysisStart` on a
  manage contract-list doc would enqueue the replay worker, which
  writes per-LEG contract-grain records over the pass's per-POSITION
  docs at the same `{instanceId}_{exitId}` ids (last-writer-wins; the
  results UI silently flips grain). Fixed by gating the callable:
  synthetic `pickDocMeta` (`gridVersion === 0` — the marker #1543
  stamps) → `failed-precondition`. The pass is the sole writer of the
  manage result space.
- **FIXED (F2)** mixed-expiry legs → `error` records — intrinsic of a
  still-open far leg isn't its terminal worth; v1 templates are
  same-expiry.
- **FIXED (F4)** non-finite `intrinsic`/`assignmentDistancePct` (e.g.
  `close: 0` in symbol-data) → `error` record — Firestore rejects
  `Infinity`, which would have aborted the instance's doc loop mid-run.
- **FIXED (F5)** warn when `underlyingClose` is empty (the default
  loader swallows outages into `[]`).
- **NOTE (accepted — F3)** open positions never close in v1, so
  series fetches grow linearly forever; sequential per-leg fetches
  each mint a Google ID token (~0.7–1.5 s/leg) inside a 540 s timer.
  Fine at v1 scale; flagged as a structural follow-up (skip
  already-terminal positions, token caching, concurrency).
- **NOTE (accepted — F7/F8/F9/F10)** debit `entryMark` semantics make
  credit-native rules fire day-0 (registry-side concern, disclosed in
  the module header); same-day expiry writes 'error' (worker-parity
  convention, self-heals); entry-day head-check is per-leg amplified
  (worker convention); greeks not yet populated on records
  (net-greeks definition needed — later task).

## Verdict

**PASS.** 22/22 specs + 15/15 `start.ts` specs + 34/34 verify checks,
`tsc --noEmit` clean on the task surface (residual errors are the
foreign #1563 verify harness). One major per axis found and fixed
in-cycle; all remaining findings are documented accepts or v2 seams.
