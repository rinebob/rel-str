# UAT — Screenshot Capture: Engine Lifecycle Hooks (#847)

**Topic:** On-demand Screenshot Capture  
**Topic Slug:** screenshot-capture  
**Thread:** Order Lifecycle Capture  
**Blueprint:** #842  
**Task:** #847  
**QA Issue:** #899  
**Domain:** SCREENSHOT  
**Type:** UAT  
**Status:** Complete  
**Created:** 2026-10-09  
**Last Updated:** 2026-10-09  

## Scope

#847 wires the lifecycle intake into the paper/engine write seams:
`applyEntryFill`/`applyPendingFill` → `order-filled`,
`applyExitFill`/`markPositionSettled` → `position-closed` on terminal
statuses. Group roots: `cohortId` (signal cohorts) / trade id (engine).
The hook is post-commit, await-capped, and never throws into the order
path.

## Evidence

- `npx tsx --test tests/functions/paper-trading/screenshot-lifecycle.test.ts`
  — **14/14**: positionTypeForLegs mapping (stock/single/vertical/calendar),
  terminal-status gate, carrier + groupId construction, hook firing on all
  three ledger seams, hook-absent no-op, throwing-dep containment.
- `npm run test:paper-trading` — **168/168**: full ledger, repository,
  callables, eval/settlement/expression-pass regression — the
  `onTradeLifecycle` seam is additive; hook-free deps unchanged.
- `npx jest tests/functions/screenshot-capture --coverage=false` —
  **157/157**.
- `cd functions && npx tsc --noEmit` — clean; esbuild bundles clean
  (lazy `import()` inlined, no stray chunk).

## Scenario checks

| Criterion | Evidence | Result |
|---|---|---|
| `order-filled` on every entry seam (open-pass, signal equity, expression fills) | hook fires on `applyEntryFill` + `applyPendingFill`; call sites wired via `ledgerDepsWithCapture` | PASS |
| `position-closed` on terminal closes only | `applyExitFill` hook + `settlementCapturesPositionClosed` gate in `markPositionSettled` | PASS |
| Non-terminal writes don't fire | gate spec tests (OPEN / COVERED_CALL_OPEN) | PASS |
| groupId = cohortId / positionId | `lifecycleInputFor` spec tests | PASS |
| Passes never fail on capture | swallow at hook + `fireLifecycleHook` containment; throwing-dep test | PASS |
| No nested transaction | hook invoked after `deps.transact` resolves | PASS |
| Test isolation | plain `ledgerDeps` stays hook-free; tsx fakes unaffected | PASS |

## Live Firestore/GCS

Deferred to **#848** — the hooks only become observable when a real
pass fires against real docs; the verify script
(`screenshot-capture-826-lifecycle.ts`) is that task's deliverable.

## Verdict

**PASS** — #847 accepted, ship-eligible.
