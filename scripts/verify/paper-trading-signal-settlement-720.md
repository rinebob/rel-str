# Verify guide — #720 BE signal-trade settlement at expiration

Verifies that `runSignalSettlementPass` (wired into the nightly
`runSettlementForAllInstances` chain) settles OPEN signal-source trades
whose option legs have all expired — the gap that left signal options as
permanent zombies with unquotable marks.

## Script

| Script | Covers | Credentials |
|---|---|---|
| `paper-trading-signal-settlement-720.ts` | seeds two scratch signal trades with expired QQQM option legs → real pass run → OTM asserts `EXPIRED` + premium realized + governing run EXITED at 0; ITM asserts `CLOSED` + exit fill at net intrinsic + run EXITED at intrinsic → account bookkeeping → cleanup verified | ADC only (SDS daily bars; **no RH MCP needed**) |

## Usage

```powershell
cd functions
npx tsx scripts/verify/paper-trading-signal-settlement-720.ts
```

**Pass:** all checks `OK`, `settled=2` for the scratch pair, live signal
trades report `skipped=N` (their legs haven't expired), exit 0.
**Fail:** any check fails; exit 1. Scratch docs (`verify-720-*`,
`acct-verify-720-user`) are deleted + verified absent.

## Notes

- Settlement resolves from the SDS daily bar for the **expiration** date
  (`getUnderlyingCloseForDate`), not live quotes — an option that
  delisted can still settle.
- OTM expiry uses the `markPositionSettled` seam (realizes full premium,
  stamps leg outcome + `underlyingClose` mark); ITM uses `applyExitFill`
  at net intrinsic — modeled as an intrinsic buyback, not assignment
  (paper accounts never hold delivered shares; an ASSIGNED signal trade
  would have no mark path).
- Eligibility is `expiration <= marketDate`, so a missed night (SDS
  delay) retries automatically.
- Composes with `-676` (marks) and `-669` (seed/cancel/close seam).
