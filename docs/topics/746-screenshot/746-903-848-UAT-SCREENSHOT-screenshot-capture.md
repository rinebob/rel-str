**Topic:** On-demand Screenshot Capture  
**Topic Slug:** screenshot-capture  
**Thread:** Order Lifecycle Capture  
**Issue:** #903  
**Thread Parent:** #826  
**Topic Parent:** #746  
**Task:** #848  
**Domain:** SCREENSHOT  
**Type:** UAT  
**Status:** Complete  
**Created:** 2026-10-09  
**Last Updated:** 2026-10-09  

# UAT — Lifecycle-Capture Verify Script (#848 / QA #903)

## Scope

Task #848 adds the live-verification artifact for the order-lifecycle
capture intake (#845): `functions/scripts/verify/screenshot-capture-826-lifecycle.ts`.
The script is the deliverable — UAT confirms it runs against production,
asserts the full ledger contract (carrier manifest + `st-screenshots`
index + bucket objects), proves rerun dedup, and is wired into the
verify-suite registry (`run-all.ts` + README + per-task guide).

Reference: `docs/topics/746-screenshot/746-842-848-CODE-REVIEW-SCREENSHOT-screenshot-capture.md` (PASS).

## Prerequisites

- `gcloud auth application-default login` (or `GOOGLE_APPLICATION_CREDENTIALS`)
  for the `rel-str` project — Firestore + GCS writes are real.
- `cd functions` — the script runs via `npx tsx` from the functions dir.
- `NODE_OPTIONS="--require C:\Users\bob\.config\node\ipv4-only.cjs"` on
  this workstation (IPv6 workaround — see AGENTS.md).

## Side effects (documented, intentional)

Each run leaves run evidence and resets the ledger docs at start so
reruns capture fresh:

- Scratch carrier doc `st-screenshot-verify/826-lifecycle` (kind
  `engine-position`, fields: `kind: 'verify-scratch'`, `note`,
  `seededAt`, plus `capturedEvents` after the run).
- Index doc `st-screenshots/verify-826-lifecycle-verify-826-carrier-order-filled-order-filled`.
- Two timestamped objects per run under
  `gs://rel-str.appspot.com/st-trade-screenshots/{SYMBOL}/verify-826-lifecycle/`
  (SVG + PNG).

None of these touch live trading data — the scratch collection and the
`verify-826-lifecycle` group id are verify-only.

## Scenarios

### 1. Happy-path lifecycle capture — real Firestore + real bucket

**Feature:** the full intake contract end-to-end on production seams.

```
cd functions
npx tsx scripts/verify/screenshot-capture-826-lifecycle.ts [SYMBOL]   # default GOOG
```

Expected output shape (all `✔`, exit 0):

- `— outcome —`: `outcome is captured`; `daily interval → svg + png
  artifacts`; `paths nest under {symbol}/{groupId}/`.
- `— bucket —`: both artifacts exist; `contentType image/svg+xml` +
  `contentType image/png`.
- `— carrier manifest —`: `capturedEvents` entry present; `status
  captured`; `claimedAt + capturedAt`; `paths match outcome`.
- `— st-screenshots index —`: doc exists at
  `verify-826-lifecycle-verify-826-carrier-order-filled-order-filled`;
  positionId/refId/event/symbol/positionType/groupId/carrier/paths all
  asserted.
- `— dedup rerun —`: `second call is skipped-duplicate`; `no new objects
  written`; `index doc untouched`.
- Trailer: `24/24 checks passed` + two `gs://` artifact URIs.

**Result:** PASS — 24/24 on the QA-phase run, 2026-10-08 ~04:36 UTC
(`order-filled` on GOOG, capture 11.6s; artifacts
`gs://rel-str.appspot.com/st-trade-screenshots/GOOG/verify-826-lifecycle/2026-10-08-043616-order-filled-option-single-verify-daily.{svg,png}`).

### 2. Rerun idempotency of the script itself

Run the same command a second time. The script deletes + re-seeds the
carrier and index docs before capturing, so the second run must again
produce a fresh `captured` outcome (not `skipped-duplicate` on a stale
ledger) — the intra-run dedup check still applies.

**Result:** PASS — three consecutive runs all reported `captured` +
24/24 (2026-10-08 cold 24.6s, warm 7.0s, QA-phase rerun below).

### 3. Registry wiring

- `functions/scripts/verify/run-all.ts` lists
  `screenshot-capture-826-lifecycle.ts` immediately after
  `screenshot-capture-844-contracts.ts`.
- `functions/scripts/verify/README.md` has a table row for #848 linking
  `screenshot-capture-826.md` and an order-list entry.
- `functions/scripts/verify/screenshot-capture-826.md` documents usage,
  side effects, pass/fail semantics, and the `timeoutMs` override
  rationale.

**Result:** PASS — all three wiring points verified on disk.

### 4. Anchor doc links

All five `## Docs` links on Thread #826 resolve to files on disk
(PRD #827, IMPL/TEST BE-SH #834, IMPL/TEST FE #834).

**Result:** PASS.

## Traceability

| Acceptance criterion (Task #848 + TEST doc) | Scenario |
|---|---|
| Seeded carrier + synthetic event → real Firestore + real bucket | 1 |
| GCS objects under `st-trade-screenshots/{sym}/{groupId}/` | 1 |
| `capturedEvents` manifest entry on carrier doc | 1 |
| `st-screenshots` index doc present (deterministic id) | 1 |
| Second invocation is a no-op | 1 (`— dedup rerun —`) |
| Registered in `run-all.ts` + `README.md` row | 3 |
| Anchor doc links verified | 4 |
| Script reruns stay deterministic (clean-slate seed) | 2 |

## Regression / smoke

- No production source changed — only `scripts/verify/` files. The
  intake's unit suites (jest 157, tsx paper-trading 168) were green at
  #847 ship on an identical `src/` tree.
- `npx tsc -p functions/tsconfig.json --noEmit` — clean (the script is
  inside the tsconfig).

## Notes for the tester

- The script overrides `timeoutMs` to 120s — the prod 10s await-cap is
  caller-side accounting; locally a capture runs ~7–25s and would take
  the `failed`-marker path even though artifacts land. This is a verify
  accommodation, not a behavior change.
- A failed run prints `✖` lines naming the broken invariant and exits 1;
  `lifecycle_capture_failed` JSON log lines identify the stage (claim,
  capture, commit).
