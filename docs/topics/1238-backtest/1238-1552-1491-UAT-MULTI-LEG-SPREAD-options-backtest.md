**Topic:** Options Backtest  
**Topic Slug:** options-backtest  
**Thread:** Multi-leg Templates  
**Thread Slug:** multi-leg-templates  
**Issue:** #1552  
**Thread Parent:** #1270  
**Topic Parent:** #1238  
**Task:** #1491  
**Domain:** MULTI-LEG-SPREAD  
**Type:** UAT  
**Status:** Complete  
**Created:** 2026-11-15  
**Last Updated:** 2026-11-15  

# UAT — SHARED Task: Leg + variant + request/snapshot contracts (#1491)

## Scope

Shared contract layer for the multi-leg refactor: `OptionLeg`/`StockLeg`/`VariantLeg`, `legToPickDocCoordinate` (the single leg→coordinate derivation), `ReplayVariant`/`VariantSnapshot`, the mutually-exclusive three-form `OptionsReplayStartRequest` (`variantId` | `legs + variantName` | legacy `templateId`), and the shrunken `{runId, symbol}` permutation payload that made the run document the worker's single source of truth.

Two review passes ran six axes total; this UAT verifies the *delivered* behavior end-to-end — contracts compile and constrain, the worker reads the run doc, malformed inputs die permanently with warn logs, and the prod audit is green.

## Prerequisites

- Repo checkout at `C:\aa\projects\rel-str` with `npm install` done (root + `functions/`).
- Jest: `npx jest <spec> --coverage=false`.
- Options-replay functions suite: `cd functions && npm run test:options-replay` (node:test via tsx).
- For the prod audit only: Google application-default credentials (Firestore read on the prod project). Obtain via `gcloud auth application-default login`; the script is read-only.
- `NODE_OPTIONS=--require C:\Users\bob\.config\node\ipv4-only.cjs` if `gh`/network calls hang (IPv6 workaround).

## Getting to the feature

No app route — this task ships contracts and backend worker behavior. The surfaces a tester reads/exercises are:

- Contracts: `shared/options-replay-contracts.ts` (+ spec `shared/options-replay-contracts.spec.ts`).
- Worker: `functions/src/options-replay/permutation.ts` — the `optionsReplayPermutation` Cloud Task handler.
- Callables: `functions/src/options-replay/start.ts` (`optionsReplayStart`), `retry.ts` (`optionsReplayRetry`).
- Prod audit: `functions/scripts/verify/options-replay-leg-contracts-1491.ts` — registered in `functions/scripts/verify/run-all.ts:64` and README lines 77/120.
- User-facing path that *consumes* the legacy request form (unchanged behavior): `/options/strategy/backtest` → "New run" dialog — submits `{templateId}` still; no new UI exists for this task.

## Test scenarios

### Scenario 1 — Contract spec: every new type + the three-form union

- **Feature:** `OptionLeg`/`StockLeg` discriminators, `legToPickDocCoordinate` sign + expiry mapping, request-form `?: never` exclusivity, `VariantSnapshot`, reduced payload.
- **Start:** repo root.
- **Steps:** `npx jest shared/options-replay-contracts.spec.ts --coverage=false`
- **Expected:** all tests pass; spec contains `@ts-expect-error` cases for every forbidden form pair (`variantId+legs`, `variantId+templateId`, `templateId+legs`, `variantId+variantName`, `templateId+variantName`, neither-key); put delta − / call delta +; expiry `{mode:'nearestDte', dte}`.
- **Result:** PASS — 29/29 (2026-11-15).

### Scenario 2 — Worker reads the run doc, not the payload

- **Feature:** `ReplayPermutationRunView` picks `symbol`/`templateId`/`startDate`; data path uses `run.symbol`; a missing run doc fails permanently.
- **Start:** repo root.
- **Steps:** `cd functions && npm run test:options-replay` — cases: `run doc missing selection inputs`, `missing run doc`, `the data path uses run.symbol`.
- **Expected:** suite green; the symbol-precedence test proves a `QQQ` run doc wins over a `SPY` payload for bars, pick-doc fetch, and list writes.
- **Result:** PASS — 93/93 (2026-11-15).

### Scenario 3 — Malformed run inputs die permanently (no retry burn) with warn signal

- **Feature:** missing `templateId`/`symbol`/`startDate` AND truthy-but-invalid `startDate` all → one `failed` write + `failed` close-out + `options_replay_worker_permanent` warn; zero pick-doc fetches.
- **Steps:** same suite — cases `malformed run doc (missing templateId|missing symbol|malformed startDate…)` and `missing selection inputs`.
- **Expected:** `fetchCalls === 0`, `writes.length === 1`, status `failed`.
- **Result:** PASS — covered inside 93/93.

