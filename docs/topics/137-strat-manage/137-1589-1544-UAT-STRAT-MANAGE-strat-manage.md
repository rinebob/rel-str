**Topic:** Strategy Builder UI  
**Topic Slug:** strat-manage  
**Thread:** OpsStrat Manage Page Overhaul  
**Thread Slug:** page-overhaul  
**Issue:** #1589  
**Thread Parent:** #1510  
**Topic Parent:** #137  
**Task:** #1544  
**Domain:** STRAT-MANAGE  
**Type:** UAT  
**Status:** Complete  
**Created:** 2026-11-17  
**Last Updated:** 2026-11-17  

# UAT — #1544 BE: Manage exit-scan pass

## Getting to the feature

Not applicable — backend scheduled pass with no UI surface. The
`manageExitScanTimer` (2:00 PM PT, Mon–Fri — after the mark-pass grid)
iterates ACTIVE manage instances and, for every OPEN position,
evaluates the shared `EXIT_STRATEGIES` registry against a signed net
cost-to-close series built from each leg's SA contract series. It
writes one `AnalysisResultDoc` per `(instanceId, exitId)` to
`st-options-analysis-results/{instanceId}_{exitId}` — the exit matrix
the manage page's analysis view reads. QA acceptance is at the
contract/verification level: result-doc shape, outcome mapping, skip
semantics, and the manual-rerun guard.

## Scenarios

### S1 — Verify script passes standalone

1. Run `npx tsx scripts/verify/strat-manage-exit-scan-1544.ts`
2. **Expect:** every check prints `OK   name: value`, ends
   `All checks passed`, exit 0. Covers: signed net series
   (short `+mark`, long `−mark`; inner join drops dates missing from a
   leg; entry net 1.50 decaying to 0.125), all four outcomes
   (`target-90` fires `exit` on 2026-02-06 at 0.125 ≤ 0.15;
   `expiry` stays `open` on a live series; `expired` at the expiry bar
   with net intrinsic 0 OTM / ITM case in specs; empty series →
   `error`), `scanPosition` degradation (fetch failure → error
   records; missing `contractID` → null skip; opened-today → null
   skip; mixed-expiry → error), and end-to-end doc writes — 6 docs at
   `QQQ-PCS-28-30-15-ALL_{exitId}` with `contractListDocId`/`runId` =
   instanceId, `templateId` `pcs`, `registryVersion` 2,
   `status` success, observability stamp.
   **Result: PASS — 34/34 checks.**

### S2 — Specs pass

1. Run (from repo root):
   `npx tsx --test tests/functions/options-strategy-engine/manage-exit-scan-pass.test.ts tests/functions/options-analysis/start.test.ts`
2. **Expect:** all green — net-series math, `exit`/`expired`/`open`/
   `error` outcome mapping incl. net-intrinsic ITM expiry
   (short 480p intrinsic 20 − long 470p intrinsic 10 = 10, distance
   20/460×100), fetch-failure + `ok:false` + blank-mark + ISO-date
   normalization, same-day-open and missing-contractID skips,
   non-paper gate, per-instance isolation (one instance's write
   failures don't stop the next), and the `optionsAnalysisStart`
   `gridVersion === 0` rejection.
   **Result: PASS — 22/22 + 15/15 tests.**

### S3 — Types + functions build

1. `cd functions && npx tsc --noEmit`
2. `cd functions && npm run build`
3. **Expect:** clean on the task surface (the only residual `tsc`
   errors are the foreign #1563 stats verify harness).
   **Result: PASS — both clean.**

### S4 — Timer wiring

1. `grep -n "manageExitScanTimer" functions/src/index.ts` → exported
   (line 158)
2. `functions/src/paper-trading/engine/passes/open-pass-timer.ts` →
   `schedule: '0 14 * * 1-5'` `America/Los_Angeles`, 512 MiB, 540 s,
   **no** `secrets` (SA corpus fetch only — no RH session)
3. **Expect:** scheduled entry point only; no manual/caller path.
   **Result: PASS.**

### S5 — Manual-rerun guard

1. `optionsAnalysisStart` on a manage contract-list doc — asserted in
   `start.test.ts` ('synthetic manage doc (gridVersion 0) →
   failed-precondition, zero enqueues').
2. **Expect:** `failed-precondition` with an "exit-scan" message —
   the pass is the sole writer of the `{instanceId}_{exitId}` result
   space (per-leg worker records would silently flip the matrix's
   grain).
   **Result: PASS.**

### S6 — Registry auto-apply

1. The pass iterates the live `EXIT_STRATEGIES` array and stamps
   `registryVersion` — the verify script asserts a doc per registry
   entry (6 today: `target-90`, `price-100`, `price-50`, `stop-200`,
   `dte-21`, `expiry`).
2. **Expect:** a new registry entry produces a new
   `{instanceId}_{exitId}` doc with no pass changes.
   **Result: PASS — 6/6 docs emitted.**

## Result

**Complete** — all scenarios pass. #1544 is ready to ship.

## Notes

- Real-mode `stopType` mapping is a v2 seam (placeholder vocabulary);
  non-paper instances warn + evaluate nothing today.
- Positions never close in v1, so the daily fetch cost grows linearly
  with open-position count — flagged as a structural follow-up (skip
  terminal positions / token caching / concurrency) before ladders
  make it a timeout risk.
- Debit-entry semantics: credit-native rules can fire day-0 on a
  negative `entryMark` — documented in the module header as a
  registry-side concern, not a pass bug.
