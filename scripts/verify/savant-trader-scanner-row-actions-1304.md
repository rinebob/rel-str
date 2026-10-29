# Verification Guide — get_equity_historicals wire contract (#1304)

Task [#1304](https://github.com/rinebob/rel-str/issues/1304) — SHARED
wire contract for `get_equity_historicals` in
`shared/robinhood-mcp-contracts.ts` (`EquityHistoricalsRequest`,
`EquityHistoricalInterval`, `EquityHistoricalBar`,
`EquityHistoricalsSymbolResult`, `EquityHistoricalsResult`), consumed as
`@robinhood-mcp/contracts` by the scanner's untracked-symbol hover chart
(ADR-011).

## Scripts

| Script | Stage | In run-all? | Purpose |
|---|---|---|---|
| `savant-trader-scanner-row-actions-1304-contracts.ts` | capture parity (offline) | yes | Bidirectional diff: every request-arg / top-level-response / result-entry / bar key in the `ro-eq-hist-*.json` captures must be declared in the contract and vice versa. `Record<keyof T, true>` maps are exhaustive at compile time; declared-but-never-wired fields warn |
| `savant-trader-scanner-row-actions-1304-live.ts` | live tool call | **no** — needs the executor | Calls the real `get_equity_historicals` through the local RH MCP executor and validates the live response shape |

The live script is deliberately unregistered in `run-all.ts` — it would
fail on any machine without the executor running (same convention as
`run-drift-check.ts` for #682 / `run-probe-manifest.ts` for #683).

### Usage

```bash
# Offline parity — no services needed
npx tsx scripts/verify/savant-trader-scanner-row-actions-1304-contracts.ts

# Live call — requires the RH MCP executor at http://127.0.0.1:3456
npx tsx scripts/verify/savant-trader-scanner-row-actions-1304-live.ts
```

**Pass (offline):** every check prints `OK`, ends `=== PASS ===` (exit 0).
`WARN` lines mark declared fields never observed in captures —
informational, not failures.

**Pass (live):** every check prints `OK`, ends `=== PASS ===` (exit 0).
A healthy run reports ~250 `day` bars for a 1-year AAPL range.

**Fail:** the offending check prints `FAIL` with detail — a wire field not
declared in the contract, an envelope mismatch, or an unreachable
executor. Exit 1.

## Setup / teardown

Read-only `get_equity_historicals` call — no account mutation, no
Firestore, no teardown.
