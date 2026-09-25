# Verify — Task #561: Paper Trading Ledger Core

Exercises the ledger seam (`applyEntryFill` / `applyExitFill`) and the
Firestore repository against the **real prod Firestore** — no emulator.

## Script

`functions/scripts/verify/paper-trading-ledger-561.ts`

> Lives under `functions/scripts/verify/` rather than the repo-root
> `scripts/verify/` because `firebase-admin` is a functions/ dependency.

### Usage

```powershell
cd functions
npx tsx scripts/verify/paper-trading-ledger-561.ts
```

Or via the run-all driver (which cd's for you and skips if no ADC):

```powershell
npx tsx scripts/verify/run-all.ts
```

### Requirements

- Google Application Default Credentials: `gcloud auth application-default
  login` or `GOOGLE_APPLICATION_CREDENTIALS` env var.
- No arguments, flags, or env vars beyond ADC.

### What it does

Writes a throwaway CSP trade (`verify-561-QQQM-CSP`) and account
(`acct-verify-561`) under the `paper-trading/{anchor}/items/{id}` layout,
then walks the full lifecycle and asserts each write in prod:

| Stage | Checks |
|---|---|
| Entry fill | cash delta +210; account created; equity flat (cash→asset swap); trade OPEN with fill/legs/seeded mark/variantRuns |
| Reads | `getAccount`, `getTrade`, `listTrades` status+symbol filter |
| Mark | `appendMark` lands `marks.2026-09-26` |
| Collision | `resolveTradeId` suffixes `-1200` on a taken base id |
| Exit fill | cash delta −50; account cash 160 / realized 160 / openTradeCount 0; trade CLOSED with 2 fills |

### PASS

Every line prints `OK`, final summary `=== 20 passed, 0 failed ===`,
and `cleanup: verification docs removed`.

### FAIL

Any `FAIL` line prints the expected-vs-actual detail. Cleanup is attempted
regardless — a failure mid-run still deletes `verify-561-QQQM-CSP` and
`acct-verify-561`. If cleanup fails, delete those two docs manually in the
Firestore console under `paper-trading/trades/items` and
`paper-trading/accounts/items`.

### Side effects

Creates then deletes exactly two docs in prod: `paper-trading/trades/items/
verify-561-QQQM-CSP` and `paper-trading/accounts/items/acct-verify-561`.
Safe to re-run.
