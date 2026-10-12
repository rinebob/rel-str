# CODE-REVIEW — Order exec: order-placed/immediate-fill capture hook (#850)

**Topic:** On-demand Screenshot Capture  
**Topic Slug:** screenshot-capture  
**Thread:** Order Lifecycle Capture  
**Blueprint:** #843  
**Task:** #850  
**Domain:** SCREENSHOT  
**Type:** CODE-REVIEW  
**Status:** Complete  
**Created:** 2026-10-09  
**Last Updated:** 2026-10-09  

## Verdict: PASS

## Scope

Reviewed only the #850 hunks in `order-execution.service.ts` +
`order-execution.service.spec.ts` (imports, `ScreenshotService` inject,
the `captureOrderSnapshot` call at the success return, the private
method, and the `screenshot capture (#746)` describe block). The same
files carry unrelated in-flight work (#886/#887 stop-order hardening) —
that work is out of scope here.

## Rescope context

#850 was rescoped (issue comment, 2026-10-08): the lifecycle
auto-capture design (carriers, intent-doc `role`/`linkedPositionId`/
`signalId` lineage — #849) was dropped in favor of caller-driven
capture. The hook now passes `refId`/`groupId` = `ticket.refId`
directly; `captureChartSnapshot` remains the single capture surface.

### Checklist deltas vs. pre-rescope checklist (all accounted for)

- `refId={intentRefId}-placed`, `groupId=intentRefId` → superseded:
  both = `ticket.refId`. Dedup key is `{refId}-{event}`, so a
  placed→filled sequence on the same ticket files two distinct
  captures; a same-refId retry is idempotent (verified in #848).
- "market orders skip placed" → superseded: the event now reflects the
  observed outcome — a resting-but-unfilled order of any type gets
  `order-placed`; only a synchronous terminal `filled` gets
  `order-filled`. A market order that doesn't fill immediately is
  genuinely "placed and resting" — semantically more accurate.
- "D+W intervals" → omitted from the call; the callable defaults to
  `['daily','weekly']`, so the contract is unchanged.

## Standards

- `captureOrderSnapshot` is a 20-line single-purpose private method
  placed among the service's helpers; comment documents the
  fire-and-forget contract and the error-swallow rationale (Topic #746).
- `.subscribe({ error })` on a completing cold observable — no leak.
- No capture on any failure path: the call sits immediately before
  `return { success: true }`, after every `PLACEMENT_DEAD` /
  `PLACEMENT_UNCONFIRMED` guard — dead, ambiguous, rejected, and
  unparseable placements can't reach it.
- One hook covers all order paths: `submitEquityOrder` is the shared
  seam for initial placements, stop-loss orders, and
  `updateEquityStopOrder` replacements.
- Spec follows the file's existing jasmine-shim conventions.

## Spec

| Acceptance (rescoped) | Result |
|---|---|
| Accepted/resting order → `order-placed` | met — spec asserts full payload |
| `state='filled'` → `order-filled` | met |
| No capture on placement failure | met |
| Capture failure swallowed — ExecutionResult unaffected | met |
| Spec coverage in order-execution.service.spec.ts | met — 4 new tests |

## Findings

- **Minor (remediated in-loop):** a synchronous throw inside
  `captureChartSnapshot$` would have propagated through
  `submitEquityOrder`'s outer catch and flipped a successful placement
  to failure — violating the stated "capture must never affect the
  order path" contract. `captureOrderSnapshot` now wraps the call in
  try/catch; observable errors still route through the error handler.
- **Nit:** `partially_filled` (a live success state) captures as
  `order-placed`, not `order-filled` — correct per the settled model
  (terminal fill only).

## Test results

- `order-execution.service.spec.ts` — **59/59** (includes the 4 new
  capture cases).
- `tsc -p tsconfig.app.json --noEmit` — clean.

## Next

`/proj qa 746 850` — acceptance scenarios: place a small limit order
and verify the artifact lands in `st-trade-screenshots/{symbol}/{refId}`;
cancel before fill; a filled market order shows `order-filled`.
