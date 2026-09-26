# Verification Guide — task #564: Signal→paper path

## `paper-trading-signal-order-564.ts` — end-to-end accept + noon fill

Verifies the whole signal→paper pipeline on production Firestore with real RH
MCP calls — no stubs:

1. Seeds a real order-ticket doc (`savant-trader/data/order-intents/verify-564-ticket`).
2. Runs `handlePaperSignalOrder` with production deps (real `get_equity_quotes`,
   real `ledgerDeps` transactions) — equity trade filled at the live quote,
   cohort doc, one PENDING trade per bullish expression template.
3. Runs `runExpressionFillPass` — real `get_option_chains` →
   `get_option_instruments` → `get_option_quotes` → `selectOptionContract` →
   `applyPendingFill` → OPEN.
4. Asserts no `place_*`/`review_*` broker mutation calls anywhere (the
   observation-tool allowlist enforces this too).

### Usage

```powershell
$env:NODE_OPTIONS="--require C:\Users\bob\.config\node\ipv4-only.cjs"
cd functions
npx tsx scripts/verify/paper-trading-signal-order-564.ts
```

### Prerequisites

- Google ADC (`GOOGLE_APPLICATION_CREDENTIALS` or gcloud ADC).
- Local RH MCP OAuth configured (the `rh-agent-mcp` observation executor).
- Network access to the RH MCP endpoint.

### Pass criteria

All 15 checks `OK`; exit code 0. Covers:

- Response ids: equity + one pending per `SIGNAL_EXPRESSION_TEMPLATES[LONG]`.
- Trade ids carry the `sig` origin.
- Equity trade: OPEN, share leg, entry fill at a real price, signal/cohort
  dims, `userId`, `none` governing + 3 shadow variant runs.
- Pending trades: PENDING, carry `expressionTemplate`, no fills/legs.
- Cohort: groups all member trades + template keys.
- Account: cash debited by the equity fill, `openTradeCount` = 1.
- Fill pass: no errors, every pending trade filled or skipped.
- Zero broker mutation tool calls.

### Notes

- If the market is closed or no contract is selectable, the fill pass may
  report `skipped` — the script still passes but logs a WARN that the
  OPEN/leg/fill assertions were bypassed.
- All seeded docs (ticket, cohort, trades, account) are cleaned up, including
  belt-and-suspenders prefix sweeps.
