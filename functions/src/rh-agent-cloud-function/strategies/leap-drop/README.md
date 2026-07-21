# 75-Delta LEAP Drop Strategy

## Purpose

This is the proof-of-concept options backtesting strategy.

It looks for a one-day drop in the underlying and buys a long-dated, high-delta
option. The default is a **75-delta call** (a LEAP) entered when the underlying
closes down at least **1%** from the previous close.

The position is exited when any of the following is met:

- **Target gain** — the option mark reaches the configured gain target.
- **Stop loss** — the option mark falls to the configured stop level.
- **Max hold days** — the position has been held for the configured maximum.

All entry and exit prices use the Alpha Vantage `mark` field from
`partnerHistoricalOptionsV2`.

## Entry rule

Evaluate at the close of the day the condition is met:

```
(todayClose - yesterdayClose) / yesterdayClose <= -dropPct
```

If true, generate a `D_LEAP_DROP_LONG` signal.

## Option selection (single leg)

| Property | Default | Meaning |
| --- | --- | --- |
| `optionType` | `call` | `call` or `put`. |
| `targetDelta` | `0.75` | Target absolute delta. |
| `targetDte` | `365` | Target days to expiration. |
| `minDte` | `180` | Minimum DTE; contracts below this are excluded unless no match exists. |
| `maxDte` | `730` | Maximum DTE; contracts above this are excluded unless no match exists. |
| `requireMark` | `true` | Only contracts with a valid `mark` price are eligible. |

The selection helper picks the contract whose delta is closest to `targetDelta`,
with a secondary preference for DTE near `targetDte`. If no contract falls
inside `[minDte, maxDte]`, the helper relaxes the DTE bounds and selects the
closest overall match.

## Exit rules

The backtest engine evaluates exits on every subsequent close:

| Exit | Default | Condition |
| --- | --- | --- |
| Target gain | `1.0` | `mark >= entryMark * (1 + targetGainPct)` |
| Stop loss | `0.5` | `mark <= entryMark * (1 - stopLossPct)` |
| Max hold | `252` | `daysSinceEntry >= maxHoldDays` |

For a `1.0` target gain, the exit price is `2.0 * entryMark` (a 100% gain).
For a `0.5` stop loss, the exit price is `0.5 * entryMark` (a 50% loss).

## Parameters

| Parameter | Type | Default | Min | Max | Step | Possible values |
| --- | --- | --- | --- | --- | --- | --- |
| `dropPct` | number | `0.01` | `0.001` | `0.5` | `0.005` | Any decimal drop threshold. |
| `targetGainPct` | number | `1.0` | `0.05` | `5.0` | `0.05` | Gain multiple for exit. |
| `stopLossPct` | number | `0.5` | `0.05` | `0.95` | `0.05` | Loss multiple for exit. |
| `maxHoldDays` | integer | `252` | `5` | `1000` | `5` | Maximum calendar days in trade. |
| `targetDelta` | number | `0.75` | `0.5` | `0.95` | `0.05` | Target option delta. |
| `targetDte` | integer | `365` | `30` | `1095` | `30` | Target DTE. |
| `minDte` | integer | `180` | `30` | `730` | `30` | Minimum DTE. |
| `maxDte` | integer | `730` | `90` | `1825` | `30` | Maximum DTE. |
| `optionType` | string | `call` | — | — | — | `call`, `put` |
| `maxConcurrentPositions` | integer | `0` | `0` | `100` | `1` | `0` = unlimited, otherwise max open positions. |

## Sweep behavior

All numeric parameters are sweepable in the backtest UI. Each combination of
`symbol + strategy + parameter permutation` becomes its own Cloud Task. The
Calmar ratio (or another accepted return-to-drawdown score) is used as the
optimization objective.

## Timeframe

This strategy runs on **daily bars** only. Weekly and monthly bars are not
required.

## Metadata emitted per signal

```json
{
  "strategy": "leap-drop",
  "entry": { "trigger": "1-day drop >= dropPct", "dropPct": 0.01 },
  "optionLegs": [
    {
      "side": "long",
      "quantity": 1,
      "criteria": {
        "type": "call",
        "targetDelta": 0.75,
        "targetDte": 365,
        "minDte": 180,
        "maxDte": 730,
        "requireMark": true
      }
    }
  ],
  "exit": {
    "targetGainPct": 1.0,
    "stopLossPct": 0.5,
    "maxHoldDays": 252
  }
}
```
