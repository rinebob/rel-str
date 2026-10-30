**Topic:** Option Contract Time-Series Viewer  
**Topic Slug:** options  
**Thread:** OCC Contract String Group Generator  
**Thread Slug:** occ-string-generator  
**Issue:** #1341  
**Thread Parent:** #1325  
**Topic Parent:** #1243  
**Task:** #1337  
**Domain:** OPTIONS  
**Type:** UAT  
**Status:** Complete  
**Created:** 2026-10-29  
**Last Updated:** 2026-10-29  

# UAT — FE: Generator utils + per-symbol persistence

## Scope

#1337 delivers the data-layer foundation for the OCC group generator
drawer: pure functions for query assembly, client-side refinement, and
`date,id` pair-line emission, plus the versioned per-symbol localStorage
blob (`rs-optgen:{SYMBOL}`). There is no UI surface and no network call —
acceptance is exercised entirely through the Jest spec suite, which is the
documented verification path for this task.

Acceptance criteria (QA issue #1341):

1. `toAvailabilityQuery` emits only set fields; explicit expirations
   override the range; `BOTH` type and `strikeStep:0` omitted; symbol
   normalized.
2. `refineContracts` AND-composes all axes including alive-across-range
   (`firstObserved≤start && lastObserved≥end`); whitespace-only lists are
   no constraint.
3. `toPairLines` emits `date,id`/bare ids sorted
   expiration→strike→contractId.
4. `rs-optgen:{SYMBOL}` blob round-trips query/refine/toggle; wrong
   version or corrupt JSON → defaults; `openDate` never persisted;
   throwing storage → defaults.

## Prerequisites

- Repo at `C:\aa\projects\rel-str`, dependencies installed (`npm ci` if needed).
- Jest 30 + jest-preset-angular (already configured in the repo).
- No credentials, services, or seed data required — all scenarios are
  pure-function or localStorage tests under jsdom.

## Start instructions

From the repo root:

```powershell
npx jest src/app/features/savant-trader/utils/option-group-generator.utils.spec.ts `
         src/app/features/savant-trader/utils/option-generator-settings.spec.ts `
         --coverage=false
```

Expected: both suites green (31 tests as of this writing).

## Scenarios

Each scenario names the spec assertion(s) that execute it. A scenario
passes when its named assertions pass under the command above.

1. **Query assembly emits only set fields.**
   Feature: `toAvailabilityQuery`.
   Specs: `emits only the fields that are set`,
   `omits every optional field when unset`.
   Expected: sparse input produces a request containing only `symbol` plus
   the explicitly set axes.
   Result: PASS — verified in execution log.

2. **Explicit expirations override the range.**
   Feature: `toAvailabilityQuery`.
   Specs: `explicit expirations override the expiration range`,
   `whitespace-only expiration entries are ignored`,
   `trims expiration entries`.
   Expected: non-empty trimmed list → `expirations` on the wire and the
   range fields absent; `['  ']` → range fields emitted instead.
   Result: PASS.

3. **Type + step wire mapping.**
   Feature: `toAvailabilityQuery`.
   Specs: `omits type when BOTH`, `omits strikeStep when 0`,
   `emits strikeStep when positive`, `normalizes the symbol`.
   Expected: `BOTH` → no `type` param; `strikeStep: 0` → no `strikeStep`
   param; `' qqq '` → `symbol: 'QQQ'`.
   Result: PASS.

4. **Refine composes every axis with AND.**
   Feature: `refineContracts`.
   Specs: strike bounds inclusive, expiration bounds inclusive,
   `expirations` membership, `type`, `firstObserved` bounds inclusive,
   `strikeStep` exact-multiple (`0` = no constraint), multi-axis
   composition cases.
   Expected: every set field must hold for a record to survive;
   boundaries are inclusive.
   Result: PASS.

5. **Whitespace-only refine list is no constraint.**
   Feature: `refineContracts`.
   Spec: `a whitespace-only expirations list imposes no constraint`.
   Expected: `expirations: ['  ']` returns all records (was the review
   major — regression-pinned).
   Result: PASS.

6. **Alive-across-range filtering.**
   Feature: `refineContracts` `aliveRange`.
   Specs: `keeps contracts alive across the whole range`,
   `excludes contracts first observed inside the range`,
   `excludes contracts last observed inside the range`.
   Expected: only `firstObserved≤start && lastObserved≥end` survive.
   Result: PASS.

7. **Pair-line emission is deterministic.**
   Feature: `toPairLines`.
   Specs: `emits date,id lines when an open date is given`,
   `emits bare ids when no open date`, `sorts expiration→strike→contractId`,
   `trims the open date`.
   Expected: output order matches the endpoint's documented sort
   regardless of input order.
   Result: PASS.

8. **Settings blob round-trips.**
   Feature: `readGeneratorSettings`/`saveGeneratorSettings`.
   Specs: round-trip of query+refine+`useRangeAsOpenDate`, per-symbol
   isolation (`QQQ` vs `SPY`), `' qqq '` and `'QQQ'` address one blob.
   Expected: what saves is what loads, per normalized symbol.
   Result: PASS.

9. **Malformed blobs degrade to defaults.**
   Feature: `loadGeneratorSettings`.
   Specs: corrupt JSON → defaults; wrong `version` → defaults;
   badly-typed fields sanitized individually; inverted `aliveRange`
   dropped; `openDate` structurally unpersistable (not in
   `GeneratorSettings`).
   Expected: no throw; defaults or field-wise salvage.
   Result: PASS.

10. **Storage failures are tolerated.**
    Feature: `read`/`save`/`clear` wrappers.
    Specs: throwing `getItem` → defaults; throwing `setItem`/`removeItem`
    → swallowed.
    Expected: no exception escapes the wrappers (private-mode parity).
    Result: PASS.

## Traceability

| Acceptance criterion | Scenario(s) |
|---|---|
| QA-1 query assembly | 1, 2, 3 |
| QA-2 refine AND-composition + alive range + whitespace list | 4, 5, 6 |
| QA-3 pair-line emission | 7 |
| QA-4 persistence round-trip/defaults/openDate/throwing storage | 8, 9, 10 |
| Task AC: `openDate` not persisted | 9 |
| Task AC: corrupt-JSON → defaults | 9 |

## Refinement pass

Not applicable — no user-facing surface in this task (pure functions +
localStorage). UI UAT lands with #1339.

## Regression / smoke checklist

- [x] Full Jest suite — 281 suites / 4,845 tests PASS during review gate
      (no regressions introduced by this task).
- [x] `npx tsc --noEmit` — clean on touched files; 3 pre-existing errors
      in unrelated files only.

## Execution log

- 2026-10-29 — Focused spec run executed under the command above;
  results recorded per-scenario.
