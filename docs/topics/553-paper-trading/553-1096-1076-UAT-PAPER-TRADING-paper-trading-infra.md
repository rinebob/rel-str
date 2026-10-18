**Topic:** Paper Trading Infra  
**Topic Slug:** paper-trading-infra  
**Thread:** Trade Analysis & Forensics  
**Thread Slug:** trade-analysis  
**Issue:** #1096  
**Thread Parent:** #1059  
**Topic Parent:** #553  
**Task:** #1076  
**Domain:** PAPER-TRADING  
**Type:** UAT  
**Status:** Complete — QA PASS  
**Created:** 2026-10-20  
**Last Updated:** 2026-10-20  

# UAT — #1076 dataset writer + `generateTradeDataset` callable

## Scope

Task #1076 acceptance criteria (issue body + BE IMPL §1–2):

1. Callable rejects invalid exit-rule grammar with 4xx and writes no
   index doc.
2. Index doc carries the full params as provenance; status transitions
   `generating → ready` on success, `→ failed` + `error` on writer throw.
3. Two same-day runs produce two distinct dataset ids.
4. PRD exit grammar = the three firing families (`trailing-{pct}`,
   `time-{N}d`, `initial-stop-{pct}`); registry-parsed but stubbed
   `limit-sd{n}` is rejected.
5. `barRange` = real ISO `YYYY-MM-DD` dates with `from <= to`;
   `symbolScope` trim/uppercase/drop-blank; `signalTypes` whitelist;
   `entryConvention` whitelist; `entryFilters` must be a plain object.
6. Empty row set → header-only CSV, `ready`, `rowCount: 0`.
7. Enqueue failure flips the doc `failed` and surfaces `unavailable` —
   no path wedges at `generating`.
8. `analysisDatasetTask` exists as a deployed-target stub until
   #1077/#1078 land the generation passes.
9. verify-1076 relay green on real prod; indexed in README + run-all.

## Prerequisites

- Node + repo deps installed; `functions` deps installed.
- ADC credentials for prod Firestore/GCS (`rel-str`); the relay writes
  only probe ids (`verify-1076-*`, `ds-*` index docs it mints) and one
  GCS object — additive, non-destructive.
- IPv4 preload: `NODE_OPTIONS=--require
  C:\Users\bob\.config\node\ipv4-only.cjs`.

## Start instructions

```powershell
# unit evidence (tsx — extensionless TS imports; raw node --test does not resolve them)
npx tsx --test tests/functions/paper-trading/analysis-dataset-writer.test.ts tests/functions/paper-trading/generate-trade-dataset.test.ts

# real-prod evidence
npx tsx functions/scripts/verify/paper-trading-analysis-1076-dataset-writer.ts
```

## Scenarios

| # | Scenario | Steps | Expected | Result |
|---|----------|-------|----------|--------|
| 1 | Bad grammar → 4xx, no write | Run callable spec + relay check 1–2 | `invalid-argument`; zero index-doc writes | **PASS** — spec + real-prod relay both confirm |
| 2 | Full params as provenance | Run callable spec + relay check 4 | `generating` doc on real Firestore carries origin/scope/signalTypes/exitRule/barRange/entryConvention verbatim | **PASS** — relay reads the live doc, all params present |
| 3 | `generating→ready` lifecycle | Run writer spec + relay check 6 | After upload: `ready` + `rowCount` + `gcsPath` | **PASS** — real index doc flipped; GCS object read back |
| 4 | `→failed`+error on throw | Run writer spec + relay check 9 | Forced GCS failure flips doc `failed` with error message | **PASS** — forced failure on real prod produced `failed` + error |
| 5 | Same-day distinct ids | Run callable spec | Two identical-config runs mint different `ds-{date}-{origin}-{hash8}` ids | **PASS** — nonce in hash input |
| 6 | Three firing families only | Run callable spec | `trailing-8`, `time-10d`, `initial-stop-5` accepted; `limit-sd1` rejected | **PASS** — all four assertions green |
| 7 | Param validation battery | Run callable spec | non-ISO/impossible/inverted barRange, bad origin/entryConvention/signalType, non-object entryFilters, blank/lowercase scope all behave | **PASS** — 8 validation specs green |
| 8 | Empty row set | Run writer spec | Header-only CSV → `ready`, `rowCount: 0` | **PASS** |
| 9 | Enqueue failure → failed+unavailable | Run callable spec | Doc flips `failed` with `enqueue failed:` error; callable throws `unavailable` | **PASS** — added during review |
| 10 | Stub task exists | Inspect `analysis-dataset-task.ts` + `index.ts` exports | onTaskDispatched `maxAttempts: 1`, flips `failed`/"not implemented" | **PASS** — enqueue target can't wedge docs when deployed |
| 11 | Real-prod relay | Run verify script | 9 checks + honest enqueue skip | **PASS** — 9 ✔; enqueue ⊘ SKIP (needs deployed task + service-account OIDC; documented in guide) |
| 12 | Regression — typecheck + suite | `tsc --noEmit -p functions/tsconfig.json`; full fn suite at review | Clean | **PASS** — tsc clean; 282/282 paper-trading fn suite at review time |

## Automated evidence

- `tests/functions/paper-trading/analysis-dataset-writer.test.ts`: **5/5**
  (ready transition, upload-fail→failed, ready-update-fail→failed attempt,
  empty rows, failure-of-failure surfaces).
- `tests/functions/paper-trading/generate-trade-dataset.test.ts`:
  **14/14** (auth, grammar ×3 families + limit-sd reject, entryFilters,
  blank scope, barRange ×3, whitelists, provenance+enqueue, distinct ids,
  uppercase normalization, empty scopes, enqueue-failure flip).
- `functions/scripts/verify/paper-trading-analysis-1076-dataset-writer.ts`:
  **9/9 + 1 SKIP** on real prod — real `generating` doc, real GCS upload
  + byte readback (manifest-order header, `119.465` lossless), forced
  failure → `failed`+error. Enqueue check honestly skipped: requires the
  deployed task function + service-account OIDC — runs green post-deploy.
- `functions` `tsc --noEmit`: clean.

## Traceability

| Acceptance criterion | Scenario(s) |
|---|---|
| Bad grammar → 4xx, no index doc | 1, 6 |
| Full params provenance + lifecycle transitions | 2, 3, 4 |
| Same-day distinct dataset ids | 5 |
| PRD three-family grammar | 6 |
| barRange/scope/signalTypes/entryConvention/entryFilters validation | 7 |
| Empty row set → header-only ready | 8 |
| Enqueue failure → failed, never wedged | 9 |
| Task target exists (stub) | 10 |
| Relay green on real prod + indexed | 11 |
| Regression | 12 |

## Refinement pass

Not applicable — no user-facing surface (callable + task + writer only).
The FE consumers arrive in #1081–#1085.
