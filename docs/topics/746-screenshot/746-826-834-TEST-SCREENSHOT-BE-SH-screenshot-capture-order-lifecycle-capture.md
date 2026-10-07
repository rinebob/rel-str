**Topic:** On-demand Screenshot Capture  
**Topic Slug:** screenshot-capture  
**Thread:** Screenshot Auto-capture with Orders  
**Thread Slug:** order-lifecycle-capture  
**Issue:** #834  
**Thread Parent:** #826  
**Topic Parent:** #746  
**Domain:** SCREENSHOT  
**Type:** TEST (BE-SH)  
**Status:** Draft  
**Created:** 2026-10-06  
**Last Updated:** 2026-10-06  

# TEST (BE-SH) — Order Lifecycle Auto-Capture

## Unit targets (jest, `tests/functions/screenshot-capture/` + `tests/functions/paper-trading/`)

**Contract / parse:**
- `groupId` accepted on spec; absent → flat path (existing shape preserved).
- New `PositionType` values accepted; unknown rejected.
- Path builder emits `{sym}/{groupId}/{ts}-{event}-{positionType}-{refId}-{interval}.{ext}` when groupId present.

**`captureLifecycleEvent`:**
- Happy path: dedup claim → capture invoked with `renderOnly:false` → `capturedEvents` entry written `{event, capturedAt, paths}` → `st-screenshots` index doc written with deterministic id.
- Dedup: second call same `(carrier, event)` → `skipped-duplicate`, capture core NOT invoked.
- Concurrent triggers: only one wins the transaction claim; loser skips.
- Capture failure (throw / timeout): caller resolves `{ok:false}`, error logged, `failed` marker written so a later trigger CAN retry — not wedged.
- Carrier variants: `intent` doc path vs `engine-position` doc path both ledger correctly.
- Event→refId mapping: `order-filled`/`position-closed`/`order-placed` compose `{positionId}-{event}` correctly.

**Engine hooks:**
- `applyEntryFill` fires `order-filled` with position/trade id; groupId=cohortId when cohort present.
- `applyExitFill` and `markPositionSettled` fire `position-closed` on terminal statuses (`CLOSED`, `EXPIRED_WORTHLESS`, `ASSIGNED_HOLDING_SHARES`); non-terminal status writes do NOT fire.
- `paperSignalOrder` happy path produces an entry capture via the shared ledger hook (no bespoke call).
- Capture hook failure inside a pass/callable does not fail the operation (swallow-and-log) — assert pass result still returned.

## Integration / verify

- `functions/scripts/verify/screenshot-capture-826-lifecycle.ts` — seeded carrier doc + synthetic event → real Firestore + real bucket write → assert: GCS objects exist under `st-trade-screenshots/{sym}/{groupId}/`, `capturedEvents` manifest entry on doc, `st-screenshots` index doc present, second invocation is a no-op.
- Registered in `scripts/verify/run-all.ts` + `scripts/verify/README.md` row.

## Edge cases

- Missing/insufficient bars → `failed-precondition` logged, carrier doc marked `failed`, no artifacts, order flow unaffected.
- Options position → underlying symbol used; strategy `positionType` tag in path.
- `groupId` absent (ad-hoc) → flat path, index doc still written.
- Detector double-call (terminal state re-observed) → dedup no-op.
