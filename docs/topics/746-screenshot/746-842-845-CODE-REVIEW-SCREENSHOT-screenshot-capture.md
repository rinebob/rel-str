**Topic:** On-demand Screenshot Capture  
**Topic Slug:** screenshot-capture  
**Thread:** Screenshot Auto-capture with Orders  
**Thread Slug:** order-lifecycle-capture  
**Issue:** #842  
**Thread Parent:** #826  
**Topic Parent:** #746  
**Task:** #845  
**Domain:** SCREENSHOT  
**Type:** CODE-REVIEW  
**Status:** Approved  
**Created:** 2026-10-07  
**Last Updated:** 2026-10-07  

# Code Review — Lifecycle intake (`captureLifecycleEvent`) (#845)

## Verdict: **PASS** (1 remediation round)

Round 1: Standards **PASS** · Spec **PASS** · Adversarial **FAIL** — one real
finding remediated in-loop, re-verified green.

## Scope reviewed

- `functions/src/screenshot-capture/lifecycle-capture.ts` (new) — intake:
  transactional dedup claim → await-capped capture → manifest + index commit.
- `functions/src/screenshot-capture/capture-chart.ts` — `executeCaptureChart`
  extracted (pipeline minus auth/wire-parse) so the intake calls in-process.
- `functions/src/common/st-collections.ts` — `ST_SCREENSHOTS_COLLECTION`.
- `firestore.rules` — `st-screenshots` read-auth / write-false block.
- `tests/functions/screenshot-capture/lifecycle-capture.spec.ts` — 15 cases.

## Axes

**Standards — PASS.** Mirrors the paper-trading ledger seam pattern
(`transact` work-callback + map-backed fake in specs), file-header docblock,
shared-contract imports via alias, rules block follows the backend-written /
FE-read-only convention.

**Spec — PASS.** Every #845 acceptance box is covered: input shape
(`refId` optional, derived `{positionId}-{event}` per the TEST doc's mapping
line), transactional pending→captured ledger, ~10s await cap, failed marker
retryable, deterministic index id `{groupId}-{refId}-{event}`, both carrier
kinds, nothing propagates.

**Adversarial — FAIL→PASS.** Findings:

1. **M1 (fixed):** the index entry wrote `groupId: input.groupId`
   unconditionally — a real Firestore `set` throws on explicit `undefined`,
   so an ungrouped capture would write artifacts, fail the commit txn
   (swallowed), leave `pending` to go stale, and rewrite duplicate artifacts
   on retry. Fixed with a conditional spread; spec now asserts the key is
   absent when `groupId` is.
2. **Nit (fixed):** `failed` markers now carry `failedAt` (field was declared
   but never set).

**Noted, accepted per IMPL:** index doc id doubles the event suffix when
`refId` already ends in `…-{event}` (`pos-1-order-filled-order-filled`) —
deterministic and matches the documented pattern. A timed-out capture may
still write artifacts in the background; dedup/marker semantics make that
benign and it is documented in the module header.

## Evidence

- `npx jest tests/functions/screenshot-capture --coverage=false` — **147/147**
- `npx tsc --noEmit` (functions) — clean
- `npm run build` (functions, esbuild) — clean
- Live-bucket verification is task **#848**'s scope per the blueprint.
