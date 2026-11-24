**Topic:** Strategy Manager  
**Topic Slug:** strat-manage  
**Thread:** Live Position Lifecycle  
**Thread Slug:** live-position-lifecycle  
**Issue:** #1699  
**Thread Parent:** #1690  
**Topic Parent:** #137  
**Domain:** BE  
**Type:** IMPL  
**Status:** Draft  
**Created:** 2026-11-23  
**Last Updated:** 2026-11-23  

# IMPL-BE: position-grain mark + settle passes

## Architecture overview

Build the manage side's missing lifecycle on the legacy cadence — but **position-grain**, not instance-grain:

1. **Unified mark pass** — every 30 min (6:50 AM–1 PM PT weekdays, the existing `optionsMarkPass` cadence), iterate `OPEN` option-leg trades (both eras), batch per-leg quotes through the existing RH MCP `BatchQuoteProvider`, write each leg's `lastMark` + signed `netMark` → `currentValue`/`unrealizedPnl`. At each tick, shadow-evaluate all 6 `EXIT_STRATEGIES` rules on the fresh net mark and accumulate first-fire + latest-eval into `st-options-analysis-results`.
2. **Position-grain settlement** — nightly post-SDS, iterate `OPEN` option-leg trades whose last leg expired, settle via repurposed legacy machinery (underlying expiration close with lookback → OTM worthless / ITM assignment → `ASSIGNED_HOLDING_SHARES` + held-shares daily marks). Legacy zombies settle naturally on first run — no groom.
3. **2 PM scan → EOD finalizer** — `manageExitScanTimer` keeps running as the SA-series analytics fallback (survives RH credential outages), slimmed: no longer the primary evaluator, reconciles/finalizes the day's matrix.

Instance enumeration (`listManageableInstances` + its `runState === undefined` fence) stops being the lifecycle entry point for the covered passes — selection is `queryTrades({status: OPEN})` + option-legs predicate (SHARED contract).

## Boundary

- BE owns: pass implementations, timers, quote batching, position/repo writes, exit-eval wiring, settlement + held-shares.
- SHARED provides: netMark/P&L helpers, selection predicate, variant-name contract.
- FE consumes: marked/settled fields + analysis docs unchanged in shape (plus `firstFiredAt` additions).
- Out: signal stock-trade marks/settlement (existing `signal-mark-pass`/`signal-settlement-pass` own those — disjoint via the option-legs predicate); position-group minting (#1703 → #553).

## Files

- `functions/src/paper-trading/engine/passes/mark-pass.ts` — extend or sibling `manage-mark-pass.ts`: position-grain selection, all-legs quote fan-out (replace `findPrimaryLeg`), signed net writes. Decide extend-vs-sibling at impl — the single-leg limitation must die for the covered positions either way.
- `functions/src/paper-trading/engine/passes/settlement-pass.ts` — position-grain selection; leg-expiry = last-leg rule.
- `functions/src/paper-trading/engine/passes/held-shares-pass.ts` — same selection contract for `ASSIGNED_HOLDING_SHARES`.
- `functions/src/paper-trading/engine/passes/manage-exit-scan-pass.ts` — slim to EOD finalizer; tick-eval writes the same `AnalysisResultDoc` shape + `firstFiredAt`.
- `functions/src/paper-trading/engine/position-repository.ts` — per-leg mark write (each leg's own `lastMark`, not one order-level stamp); settled writes unchanged.
- `functions/src/paper-trading/engine/trade-adapter.ts` — `currentValue` adopts signed `netMark` (the shared helper).
- `functions/src/paper-trading/engine/options-strategy-pass-orchestrators.ts` — swap instance enumeration for position-grain selection on covered passes.
- `functions/src/index.ts` — timer exports unchanged or +1 manual callable for hand-driving.

## Contracts

- Selection: `queryTrades({status: OPEN})` filtered by `hasOptionLegs` (SHARED) — spec: signal stock trades excluded, STOPPED-instance positions included.
- Mark result per position: `legs[].lastMark`, `currentValue = netMark`, `unrealizedPnl`, `currentValueAsOf = quote.asOf`, raw quote write (existing convention).
- Exit eval: `AnalysisResultDoc` shape preserved + `firstFiredAt`/fired-mark fields; per-tick eval is idempotent (first-fire sticks, latest-eval updates).
- Settlement outcome: `EXPIRED_WORTHLESS` / `ASSIGNED_HOLDING_SHARES` (+ shares record) / `CLOSED`, `realizedPnl` — legacy `markPositionSettled` write shape reused.

## Decisions

- Position-grain, runState-agnostic — STOPPED means "no new opens"; open positions always finish their lifecycle (legacy orchestrator semantics, generalized).
- One unified pass covers both eras — fixes legacy single-leg marking as a bonus; no parallel manage-only pass.
- Options run to expiration — exits are analytics never real closes (v1); no close writes from eval.
- 2 PM scan stays (EOD finalizer) rather than retire — SA-series path survives credential outages.
- Per-leg expiry: position settles when its **last** leg expires; per-leg outcomes recorded via existing `LegOutcome` writes.
- Settlement fires on underlying expiration close — resolution, not trading (EOD is correct here).

## Sequence / phases

- **P1 — Mark pass:** position-grain selection → per-leg quotes → signed net writes → spec the posture matrix. Then per-tick shadow-eval + first-fire accumulation into analysis docs.
- **P2 — Settlement + held-shares:** position-grain selection → legacy settle machinery → leg-expiry semantics → held-shares marking. Includes zombie-sweep verification (48 `260819-*` rows settle on first run).
- **P3 — Scan slimming:** tick-eval proven → `manageExitScanTimer` becomes EOD finalizer (or thin reconcile); analysis-doc shape stable throughout.

## Prior art / regression

- `optionsMarkPass` (30-min timer), `BatchQuoteProvider`, `markPosition`, `computeUnrealizedPnl` — reuse.
- `settlement-pass.ts` — expiry detection (missed-night retry #724), ITM/OTM on expiration close + lookback, `markPositionSettled`, `checkBrokerageOutcome` (stays unused).
- `held-shares-pass.ts` — `ASSIGNED_HOLDING_SHARES` daily marks vs strike basis.
- `manage-exit-scan-pass.ts` — SA-series rebuild + `EXIT_STRATEGIES` + analysis-doc writes.
- `paper-stats-pass` (#1565) — already trade-grain; rolls up manage trades — needs nothing.

## Verify relay

- Specs with injected deps (quote provider, repo, evaluators, close reader) — established pattern.
- `functions/scripts/verify/` script over the real pass wiring per convention.
- Regression: legacy positions keep marking correctly; `tradeToPosition` signed `currentValue` feeds the dashboard.

## Risks / open seams

- Quote volume: ~13 ticks × legs — batch sizing against RH MCP limits; failures must not stall other positions (per-position error isolation, existing pattern).
- RH credential outage → marks + tick-eval pause (canary already probes this path); EOD scan backstops analytics.
- Multi-leg expiry where legs differ (IC same-expiry typical; calendar/diagonal splits differ) — last-leg rule pinned by specs; per-leg `LegOutcome` handles partial assignment.
- Zombies: ITM `260819-*` rows will spawn `ASSIGNED_HOLDING_SHARES` — semantically correct; confirm acceptable.
- First-fire idempotence across restarts/missed ticks.
