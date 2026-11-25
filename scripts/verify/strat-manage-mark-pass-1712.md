# Verification — #1712 Unified position-grain mark pass

**Task:** #1712 — BE-IMPL: unified position-grain mark pass (per-leg → signed net)
**Topic:** #137 — Strategy Manager · Thread #1690 — Live Position Lifecycle · Blueprint #1708 (BE)

## What it verifies

The mark pass moved from instance-grain (`runMarkPassForAllInstances`
enumerated `st-strategy-instances` and marked `findPrimaryLeg` only) to
position-grain (`runMarkPass` sweeps every OPEN trade carrying option
legs — the same `st-paper-trading/trades/items` store legacy and manage
positions share). The script runs the **real** `runMarkPass`,
`runUnifiedMarkPass`, and `tradeToPosition` — only the three I/O seams
(`listOpenOptionTrades`, `quoteProvider`, `markPositionLegs`) are faked.

| Pipeline stage | What a green run proves |
|---|---|
| Selection | `isOpenOptionPosition` — OPEN trades with ≥1 option leg mark; stock-only and non-OPEN trades are skipped; no instance enumeration |
| Quoting | Option legs are quoted per position, batched per leg **side** (quote `side` stamps stay honest); a missing contract only fails its own position |
| Per-leg marks | `legMarks` (contractID → mark) gives every option leg its own `lastMark`; share legs keep their stored mark |
| Signed valuation | `currentValue` = `netMarkValue` (liquidation space — credit spreads negative, debits positive); `unrealizedPnl = signedEntryPremium + netMark` — no posture branching |
| Mark convention | `marks[date].mark` stays in the order-level exit-price space (`orderPriceForLiquidationValue` — SHORT order: cost to buy back, LONG order: proceeds to sell); one raw-quote doc per position per PT market date carrying the leg-quote array |
| Error isolation | Provider throws / missing leg quote / missing contractID → that position errors, others still mark; no partial writes |
| Position view | `tradeToPosition.currentValue` is the signed net |
| Orchestrator | `runUnifiedMarkPass` wires the provider in, returns `{positions, errors}`, and captures a pass-level throw as `{error}` |

## Usage

```bash
npx tsx scripts/verify/strat-manage-mark-pass-1712.ts
```

No credentials, no Firestore — fixture trades flow through the real pass
(`firebase-admin-init` is parameterless and lazy; nothing is called).

**Pass:** every `OK` line prints and the script exits 0 (`ALL CHECKS PASSED`).
**Fail:** the offending check prints `FAIL` with the expected value; exit 1.

## Live environment note

The scheduled `optionsMarkPass` timer (`*/30 13-20 * * 1-5` UTC) and the
`optionsMarkPassManual` callable exercise this same code path against prod
Firestore + the RH MCP quote provider — the deploy itself is the live
verification. A manual callable run post-deploy should show manage +
legacy positions marking in one sweep (`{markPass: {positions, errors}}`).
