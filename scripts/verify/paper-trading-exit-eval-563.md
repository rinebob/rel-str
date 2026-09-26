# Verify — Paper-trading exit eval pass (task #563)

## What it verifies

`paper-trading-exit-eval-563.ts` exercises the **real** nightly exit-variant
evaluation against prod Firestore — not a stub repository. It seeds
`verify-563-`-namespaced docs (instance, account, four trades), runs
`runExitEvalPass` with the production `defaultEvalDeps`, then asserts:

1. **Governing breach** — `initial-stop-10` fires at mark 2.2 (entry 2.0 on
   a SHORT order +10%) → a real closing fill through `applyExitFill`, trade
   → `CLOSED`, governing run `EXITED` with `exitEvent {date, price, pnl −20,
   daysHeld 9}`, account cash debited −220, `openTradeCount` decremented,
   `realizedPnl` −20.
2. **Shadow breach** — `time-9d` fires on the same trade → run `EXITED`
   with a counterfactual exitEvent computed by `computeExitPnl`; no cash or
   status mutation.
3. **Working-state update** — `trailing-20` sees mark 1.0 on a SHORT trade →
   new `lowWaterMark`, still `ACTIVE`, no event.
4. **Mark gap tolerance** — a trade with no `marks[date]` entry is skipped;
   nothing fires on stale marks.
5. **`none` sentinel** — registered but inert; never fires.
6. **Backfill safety** — second eval run produces no second closing fill on
   an already-CLOSED trade.

## Usage

From `functions/`:

```powershell
$env:NODE_OPTIONS="--require C:\Users\bob\.config\node\ipv4-only.cjs"
npx tsx scripts/verify/paper-trading-exit-eval-563.ts
```

No flags. Requires ADC (`gcloud auth application-default login`) — writes
real (namespaced) docs then deletes them in `cleanup()`.

## Pass / fail

- **Pass**: prints `=== 15 passed, 0 failed ===`, exit code 0, and
  `cleanup: verification docs removed`.
- **Fail**: `FAIL` lines naming the broken invariant; a thrown error is
  printed as `verification error:` and the script still attempts cleanup.

## Notes

- The seeded account starts with `cash=200, equity=-200, openTradeCount=2`
  (two open positions, 2.0 premium each) so the governing close can be
  checked against exact ledger math: cash −220, equity −220 after close.
- `t2`/`t3`/`t4` deliberately never close — they prove working-state,
  gap, and sentinel behavior without touching the account.
