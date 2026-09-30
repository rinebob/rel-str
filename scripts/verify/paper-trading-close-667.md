# Verify guide — #667 BE Live-quote close

Full open→close round trip on prod Firestore with a real RH MCP quote:
create a scratch 1-share equity trade, close it via `handleClosePaperTrade`
(prod deps + real `get_equity_quotes`), read back CLOSED + governing run
EXITED + exitEvent, verify guard rejections.

## Scripts

| Script | Covers | Credentials |
|---|---|---|
| `paper-trading-close-667.ts` | entry fill → permission-denied guard → live-quote close → CLOSED read-back → exit fill price match → governing run finalized → re-close failed-precondition | ADC + local RH MCP OAuth (same as `paper-trading-signal-order-564.ts`) |

## Usage

```powershell
cd functions
npx tsx scripts/verify/paper-trading-close-667.ts
```

**Pass:** 7 checks `OK`, live quote + pnl printed, docs cleaned up, exit 0.
**Fail:** offending check prints `FAIL` with detail; cleanup still runs; exit 1.

## Notes

- Scratch trade is `verify-667-QQQM-EQ-{ts}` under `acct-verify-667`; both
  docs deleted in a `finally`.
- The entry fill is a nominal $1 scratch fill — only the *close* exercises
  the live quote path (realizedPnl printed is meaningless for this trade).
- Read-only MCP tools only (`get_equity_quotes`); the option-quote provider
  is wired but only exercised by equity legs here — multi-leg quote netting
  is unit-covered in `tests/functions/paper-trading/close-paper-trade.test.ts`.