### Scenario 4 — Worker-failed runs stamp `error` on the run doc

- **Feature:** `closeOutRun(runId, 'failed', error)`; terminal-skip forwards the list doc's own error.
- **Steps:** same suite — `missing pick doc (404)`, `transient error on final attempt`, `short-circuits a failed doc` cases assert `error` on close-outs.
- **Expected:** close-out records carry the failure reason (FE reads `run.error`).
- **Result:** PASS — covered inside 93/93.

### Scenario 5 — Transitional request forms are explicitly rejected at runtime

- **Feature:** `variantId`, `legs`, `legs:[]`, `legs:null`, `variantId:null`, and mixed `variantId+templateId` all → `invalid-argument` until #1498; `variantName` on the legacy form is silently dropped (documented benign).
- **Steps:** same suite — `start.test.ts` rejection cases.
- **Expected:** `invalid-argument` with a #1498-named message; zero run docs created.
- **Result:** PASS — covered inside 93/93.

### Scenario 6 — Retry no-ops corrupt failed runs instead of destroying their list doc

- **Feature:** a failed run missing `symbol`/`templateId`/`startDate` is not claimed, not reset, not re-enqueued.
- **Steps:** same suite — `retry.test.ts` `no-ops a corrupt failed run missing templateId|startDate`.
- **Expected:** `retriedSymbol: null`, `claims.length === 0`, `enqueued.length === 0`.
- **Result:** PASS — covered inside 93/93.

### Scenario 7 — Prod audit: registry parity + run-doc getRun fields + persisted-coordinate chain

- **Feature:** `legToPickDocCoordinate` reproduces each registry template's coordinate; every prod run doc carries the fields `getRun` requires; completed runs' persisted `pickDocMeta.coordinate` matches the derivation (absent meta = FAIL).
- **Steps (needs ADC):** `cd functions && npx tsx scripts/verify/options-replay-leg-contracts-1491.ts`
- **Expected:** `AUDIT PASS`, `0 FAIL / 0 WARN`; 4/4 template PASS lines.
- **Result:** PASS — `AUDIT PASS`, `0 FAIL / 0 WARN`, 6 new-model runs audited (2026-11-15).

### Scenario 8 — Stale-contract regression: the 1275 wire-shape audit reflects the reduced payload

- **Feature:** `scripts/verify/options-backtest-selection-replay-1275-contracts.ts` asserts `{runId, symbol}` only.
- **Steps:** `npx tsx scripts/verify/options-backtest-selection-replay-1275-contracts.ts`
- **Expected:** `ALL CHECKS PASSED` incl. `task payload shape: ["runId","symbol"]`.
- **Result:** PASS — all checks green (2026-11-15).

### Scenario 9 — Full regression + typechecks

- **Steps:** `npx jest --coverage=false`; `cd functions && npx tsc --noEmit`; `npx tsc --noEmit -p tsconfig.app.json`; `npx tsc --noEmit -p tsconfig.spec.json`.
- **Expected:** full suite green; all three typechecks clean.
- **Result:** PASS — 312 suites / 5,609 tests green; all tsc runs clean (2026-11-15).

## Traceability

| Acceptance criterion | Scenario |
|---|---|
| Leg/variant contracts with signed-delta + nearest-DTE semantics | 1, 7 |
| `legToPickDocCoordinate` is the single derivation | 1, 7 |
| ReplayVariant / VariantSnapshot contracts (stamp-ready) | 1 |
| Mutually-exclusive request forms + legacy bridge | 1, 5 |
| Payload shrunk to `{runId, symbol}` | 2, 8 |
| Worker reads run doc as source of truth | 2, 7 |
| Malformed inputs → permanent failure + warn log | 3 |
| `variantSnapshot` optional/forward-compatible for #1498 | 1, 7 |
| Run `error` stamped on worker failures | 4 |
| Retry doesn't destroy corrupt failed runs | 6 |
| No duplicated/mirrored contracts | 1, 8, 9 |

## Refinement pass

Not applicable — no user-facing surface. The FE run dialog (`/options/strategy/backtest` → "New run") is untouched and continues to submit the legacy `{templateId}` form; the runtime rejection of `variantId`/`legs` is an API-boundary behavior, not a UI change.

## Regression / smoke checklist

- [x] Legacy `templateId` submissions still create running run docs + enqueue `{runId, symbol}` — start.test.ts (93/93)
- [x] Failed-enqueue path still marks only the affected run — start.test.ts
- [x] Terminal-doc skip + close-out convergence — permutation.test.ts
- [x] `options-analysis` start/worker unaffected by shared contract edits — functions tsc clean
- [x] FE dialog/service compile against the union's legacy form — app + spec tsc clean
