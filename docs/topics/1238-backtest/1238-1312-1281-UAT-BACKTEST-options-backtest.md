**Topic:** Options Backtest  
**Topic Slug:** options-backtest  
**Thread:** Selection Replay  
**Thread Slug:** selection-replay  
**Issue:** #1312  
**Thread Parent:** #1240  
**Topic Parent:** #1238  
**Task:** #1281  
**Domain:** BACKTEST  
**Type:** UAT  
**Status:** Complete  
**Created:** 2026-10-28  
**Last Updated:** 2026-10-28  

# UAT — Task #1281 (optionsReplayStart callable)

## Verdict: PASS — 8/8 checklist items, all four ACs covered

Evidence gathered fresh at the QA gate: `npm run test:options-replay`
(17/17), `cd functions && npx tsc --noEmit` (clean), `npm run build`
(esbuild bundle OK).

## Checklist

| # | Scenario | Evidence | Result |
|---|----------|----------|--------|
| 1 | Valid request → `pending` run doc (totalLists, zeroed counters), N payloads `{runId, symbol, templateId, startDate}`, `running` marked BEFORE enqueues | `startReplay` test 1 — doc shape asserted; `order` log pins `create:pending → mark:running → enqueue:SPY → enqueue:QQQ` | PASS |
| 2 | Unknown/missing templateId → `invalid-argument`, zero side effects | Tests 2–3 — `getReplayTemplate` miss + empty id; `runs.size === 0`, no enqueues | PASS |
| 3 | Empty symbols → `invalid-argument`, zero side effects | Test 4 — post-normalize empty list rejected | PASS |
| 4 | Malformed startDate incl. impossible calendar dates → `invalid-argument` | Test 6 — `'not-a-date'`, `'2026-13-45'`, `'2026-02-30'` all rejected via `isValidMarketDate` | PASS |
| 5 | Non-request-shaped input → `invalid-argument`, not `internal` | Test 5 — `undefined` data, `symbols:'SPY'`, `templateId:42` all coerced to validation errors | PASS |
| 6 | Enqueue failure → run `failed` + error, `internal` surfaced | Test 8 — `['running','failed']` marks, error message carried | PASS |
| 7 | Suite/typecheck/build green; exported from `index.ts`; `OPTIONS_REPLAY_TASK_QUEUE` set for #1280 | 17/17 · tsc clean · bundle OK; `export { optionsReplayStart }` + `OPTIONS_REPLAY_TASK_QUEUE = 'optionsReplayPermutation'` | PASS |
| 8 | Deduped symbols — one list doc per symbol | Test 7 — `[' spy ', 'SPY', 'qqq']` → `['SPY','QQQ']`, `totalLists: 2` | PASS |

## AC traceability (issue #1281)

| AC | Scenario(s) |
|---|---|
| Invalid templateId / empty symbols / malformed startDate → `invalid-argument`, no run doc, no tasks | 2, 3, 4, 5 |
| Run doc `pending`→`running`, `totalLists === symbols.length` | 1 |
| Exactly N tasks carrying `OptionsReplayPermutationPayload` | 1, 8 |
| Tests per TEST-BE | all — `tests/functions/options-replay/start.test.ts` (8 tests) |

## Known limitations (inherited from review)

- Task-queue delivery itself is untested — the `onCall` wrapper +
  `taskQueue().enqueue` path needs a deployed environment or emulator
  (same untested seam as every callable in this repo; the deps seam
  covers everything testable below it).
- Enqueue failure mid-fanout leaves already-enqueued tasks running
  against a `failed` run — mirrors `stBacktestStart`; worker-side
  semantics are #1280's scope.
