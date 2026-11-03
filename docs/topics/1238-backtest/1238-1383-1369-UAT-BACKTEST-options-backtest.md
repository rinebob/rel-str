**Topic:** Options Backtest  
**Topic Slug:** options-backtest  
**Thread:** Backtest Analytics  
**Thread Slug:** backtest-analytics  
**Issue:** #1383  
**Thread Parent:** #1266  
**Topic Parent:** #1238  
**Task:** #1369  
**Domain:** BACKTEST  
**Type:** UAT  
**Status:** Complete  
**Created:** 2026-11-02  
**Last Updated:** 2026-11-02  

# UAT — #1369 optionsReplayRetry callable

## Scope

The `optionsReplayRetry` callable (`functions/src/options-replay/retry.ts`):
re-runs the failed per-symbol list docs of an existing run — resets each
failed list doc to `pending`, transactionally claims/removes the failed
`listOutcomes` entries, re-enqueues one permutation payload per failed
symbol, and recovers cleanly on partial fanout. No UI surface; every check
is a command. Deployment is a ship decision, not QA scope.

## Prerequisites

- Repo root: `C:\aa\projects\rel-str`, dependencies installed.
- No credentials, no emulator, no env vars — all checks run against the
  deps-seam test fakes and static analysis.

## Test scenarios

| # | Scenario | Command / check | Expected | Result |
|---|---|---|---|---|
| 1 | Retry spec suite — mixed run, no-op statuses, failed-run retry, error mapping, ordering, concurrent claim, partial-enqueue recovery | `npx tsx --test tests/functions/options-replay/retry.test.ts` | All pass | **PASS — 15/15** |
| 2 | Sibling replay suites — worker terminal-skip regression + close-out interplay + start | `npx tsx --test tests/functions/options-replay/permutation.test.ts tests/functions/options-replay/start.test.ts` | All pass | **PASS — 21/21** |
| 3 | Functions typecheck | `cd functions && npx tsc --noEmit` | Clean | **PASS** |
| 4 | Functions build | `cd functions && npm run build` | esbuild bundle succeeds | **PASS — lib\index.js 1.9mb** |
| 5 | Lint on the new module | `cd functions && npx eslint src/options-replay/retry.ts` | Zero warnings | **PASS** |
| 6 | Export wiring | `functions/src/index.ts` re-exports `optionsReplayRetry` | Present | **PASS — line 106** |
| 7 | Error-path coverage (negative checks) | specs assert `not-found` (missing run), `invalid-argument` ×5 (missing/blank/non-string runId), `internal` (enqueue failure) — each asserts `.code` per convention | All asserted in suite | **PASS — covered in #1** |

## Result log

- 15/15 retry specs green; 21/21 sibling specs green (terminal-skip
  regression intact — a still-`failed` doc is skipped and re-closed-out,
  confirming the reset-before-enqueue ordering requirement).
- tsc + esbuild clean; eslint zero warnings.
- No emulator/integration step exists for this task type — consistent with
  callable-task convention (deps-seam node:test specs are the verification
  surface; prod wiring reviewed at code-review gate, two rounds).

## Carried forward (not defects)

- **FE wiring (#1375):** Rerun button should be disabled for
  `pending`/`running`/`cancelled` runs — retry no-ops there by design.
- **Residual kill-window:** process killed between reset commit and an
  enqueue transmission orphans that symbol (documented in retry.ts
  header; needs a stale-`running` sweeper — out of scope).
- Runs failed during initial fanout (no outcomes recorded) are not
  retryable via this API — possible follow-on.
- `optionsReplayStart` lacks `timeoutSeconds` (pre-existing #1281) —
  carry-forward hardening candidate.
- Not live until functions deploy — deployment is a ship decision.
