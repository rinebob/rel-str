**Topic:** Options Backtest  
**Topic Slug:** options-backtest  
**Thread:** Selection Replay  
**Thread Slug:** selection-replay  
**Issue:** #1272  
**Thread Parent:** #1240  
**Topic Parent:** #1238  
**Task:** #1276  
**Domain:** BACKTEST  
**Type:** CODE-REVIEW  
**Status:** Complete  
**Created:** 2026-10-26  
**Last Updated:** 2026-10-26  

# Code Review — SHARED Task: Template registry + collections/rules/indexes (#1276)

Merged scope: original #1276 (template registry) + absorbed #1277 (collections, Firestore rules, indexes).

## Scope reviewed

- `shared/options-replay-templates.ts` (new) — `REPLAY_TEMPLATES` code-curated registry + `getReplayTemplate`
- `shared/options-replay-templates.spec.ts` (new) — 7 registry tests
- `shared/st-collections.ts` — `ST_OPTIONS_REPLAY_RUNS_ROOT`, `ST_OPTIONS_CONTRACT_LISTS_ROOT`, `stOptionsContractListDocId`
- `shared/st-collections.spec.ts` — roots pinned + doc-id builder coverage
- `firestore.rules` — two match blocks (authed read, `allow write: if false`)
- `firestore.indexes.json` — `st-options-contract-lists` `(runId ASC, symbol ASC)` composite
- `tests/functions/firestore-rules-indexes-1012.test.ts` — roots, write-false patterns, index assertion
- `@options-replay/templates` alias — `tsconfig.json`, `functions/tsconfig.json`, `jest.config.js`
- `scripts/verify/options-backtest-selection-replay-1276-registry-collections.ts` + `.md` guide + `README.md` row + `run-all.ts` registration
- IMPL-SHARED §4 — `stOptionsContractListDocId` builder noted

## Standards

No hard violations. Rules blocks and index entry are byte-consistent with the `st-backtest-permutations` precedent; alias registered on all three resolution surfaces.

Findings:
- **minor** — `st-collections.ts` header scope ("only roots created or renamed by this reorg") was stale for the new `st-options-*` roots. **Fixed in convergence:** scope text amended to include new `st-` flat roots from feature domains without a dedicated path module; layout recap updated.
- **minor** — verify guide `.md` header used a bespoke `**Topic:**`-style block instead of the sibling verify-guide format. **Fixed:** rewritten to match `options-backtest-selection-replay-1275-contracts.md`.
- **minor** — `st-options-` hybrid prefix / naming asymmetry. **Dismissed** — user-directed naming decision adjudicated in the #1275 review; consistent with `st-backtest-*` precedent.
- **nit** — `readonly ReplayTemplate[]` is shallow; entries mutable. **Dismissed** — matches `ST_INDICATOR_OPTIONS` registry precedent.
- **nit** — verify script checked index `fieldPath`s without `order`. **Resolved by convergence trim** — that check was removed; the node:test spec pins ASC.

## Spec

All eight acceptance criteria met: `ReplayTemplate`-conforming entries, hit/`undefined` miss lookup, unique ids + delta-sign convention, exported constants consumed (no string literals), authed-read/write-denied rules, `(runId, symbol)` composite declared, coverage added to the existing rules spec pattern, unit tests per TEST-SHARED.

Findings:
- **minor** — TEST-SHARED pins `targetDelta` magnitude to the open interval `(0,1)` but the spec asserted `≤1`. **Fixed:** `toBeLessThan(1)`.
- **info** — unauthed-read denial is implicit in the `auth != null` pattern (no emulator rules tests exist — content-level assertions are the established precedent).
- **info** — `st-options-replay-runs (createdAt DESC)` index intentionally undeclared (single-field is free; IMPL hedged "likely free").

## Thermo-Nuclear

Findings (severity):
- **major** — verify script ~80% duplicated assertions already in the jest specs and `test:st-rules-indexes`; permanent maintenance surface in triplicate. **Fixed:** trimmed to its unique differentiator — `@options-replay/templates` + `@st/collections` alias resolution under tsx plus representative smoke checks. Guide and README row updated to scope it accordingly.
- **major** — `st-collections.ts` scope breach. **Fixed** — same convergence as the Standards finding (header scope amended; roots kept here rather than a new `options-replay-collections.ts` — `st-backtest-*` flat roots are the direct precedent for flat root placement).
- **minor** — speculative surface: doc-id builder + composite index for unshipped consumers. **Dismissed** — the index is an explicit AC; the builder encodes the plan-mandated deterministic id format once for #1280/#1281 (charset assumption now commented).
- **minor** — tautological spec assertions (enum membership, `mode === 'nearestDte'` are compiler-guaranteed literals). **Fixed:** trimmed to real literal-data guards (non-empty strings, integer positive dte, delta magnitude/sign); kept the non-empty-string guards with a comment explaining why literal data needs them.
- **nit** — `getReplayTemplate` returns mutable registry entries; `Object.freeze` suggested. **Dismissed** — registry precedent is non-frozen; adding freeze to one entry shape would be inconsistent.
- **nit** — `t!` non-null assertions in spec. **Fixed:** `toMatchObject` on the hit test.

## Test results

- `npx jest shared/options-replay-templates.spec.ts shared/st-collections.spec.ts` — **32/32 green** (post-convergence).
- `cd functions && npm run test:st-rules-indexes` — **14/14 green**.
- `npx tsx scripts/verify/options-backtest-selection-replay-1276-registry-collections.ts` — **7/7, ALL CHECKS PASSED**.
- Full jest suite — **269 suites / 4639 tests, all green**.
- `npx tsc --noEmit` — zero diagnostics on task files; two pre-existing repo errors on unrelated unmodified files (`scripts/bulk-swing-sweep.ts`, `indicator-config-dialog.component.ts`).

## Findings summary

| Severity | Count | Disposition |
|---|---|---|
| Critical | 0 | — |
| Major | 2 | both fixed in convergence |
| Minor | 5 | 4 fixed, 1 dismissed (adjudicated naming) |
| Nit | 4 | 2 fixed, 2 dismissed (registry precedent) |

## Verdict

**PASS** — all findings fixed or dismissed with cited precedent; tests green.

## Convergence notes

- Verify script intentionally reduced to alias-resolution smoke; duplicated assertions removed in favor of the jest/node:test suites that run the same checks for real.
- `st-collections.ts` header scope and layout recap now accurately describe the file's contents.
- Concurrent-session note: `tests/functions/firestore-rules-indexes-1012.test.ts` also gained a #1254 scanner-rules test from parallel work in this working tree — unrelated to this task; worth watching at ship time for the same partial-staging care used on #1275.
