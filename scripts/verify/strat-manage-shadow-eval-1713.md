# Verify: per-tick shadow exit-eval (#1713)

Verifies the intraday shadow-eval folded into the unified mark pass: every
successfully-marked OPEN option position carrying a `strategyInstanceId` is
evaluated against all 6 `EXIT_STRATEGIES` on the tick's fresh
order-exit-price mark; `firstFiredAt` + `firstFiredMark` accumulate into
`st-options-analysis-results/{instanceId}_{exitId}` via merge writes that
don't clobber the EOD scan's doc shape, and the scan carries the fields
forward so afternoon scans can't erase intraday fires.

## What it covers

`runShadowEvalTick` through production code with only I/O faked at the
declared seams (`readResultDoc`/`writeResultDoc` — in-memory doc store):

- instance grouping — positions group by `strategyInstanceId`; trades
  without one (legacy/signal era) are counted and skipped
- all-6-rule evaluation per tick — `evaluateExit` point-check on the fresh
  mark, doc per `(instance × exitId)`
- `firstFiredAt` (ISO tick ts) + `firstFiredMark` — sticky across ticks,
  idempotent on same-tick re-run
- terminal outcomes frozen — prior `exit`/`expired` records never resurrect
- open records refresh + excursion folds across ticks
- re-cross after an EOD scan rewrote `open` — the ORIGINAL first-fire's
  date/mark resolve the exit (no second "first" fire)
- multi-expiry → error records (EOD-scan parity); entryMark posture-
  normalized (LONG-order debit reads positive)
- `runUnifiedMarkPass` wiring — `{trade, mark}` handoff, summary fields,
  eval failure can't fail the mark summary
- `runManageExitScan` carry-forward — rebuilt records preserve firstFired*

## How to run

```bash
npx tsx scripts/verify/strat-manage-shadow-eval-1713.ts
```

No credentials, no flags — importing the modules runs `firebase-admin-init`
(parameterless `initializeApp()`; no Firestore call is made).

Pass: every check prints `OK` and the script exits `0` with
`ALL CHECKS PASSED`. Fail: offending checks print `FAIL` + expected value;
exit `1`.
