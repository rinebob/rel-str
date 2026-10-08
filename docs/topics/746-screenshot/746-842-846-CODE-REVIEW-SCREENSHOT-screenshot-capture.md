**Topic:** On-demand Screenshot Capture  
**Topic Slug:** screenshot-capture  
**Thread:** Screenshot Auto-capture with Orders  
**Thread Slug:** order-lifecycle-capture  
**Issue:** #842  
**Thread Parent:** #826  
**Topic Parent:** #746  
**Task:** #846  
**Domain:** SCREENSHOT  
**Type:** CODE-REVIEW  
**Status:** Approved  
**Created:** 2026-10-07  
**Last Updated:** 2026-10-07  

# Code Review — Tracking fields + st-screenshots index types (#846)

## Verdict: **PASS** (1 remediation round)

Round 1: Standards **PASS** · Spec **PASS** · Adversarial **FAIL** — one
finding remediated in-loop, re-verified green.

## Scope reviewed

- `shared/screenshot-capture-contracts.ts` — Lifecycle tracking section:
  `ST_SCREENSHOTS_COLLECTION`, `CAPTURED_EVENTS_FIELD`,
  `CapturedEventEntry`, `LifecycleCarrier`, `ScreenshotIndexEntry`,
  `OrderIntentTrackingFields`.
- `functions/src/screenshot-capture/tracking.ts` (new) — carrier builders
  + intent tracking-field I/O behind the `TrackingDb` seam.
- `functions/src/screenshot-capture/lifecycle-capture.ts` — local types
  replaced by the shared ones (re-exported, no importer churn).
- `functions/src/common/st-collections.ts` — `ST_SCREENSHOTS_COLLECTION`
  re-export.
- `src/app/features/savant-trader/services/order-ticket.types.ts` —
  `BaseOrderTicket extends OrderIntentTrackingFields`.
- `src/app/core/common/constants.ts` — `Collection.ST_SCREENSHOTS`.
- `tests/functions/screenshot-capture/tracking.spec.ts` — 10 cases.

## Axes

**Standards — PASS.** Shared contract is the right home (the alias is
already the FE↔functions boundary); tracking seam mirrors the ledger
pattern; `Collection` enum member follows convention; contract file stays
pure types/consts — no admin imports leak into the FE bundle.

**Spec — PASS.** All #846 boxes: intent fields typed and shared, index
collection writer (shipped in #845) + doc-path builder, rules coverage
done (`st-screenshots` block shipped #845; the intent rule is user-scoped
CRUD and does not pin field shape — no rules change needed, recorded).

**Adversarial — FAIL→PASS.**

1. **M1 (fixed):** `writeIntentTracking` spread `fields` verbatim into a
   merge-`set` — an explicit `{linkedPositionId: undefined}` would hit
   Firestore's "cannot use undefined" error. Same trap class as #845's
   index-doc fix. Now strips `undefined` keys first (matches the FE
   `stripUndefined` convention); covered by a spec case.

**Noted:** `screenshotIndexDocId` (lifecycle-capture) and
`screenshotIndexDocPath` (tracking) live in sibling modules by design —
the id is an intake concern, the path a storage-layout concern.

## Evidence

- `npx jest tests/functions/screenshot-capture --coverage=false` — **157/157**
- `npx tsc --noEmit` (functions) — clean; FE `tsc` — clean
- `typecheck:tests` shows unrelated pre-existing errors in the user's
  in-flight rh-agent-mcp specs only.
