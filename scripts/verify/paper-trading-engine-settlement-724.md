# #724 — Engine settlement pass missed-night / weekend-expiry parity

Verifies `runSettlementPass` (paper-trading engine) settles strategy-source
trades whose expiration is **on or before** the run date — not only exactly
on it — and that a weekend/holiday expiration settles at the most recent
prior trading-day close.

## What it checks

- SDS bars exist for the expiration trading day and the walk-back Friday;
  asserts no bar exists on the Saturday expiration (walk-back exercised).
- Seeds `verify-724-inst` (strategy instance) + `acct-verify-724-user`
  + two OPEN strategy-source trades with far-OTM QQQM puts:
  - `verify-724-missed` — expiration `2026-09-29` (trading day) run on a
    later market date → settles at the expiration close, `closeDate` =
    expiration date.
  - `verify-724-weekend` — expiration `2026-09-26` (Saturday, no bar) →
    settles at Friday `2026-09-25` close, `closeDate`/mark dated Friday.
- Both trades: `EXPIRED`, full premium realized (+200 each), governing run
  `EXITED` at 0, account `openTradeCount` 2→0 / `realizedPnl` +400.
- Trades leave the OPEN strategy population; all scratch docs deleted and
  verified gone.

## Run

```bash
cd functions
npx tsx scripts/verify/paper-trading-engine-settlement-724.ts
```

Needs ADC (Firestore + SDS `symbol-data/QQQM` daily bars). No RH MCP —
`checkBrokerageOutcome` is optional; a far-OTM put expires worthless
regardless.

Script: `functions/scripts/verify/paper-trading-engine-settlement-724.ts`
