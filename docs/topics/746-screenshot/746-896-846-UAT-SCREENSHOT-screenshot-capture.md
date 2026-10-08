# UAT — Screenshot Capture: Lifecycle Tracking Fields & Helpers (#846)

**Topic:** Screenshot Capture  
**Topic Slug:** screenshot-capture  
**Thread:** Order Lifecycle Capture  
**Blueprint:** #842  
**Task:** #846  
**QA Issue:** #896  
**Domain:** SCREENSHOT  
**Type:** UAT  
**Status:** Complete  
**Created:** 2026-10-09  
**Last Updated:** 2026-10-09  

## Scope

#846 adds the shared lifecycle-tracking contracts and the narrow tracking
module that #847/#849 consume: `LifecycleCarrier`/`CapturedEventEntry`/
`ScreenshotIndexEntry`/`OrderIntentTrackingFields` in
`shared/screenshot-capture-contracts.ts` (single FE+functions source),
`functions/src/screenshot-capture/tracking.ts` (carrier/path builders +
intent-doc tracking I/O behind a `TrackingDb` seam), `BaseOrderTicket extends
OrderIntentTrackingFields`, and `Collection.ST_SCREENSHOTS`. No runtime wiring
— ticket-writing of `role`/`linkedPositionId` lands in #849, call sites in
#847.

## Evidence

- `npx jest tests/functions/screenshot-capture --coverage=false` —
  **8 suites / 157 tests green**, incl. `tracking.spec.ts` (10 tests: carriers,
  doc paths, read/write round-trips, merge semantics, `readCapturedEvents`,
  and the explicit-`undefined` strip regression added during review).
- `cd functions && npx tsc --noEmit` — clean (cross-module contract usage:
  `lifecycle-capture.ts`, `tracking.ts`, `st-collections.ts` re-export).
- `npx tsc --noEmit -p tsconfig.app.json` — clean (FE: `BaseOrderTicket`
  extends shared fields, `Collection.ST_SCREENSHOTS`).

## Scenario checks

| Criterion | Evidence | Result |
|---|---|---|
| Tracking contracts shared FE+BE, one source | contracts module + re-exports; both `tsc`s consume them | PASS |
| Carriers for intent + engine-position | `intentCarrier`/`enginePositionCarrier` spec tests | PASS |
| Anchored paths: `savant-trader/data/order-intents/{id}`, `st-screenshots/{id}` | `intentDocPath`/`screenshotIndexDocPath` spec tests | PASS |
| Narrow db seam (testable, no admin import) | `TrackingDb` interface; fake-doc spec | PASS |
| No explicit `undefined` in Firestore payloads | undefined-strip in `writeIntentTracking` + regression test | PASS |
| Ticket types carry fields without forcing unrelated consumers | `BaseOrderTicket extends OrderIntentTrackingFields`; FE `tsc` clean | PASS |
| No premature wiring (scope guard) | no call sites added; #847/#849 boundary held | PASS |

## Live Firestore/GCS

Deferred to **#848** (real-bucket verification) — same deferral as #845; this
task has no runtime call path to exercise live.

## Verdict

**PASS** — #846 accepted, ship-eligible.
