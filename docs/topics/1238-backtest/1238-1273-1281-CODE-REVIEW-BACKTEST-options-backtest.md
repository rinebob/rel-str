**Topic:** Options Backtest  
**Topic Slug:** options-backtest  
**Thread:** Selection Replay  
**Thread Slug:** selection-replay  
**Issue:** #1242  
**Thread Parent:** #1240  
**Topic Parent:** #1238  
**Task:** #1281  
**Domain:** BACKTEST  
**Type:** CODE-REVIEW  
**Status:** Complete  
**Created:** 2026-10-26  
**Last Updated:** 2026-10-26  

# Code Review — Task #1281 (optionsReplayStart callable)

## Verdict: PASS

Three axes against the converged working tree. Two convergence findings
(boundary-validation class + a status-write race); no majors.

## Standards

- Module shape mirrors `pick-doc-client.ts`: header comment with
  topic/thread/task refs, injectable `ReplayStartDeps` seam, production
  wiring at module bottom, thin `onCall` adapter.
- `HttpsError` for `invalid-argument`/`internal` — same convention as
  `gh-lifecycle/callables.ts` (the AC explicitly requires
  `invalid-argument`; `stBacktestStart`'s plain-`Error` style would emit
  `internal` and fail the AC).
- snake_case logger key (`options_replay_start`); eslint clean;
  `import type` for type-only imports.
- Orchestrator config parity with `stBacktestStart`:
  `{ cors: true, memory: '256MiB', invoker: 'public' }`; runId built via
  `getRunIdPT(getRunDatePT(), 'manual')_{rand}` — same scheme, namespaced
  by the `st-options-replay-runs` collection.
- `test:options-replay` extended to a directory glob so #1280+ tests
  register without further script edits.

## Spec (issue #1281 ACs)

| AC | Result |
|---|---|
| Invalid templateId / empty symbols / malformed startDate → `invalid-argument`, no run doc, no tasks | **PASS** — validation precedes all effects; `getReplayTemplate` miss, post-normalize empty list, and `isValidMarketDate` fail each covered by tests (incl. `2026-02-30`) |
| Run doc created `pending`→`running`, `totalLists === symbols.length` | **PASS** — doc shape asserted; transition order pinned by the effect-order log |
| Exactly N tasks carrying `OptionsReplayPermutationPayload` | **PASS** — captured payloads match `{runId, symbol, templateId, startDate}` per symbol |
| Tests per TEST-BE | **PASS** — validation unit tests + fanout/status-transition coverage via injected fakes (TEST-BE's harness pattern) |

## Thermo-Nuclear

- **Convergence finding 1 (fixed, implement pass 2):** non-request-shaped
  input (`undefined` data, non-array `symbols`, non-string
  `templateId`/`startDate`) threw raw `TypeError` → surfaced as `internal`
  instead of `invalid-argument`. Boundary-coerced (`String()`/
  `Array.isArray`) so malformed payloads hit the validation paths; pinned
  by a regression test.
- **Convergence finding 2 (fixed, review pass 1):** ordering was
  create(pending) → enqueue → mark(running). A fast worker could complete
  all lists and write `completed` before the blind `running` update
  landed — regressing a finished run to `running` permanently. Reordered
  to create(pending) → mark(running) → enqueue: `running` now lands
  before any task can exist. `stBacktestStart` dodges this entirely by
  writing `RUNNING` at create time; we keep the spec'd `pending`→`running`
  transition with a guaranteed-safe order. Effect-order pinned in the
  fake deps' `order` log.
- **Known residual (documented, not a blocker):** on enqueue failure
  mid-fanout the run is marked `failed` — but already-enqueued tasks still
  execute and increment counters on the failed run. Mirrors the same
  partial-fanout reality in `stBacktestStart`; worker-side semantics are
  #1280's concern.
- Deliberately not done: ticker-shape validation on normalized symbols
  (FE sends clean lists; AC only requires non-empty), `createRun` merge
  semantics (fresh runId per call — collision impossible), transactional
  status preconditions (reordering removed the race without them).

## Convergence log

- Implement pass 1: initial callable + 7 tests, `index.ts` export,
  `test:options-replay` glob.
- Implement pass 2: boundary-input `TypeError`→`internal` hole fixed
  (`String`/`Array.isArray` coercion) + regression test. 17/17.
- Review pass 1: status-write race fixed (mark `running` before enqueue)
  + effect-order assertion.
- Review pass 2: no new code findings; IMPL-BE §1 as-built updated for the
  reorder and a stale `markRunStatus` doc comment corrected.

## Test state at review

- `npm run test:options-replay` — 17/17 (9 pick-doc + 8 start)
- `functions tsc --noEmit` — clean
- `npm run build` (esbuild bundle) — OK
- eslint `src/options-replay/start.ts` — clean
