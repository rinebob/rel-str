# Verify guide — #666 BE Pending cancel

One script covering the pending-cancel pipeline end-to-end on prod:
create PENDING → handler guards (wrong-user, missing, happy path) →
CANCELLED read-back → re-cancel rejection → no cash movement.

## Scripts

| Script | Covers | Credentials |
|---|---|---|
| `paper-trading-cancel-666.ts` | `createPendingTrade` → `handleCancelPaperTrade` (prod deps) → `CANCELLED` + runs EXITED + account unchanged; permission/failed-precondition/not-found guards | ADC (`gcloud auth application-default login`) |

## Usage

```powershell
cd functions
npx tsx scripts/verify/paper-trading-cancel-666.ts
```

**Pass:** 9 checks `OK`, docs cleaned up, exit 0.
**Fail:** offending check prints `FAIL` with detail; cleanup still runs; exit 1.

## Notes

- Test docs use `verify-666-*` ids under `acct-verify-666`; deleted in a
  `finally` — safe to re-run.
- Exercises the real Firestore transaction seam (`ledgerDeps`) — the
  cancel-vs-fill race guard (`not pending` → `failed-precondition`) is the
  same txn re-check the expression fill pass races against.
- The cancel-during-fill classification (`not pending` → skipped, not
  errors) is unit-covered in `tests/functions/paper-trading/expression-
  fill-pass.test.ts`.
