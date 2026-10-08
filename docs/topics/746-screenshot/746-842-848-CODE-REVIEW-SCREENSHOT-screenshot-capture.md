# CODE-REVIEW — Verify: Lifecycle Capture Verify Script + Run-All Wiring (#848)

**Topic:** On-demand Screenshot Capture  
**Topic Slug:** screenshot-capture  
**Thread:** Order Lifecycle Capture  
**Blueprint:** #842  
**Task:** #848  
**Domain:** SCREENSHOT  
**Type:** CODE-REVIEW  
**Status:** Complete  
**Created:** 2026-10-09  
**Last Updated:** 2026-10-09  

## Verdict: PASS

## Scope reviewed

- `functions/scripts/verify/screenshot-capture-826-lifecycle.ts` (new) —
  seeded scratch carrier + synthetic `order-filled` through the real
  `createLifecycleCaptureDeps` seams; 24 assertions over outcome, bucket
  objects, carrier `capturedEvents` manifest, `st-screenshots` index doc,
  and dedup rerun.
- `functions/scripts/verify/screenshot-capture-826.md` (new) — per-task
  guide (usage, side effects, pass/fail semantics).
- `functions/scripts/verify/run-all.ts` — registered after
  `screenshot-capture-844-contracts.ts`.
- `functions/scripts/verify/README.md` — table row + order-list entry
  (renumbered trailing entries).

No production source files changed.

## Standards

- Verify-script conventions match the siblings (`screenshot-capture-768`,
  `844`): header comment with task/issue, argv `[SYMBOL]` default `GOOG`,
  `check()` tally + `process.exitCode`, artifacts printed as `gs://` URIs,
  real ADC path (no emulator).
- **FIREBASE_CONFIG seeding (lines 32–44):** `initializeApp()` picks up
  `storageBucket` only from `FIREBASE_CONFIG`, which Cloud Run sets and
  local shells don't; `createLifecycleCaptureDeps` writes through the
  default bucket. The `??=` + dynamic-import ordering is the minimal,
  honest fix and is commented. Alternative (an optional bucket param on
  `createLifecycleCaptureDeps`) was rejected — it would mutate shipped
  #845 surface to serve a verify script.
- **Scratch carrier path** `st-screenshot-verify/826-lifecycle`: even
  segment count (collection/doc), `st-` domain prefix, outside any real
  anchored collection — no query/rule interference.
- Two findings fixed in-loop before this review:
  - duplicated `LifecycleCaptureInput` literal → hoisted to a typed
    `input` const (also keeps contextual `CaptureInterval` typing);
  - three assertions could pass vacuously on a failed capture
    (`[].every` → true, `[] === []`) → now gated on non-empty paths /
    `Array.isArray`.
- Remaining nit (accepted): `check('index id is {groupId}-{refId}-{event}')`
  partially restates `screenshotIndexDocId`'s own contract; kept as a
  legibility anchor — the meaningful assertion is `indexSnap.exists` at
  the deterministic id the intake computed independently.

## Spec (task #848 + TEST doc integration section)

| Requirement | Result |
|---|---|
| Seeded carrier + synthetic event → real Firestore + real bucket | ✔ carrier seeded at scratch path; real capture ran |
| GCS objects under `st-trade-screenshots/{sym}/{groupId}/` | ✔ asserted (2 objects, contentTypes) |
| `capturedEvents` manifest entry on the carrier doc | ✔ `captured` + claimedAt/capturedAt + paths |
| `st-screenshots` index doc present | ✔ deterministic `{groupId}-{refId}-{event}` id, all fields asserted |
| Second invocation is a no-op | ✔ `skipped-duplicate`, zero new objects, index `updateTime` unchanged |
| Registered in `run-all.ts` + README row | ✔ |
| Anchor doc links verified | ✔ all 5 Thread #826 doc links resolve on disk |

## Thermo-nuclear

- ~200 lines, one `main()`, no abstraction overhead — right-sized for a
  verify artifact.
- The dynamic-import dance is the only structural oddity; it is forced by
  import hoisting vs env ordering and documented at the site.
- Timeout override (`timeoutMs: 120_000`) is honest: the cap is
  caller-side accounting and doesn't weaken intake guarantees.

**Live-run observation (not a defect of this task):** first (cold) run
took 24.6s; warm run 7.0s. The 10s `LIFECYCLE_CAPTURE_TIMEOUT_MS` shipped
in #845 is tighter than a cold local capture — locally a lifecycle capture
would take the failed-marker → artifact-lands-anyway → retry path. On
Cloud Run the same-VPC path is expected to be well under 10s; worth a
spot-check once #850 wires live order hooks.

## Test results

- Verify script run against production: **24/24 checks passed** (twice —
  cold 24.6s and warm 7.0s runs both green).
- `npx tsc -p functions/tsconfig.json --noEmit` — clean (scripts/verify is
  inside the tsconfig).
- Unit suites unchanged: no `src/` or `tests/` files touched; the intake's
  jest suite (157) and paper-trading suite (168) were green at #847 ship
  with an identical source tree.
