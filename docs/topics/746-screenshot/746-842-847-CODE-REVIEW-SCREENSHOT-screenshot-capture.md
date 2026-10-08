# CODE-REVIEW — Engine Hooks: Lifecycle Capture at Ledger Seams (#847)

**Topic:** On-demand Screenshot Capture  
**Topic Slug:** screenshot-capture  
**Thread:** Order Lifecycle Capture  
**Blueprint:** #842  
**Task:** #847  
**Domain:** SCREENSHOT  
**Type:** CODE-REVIEW  
**Status:** Complete  
**Created:** 2026-10-09  
**Last Updated:** 2026-10-09  

## Verdict: PASS

## Scope reviewed

- `functions/src/paper-trading/screenshot-lifecycle.ts` (new) —
  `positionTypeForLegs`, `settlementCapturesPositionClosed`,
  `lifecycleInputFor`, `makeTradeLifecycleHook` (lazy intake load,
  swallow-and-log), `ledgerDepsWithCapture`.
- `functions/src/paper-trading/ledger.ts` — `LedgerDeps.onTradeLifecycle`
  + `fireLifecycleHook` invoked post-commit in `applyEntryFill`,
  `applyPendingFill`, `applyExitFill`.
- `functions/src/paper-trading/engine/position-repository.ts` —
  `createPosition` capture deps; `markPositionSettled` post-txn
  `position-closed` on terminal statuses.
- Call-site rewires to `ledgerDepsWithCapture`: `callables.ts` (signal
  entry + close exits), `eval-pass.ts`, `signal-settlement-pass.ts`,
  `expression-fill-pass.ts`.
- `tests/functions/paper-trading/screenshot-lifecycle.test.ts` (new,
  tsx --test) + `test:paper-trading` script entry.

## Requirements trace

| Checklist item | Implementation | Verdict |
|---|---|---|
| `applyEntryFill` → `order-filled` | Post-commit hook; open-pass via `createPosition`→`ledgerDepsWithCapture`, `paperSignalOrder` via callables wiring | PASS |
| `applyExitFill`/`markPositionSettled` → `position-closed` terminal only | Ledger post-commit hook; settlement gated by `settlementCapturesPositionClosed` {CLOSED, EXPIRED_WORTHLESS, ASSIGNED_HOLDING_SHARES} | PASS |
| groupId = cohortId (signal) / positionId (engine); refId = `{id}-{event}` | `lifecycleInputFor`: `cohortId ?? trade.id`; refId falls to intake default | PASS |
| `positionTypeFor` leg shape → strategy tag | `positionTypeForLegs` — shares→stock, 1 option→single, same-expiry→vertical, mixed-expiry→calendar | PASS |
| Await-with-cap, swallow-and-log, passes never fail | Cap inside intake (10s); hook swallows outcome + throw; ledger-side `fireLifecycleHook` contains a throwing dep post-commit | PASS |

## Adversarial pass — findings

None remaining. Checked and cleared:

- **Nested-transaction deadlock** — hook must not run inside
  `deps.transact` (capture claims/commits its own transactions on the
  same carrier doc). Verified: `fireLifecycleHook` runs after the awaited
  `deps.transact` returns, in all three fills.
- **Post-commit throw lying about the write** — a throwing dep after a
  committed fill would propagate as a fill failure and invite a retry
  that collides on the trade id. `fireLifecycleHook` try/catch contains
  it (test: "a throwing hook does not fail the fill").
- **Import weight into tsx suites** — `repository.test.ts` /
  `ledger.test.ts` run `tsx --test` with fakes; a static
  `lifecycle-capture` import anywhere in their graph would pull
  firebase-admin-init + resvg. `screenshot-lifecycle.ts` imports only
  pure modules; the intake loads via `await import()` on first hook
  fire. esbuild inlines it against the already-bundled module
  (verified: no emitted chunk import in `lib/index.js`).
- **`ledgerDeps` fake safety** — plain `ledgerDeps` has no hook member,
  so fake-`db` suites never fire a capture.
- **Double-fire on ASSIGNED** — settlement fires `position-closed`;
  a later share-sale through `applyExitFill` re-fires the same event
  key and the carrier ledger dedups to `skipped-duplicate`. Consistent
  with PRD decision #1 (the option position is what closes).
- **Explicit-`undefined` class** — `lifecycleInputFor` omits `refId`/
  `intervals` (intake defaults); `groupId` is `cohortId ?? id` — always
  defined. No optional fields written verbatim.
- **`PositionStatus.CLOSED` in the gate** is unreachable today
  (`SettlementData.status` narrows to EXPIRED_WORTHLESS |
  ASSIGNED_HOLDING_SHARES) — spec-literal, harmless.

## Known limitation (by design, not a defect)

`VERTICAL_DEBIT_SPREAD` is the coarse tag for every same-expiry
multi-option shape — credit spreads (BCS) share the tag. The
`PositionType` enum (#844) intentionally has four values; finer
strategy granularity is a future enum extension, not this task.

## Evidence

- `npx tsx --test tests/functions/paper-trading/screenshot-lifecycle.test.ts`
  — 14/14.
- `npm run test:paper-trading` — 168/168 (covers ledger, repository,
  callables, eval/settlement/expression passes).
- `npx jest tests/functions/screenshot-capture --coverage=false` —
  157/157.
- `cd functions && npx tsc --noEmit` — clean.
- `npm run build` (esbuild) — clean; lazy `import()` inlined, no stray
  chunk imports.

## Notes for ship staging

- Root `package.json` (`ports:kill:4210`) is unrelated user work —
  exclude from staging.
