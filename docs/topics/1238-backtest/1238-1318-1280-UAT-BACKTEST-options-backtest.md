**Topic:** Options Backtest  
**Topic Slug:** options-backtest  
**Thread:** Selection Replay  
**Thread Slug:** selection-replay  
**Issue:** #1242  
**Thread Parent:** #1240  
**Topic Parent:** #1238  
**Task:** #1280  
**QA Issue:** #1318  
**Domain:** BACKTEST  
**Type:** UAT  
**Status:** Complete  
**Created:** 2026-10-28  
**Last Updated:** 2026-10-28  

# UAT — Task #1280 (Row mapper + optionsReplayPermutation worker)

## Verdict: PASS

Fresh evidence at gate: `npm run test:options-replay` **38/38**;
`functions npx tsc --noEmit` clean; `npm run build` esbuild bundle OK;
`shared/options-replay-contracts.spec.ts` + `st-collections.spec.ts` 41/41.

## Scenarios

| # | Scenario | Result | Evidence |
|---|---|---|---|
| 1 | Mapper pick day → `pick` row with all day fields + `side` + `entryDate` | PASS | `pick-doc-mapper.test.ts` — pick row shape test |
| 2 | Miss statuses map to reasons (`no_match`→`miss`, `no_chain`→`gap`) | PASS | miss-entry test |
| 3 | Absent day inside `[firstDate, lastDate]` → `no-selection` marker, no reason | PASS | in-range absent-day test |
| 4 | Days outside doc range → `out-of-range`, symmetric both ends | PASS | pre-firstDate + post-lastDate tests |
| 5 | `repeatsPrevious` — consecutive same `contractId`, reset across marker gap | PASS | repeat/gap sequence test |
| 6 | Mapper purity — no Firestore/network deps | PASS | module imports only shared contracts/types |
| 7 | Worker happy path: `running` → `success` doc with rows + `pickDocMeta`; fetch window `[startDate, latestBar]` | PASS | `permutation.test.ts` — happy-path assertions on written doc + transport calls |
| 8 | Terminal list doc (`success`/`failed`) skips re-execution but ensures close-out | PASS | terminal-skip tests — no fetch calls, `listOutcomes` recorded, counters not double-incremented |
| 9 | Pick-doc 404 → `failed` doc naming coordinate + failed close-out, **no retry** | PASS | 404 test — cellId in message, error not rethrown |
| 10 | Transient error → rethrown for Cloud Tasks retry | PASS | transient-rethrow test |
| 11 | Final retry attempt → `failed` doc + failed close-out | PASS | last-attempt test |
| 12 | Unknown `templateId` → permanent failed doc + close-out (no retry) | PASS | unknown-template test |
| 13 | `resolveRunCloseOut` — counters, `completed` vs all-fail `failed`, partial-failure `completed` | PASS | 4 pure-helper tests |
| 14 | Convergent close-out — terminal-status redelivery cannot double-count (`listOutcomes` map) | PASS | idempotent close-out tests; review finding #3 |
| 15 | Registration — exported from `index.ts`; name = `OPTIONS_REPLAY_TASK_QUEUE` | PASS | `index.ts` diff + `start.ts` export contract |
| 16 | Suite/harness — `test:options-replay` 38/38, tsc, esbuild, shared specs 41/41 | PASS | gate evidence above |

## Acceptance-criteria traceability (#1280)

- Pure mapper → S1–S6
- `no-selection` incl. past `lastDate` → S2–S4
- `repeatsPrevious` → S5
- Missing pick doc → `failed` + coordinate, run completes with `failedLists` → S9, S13
- `success` doc short-circuits → S8
- Partial failures close with correct counters → S13
- Exported/wired → S15
- Unit tests per TEST-BE → S1–S14 (all via `ReplayPermutationDeps` + `PickDocTransport` seams, no emulator)

## Residual notes

- Two **concurrent first dispatches** can both pass the terminal check and
  duplicate the fetch/write work — but `listOutcomes` in the close-out
  transaction prevents counter corruption; redundant effort is bounded by
  `maxAttempts: 3`. Accepted (at-least-once delivery is the platform's
  nature; no lease mechanism exists elsewhere in the codebase either).
- `no_chain → 'gap'` naming mirrors SA's chain-absence semantics; reason
  strings only surface in the FE viewer (#1283+).
