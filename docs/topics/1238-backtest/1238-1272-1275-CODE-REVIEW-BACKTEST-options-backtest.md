**Topic:** Options Backtest  
**Topic Slug:** options-backtest  
**Thread:** Selection Replay  
**Thread Slug:** selection-replay  
**Issue:** #1272  
**Thread Parent:** #1240  
**Topic Parent:** #1238  
**Task:** #1275  
**Domain:** BACKTEST  
**Type:** CODE-REVIEW  
**Status:** Complete  
**Created:** 2026-10-25  
**Last Updated:** 2026-10-26  

# Code Review â€” SHARED Task: Replay contracts (#1275)

## Scope reviewed

- `shared/options-replay-contracts.ts` (new) â€” template/coordinate/pick-doc/row/run/list/payload types
- `shared/options-replay-contracts.spec.ts` (new) â€” 14 fixture + narrowing tests
- `@options-replay/contracts` alias â€” `tsconfig.json`, `functions/tsconfig.json`, `jest.config.js`
- `scripts/verify/options-backtest-selection-replay-1275-contracts.ts` + `.md` guide + `README.md` row + `run-all.ts` registration

## Standards

No hard violations. File sizes small, canonical enums reused (`OptionType`, `TradeSide`), ISO-timestamp convention documented, verify-script convention followed (tsx, no credentials, README + run-all registered).

Findings:
- **nit** â€” `ContractListRow` pick variant re-listed all 12 `PickDocDay` fields (drift risk). **Fixed in convergence:** now `ContractListPickRow extends PickDocDay`.
- **nit** â€” inline `expiry` literal duplicated between `PickDocCoordinate` and `PickDocument`. **Fixed:** named `PickDocExpiry` pins parity.
- **nit** â€” IMPL-SHARED doc header lacks a `**Task:**` line. **Dismissed** â€” REFERENCE.md omits `Task` for non-task-scoped docs; IMPL/TEST docs are Plan-scoped, matching the #1244 precedent.
- **nit** â€” `st-options-*` compound prefix. **Dismissed** â€” user-directed naming decision (recorded in blueprint discussion), consistent with `st-backtest-*` precedent.

## Spec

All four acceptance criteria met: `PickDocDay` 12-field wire shape verbatim, `ContractListRow` discriminated union with `side` + `repeatsPrevious`, run/list doc shapes match IMPL-SHARED, `tsc --noEmit` clean for the changed files (two pre-existing repo-wide errors unrelated to this task). Registry and rules test targets in TEST-SHARED are owned by sibling tasks #1276/#1277 â€” not dropped.

Findings:
- **nit** â€” verify script's `Object.keys` comparison was key-order-dependent. **Fixed:** sorted before compare; also exercised `OptionsReplayStartResponse` implicitly via the request/response block.
- **advisory** â€” `PickDocDay` field list is a best reconstruction of the SA sample; #1278 (SA spike) reconciles any drift.

## Thermo-Nuclear

Findings (severity):
- **major** â€” Pick row re-declared the wire shape it mirrors â†’ silent drift if SA changes fields. **Fixed:** `extends PickDocDay`; named `ContractListPickRow`/`ContractListNoSelectionRow` exported for consumers.
- **major** â€” anonymous inline status unions broke the shared-layer `type + readonly const` convention (`st-signals.ts` precedent). **Fixed:** `OptionsReplayRunStatus`/`OPTIONS_REPLAY_RUN_STATUSES`, `OptionsContractListStatus`/`OPTIONS_CONTRACT_LIST_STATUSES`.
- **minor** â€” spec asserted literals, not the union's real property (narrowing). **Fixed:** added `kind`-narrowing test + `@ts-expect-error` on marker-row `contractId`, `extends PickDocDay` verbatim-field test, `reason` field coverage, vocab-const pins.
- **minor** â€” marker row couldn't say *why* (grid-miss vs data-gap vs out-of-range). **Fixed:** optional `reason?: NoSelectionReason` â€” non-breaking, writers populate when known.
- **nit** â€” `'success'` (list) vs `'completed'` (run) is inherited from `BacktestRun`/`BacktestPermutationSummary` â€” deliberate mirror, documented in code comments.
- **nit** â€” `repeatsPrevious` comment now says "immediately preceding row" (matches BE gap-reset semantics).

Non-findings confirmed: `expiry` union-of-one is honest SA-wire parity (not speculative); `PickDocMeta` correctly provenance-only; no `any`/casts; the union is the honest shape.

## Test results

- `options-replay-contracts.spec.ts`: **14/14 pass**
- `scripts/verify/options-backtest-selection-replay-1275-contracts.ts`: **18/18 checks pass**
- Full suite: 4590 tests across 268 suites â€” the only failing suite was this spec mid-convergence-edit (TS2367 narrowing fix); it passes green post-fix. No other suite affected (all changes additive).

## Verdict

**PASS** â€” both majors converged in-place before this doc; remaining findings are nits or dismissed with citations.

## Pass 2 (convergence re-review)

Re-reviewed the post-convergence state; verified pass-1 dismissals against sources (REFERENCE.md:146 â€” `Task:` correctly omitted on Plan-scoped doc; `st-signals.ts` â€” status const pattern matched; relative spec imports â€” unanimous `shared/*.spec.ts` convention).

Findings:
- **major** â€” `PickDocument` still redeclared `type`/`targetDelta`/`expiry` â€” the `extends PickDocCoordinate` convergence recorded in pass 1 had not actually landed. **Fixed:** `PickDocument extends PickDocCoordinate`; IMPL-SHARED doc block synced.
- **nit** â€” payload `Object.keys` checks in the verify script remained order-dependent while the marker-row check was made order-independent. **Fixed:** `.sort()` applied for consistency.

Re-run: spec 14/14 green, verify script 18/18 green. No further findings â€” surface is clean.
