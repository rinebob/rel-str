**Topic:** Options Backtest  
**Topic Slug:** options-backtest  
**Thread:** Backtest Analytics  
**Thread Slug:** backtest-analytics  
**Issue:** #1384  
**Thread Parent:** #1266  
**Topic Parent:** #1238  
**Task:** #1370  
**Domain:** BACKTEST  
**Type:** UAT  
**Status:** Complete  
**Created:** 2026-11-02  
**Last Updated:** 2026-11-02  

# UAT — #1370 optionsAnalysisStart callable

## Scope

The `optionsAnalysisStart` callable (`functions/src/options-analysis/start.ts`):
validates a contract list doc exists and is `status:'success'`, then enqueues
one `OptionsAnalysisTaskPayload` (with `registryVersion`) on the dedicated
`optionsReplayAnalysis` queue. Includes the in-cycle `retry.ts` hardening
(transactional `resetListDoc` + `shouldResetForRetry` predicate + generalized
`failRun` no-restore guard) found by the #1370 review. No UI surface; every
check is a command. Deployment is a ship decision, not QA scope.

## Prerequisites

- Repo root: `C:\aa\projects\rel-str`, dependencies installed.
- No credentials, no emulator — deps-seam test fakes + static analysis only.

## Test scenarios

| # | Scenario | Command / check | Expected | Result |
|---|---|---|---|---|
| 1 | Analysis-start spec suite — payload fields, doc-sourced (not docId-parsed), idempotent re-invoke, failed-precondition ×4 (missing/pending/running/failed), invalid-argument ×5, internal + preserved cause | `npm --prefix functions run test:options-analysis` | All pass | **PASS — 13/13** |
| 2 | Sibling replay suite incl. retry hardening (`shouldResetForRetry` predicate spec, concurrency/recovery paths) | `npm --prefix functions run test:options-replay` | All pass | **PASS — 65/65** |
| 3 | Functions typecheck | `cd functions && npx tsc --noEmit` | Clean | **PASS** |
| 4 | Functions build | `cd functions && npm run build` | esbuild bundle | **PASS — 1.9mb** |
| 5 | Lint on touched modules | `npx eslint src/options-analysis/start.ts src/options-replay/retry.ts` | Zero warnings | **PASS** |
| 6 | Export wiring + test-runner registration | `index.ts` export; `test:options-analysis` script exists | Both present | **PASS — index.ts:109, package.json:39** |
| 7 | Error vocabulary (negative checks) | `failed-precondition` (missing + non-success, never `not-found`), `invalid-argument`, `internal` — asserted via `.code` | All in suite | **PASS — covered in #1** |

## Result log

- 13/13 analysis specs + 65/65 replay specs green; tsc, esbuild, eslint clean.
- Queue name `optionsReplayAnalysis` verified = IMPL §3 worker export name.
- No emulator step for this task type — consistent with callable convention.

## Carried forward (not defects)

- **Deploy order:** `optionsAnalysisStart` enqueues to a queue that only exists
  once the #1372 `optionsReplayAnalysis` worker deploys — ship together.
- **#1372 worker requirement** (IMPL-BE §3): re-validate `status==='success'`
  at run time; missing `rows` = retryable, never zero-count overwrite.
- **Worker-side mirror race** (pre-existing, since #1369): stale terminal-skip
  can re-record `failed` post-claim → doc/outcome divergence — needs the
  stale-`running` sweeper; tracked in the review gate doc.
- `optionsReplayStart` missing `timeoutSeconds` — #1281 carry-forward.
- Foreign suite failure to watch: untracked `option-chart-generator.spec.ts`
  (NG0201 ×5 — needs `{ provide: Functions, useValue: {} }`; user's #1243 work).
