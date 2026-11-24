**Topic:** Strategy Manager  
**Topic Slug:** strat-manage  
**Thread:** Live Position Lifecycle  
**Thread Slug:** live-position-lifecycle  
**Issue:** #1691  
**Thread Parent:** #1690  
**Topic Parent:** #137  
**Domain:** STRAT-MANAGE  
**Type:** PRD  
**Status:** Approved  
**Created:** 2026-11-23  
**Last Updated:** 2026-11-23  

# PRD: Live Position Lifecycle — manage positions that mark, settle, and tell the truth

## Problem Statement

Manage-created strategy instances produce positions that are **written once at open and never touched again**. The open pass writes `unrealizedPnl: 0` and freezes each leg's `lastMark` at its entry premium. From that moment:

- The 30-minute intraday mark pass, the nightly settlement pass, and the stats rollup all iterate `listManageableInstances`, which filters to `runState === undefined` — the **legacy** engine docs. Manage instances (which always carry `runState`) are structurally invisible to every lifecycle pass.
- The dashboard therefore shows `Unrealized = $0.00` forever, `Current` frozen at an unsigned gross of entry marks, and expired positions that will remain `OPEN` permanently — zombies by construction.
- The 2 PM shadow exit scan exists only because positions carry no marks: it rebuilds each leg's price series from SA partner historical data, shadow-evaluates all 6 exit rules, and writes the analysis matrix. It never mutates the position — and its EOD prices are ones no live trade could ever access anyway.

Net effect: the manage surface can open positions but cannot observe them. Paper trading v1 produces a dashboard of dead numbers.

## Solution

Give manage positions the same lifecycle the legacy engine already has — on the legacy cadence — with three corrections the legacy machinery never had:

1. **Intraday marks, per-leg, signed.** Every 30 minutes during market hours (6:50 AM–1 PM PT, weekdays — the existing `optionsMarkPass` cadence), fetch RH MCP quotes for **every leg** of every open manage position, compute the signed net mark (`long +1, short −1` — the convention the backtest's `netMark`/`buildNetSeries` already defines), and write `currentValue` / `unrealizedPnl` / per-leg `lastMark` back to the position doc.
2. **Shadow-eval rides the mark tick.** At each tick, evaluate all 6 `EXIT_STRATEGIES` rules against the position's fresh net mark and record **first-fire timestamps** into the analysis docs. This replaces the 2 PM SA-series replay's function with intraday-accurate data ("stop-200 would have fired at 10:20 AM" instead of "by EOD"). Options positions always run to expiration — exits are analytics, never real closes, in v1.
3. **EOD settlement.** Repurpose the legacy settlement machinery — expired legs resolve on the underlying's expiration-date close (walked back over weekends/holidays): OTM → worthless, ITM → assignment → `ASSIGNED_HOLDING_SHARES` with daily share marks against the strike cost basis. Settlement is inherently an EOD event (options expire at the close); it is resolution, not trading.

Two cross-cutting decisions:

- **Position-grain selection.** Lifecycle passes iterate *open positions* directly, not instances. `runState` gates opens only — a STOPPED instance's open positions keep marking and settling to expiry. STOPPED means "no new opens," not "freeze."
- **Canonical variant grammar + unified catalog.** One ID grammar and one display-name generator across backtest and live. The manage catalog (`shared/manage-variant-catalog.ts`) becomes THE registry; Thread #1692 (Backtest Consolidation) adopts it for the backtest side and the promote-to-instance seam. Fixes the CDS name-segment shuffle.

Plus dashboard remediation so the new data is actually readable: signed net `Current`, debit-aware premium display, multi-leg leg rendering, population-scope coherence, and row links into Manage/Analysis.

## System Context

```mermaid
flowchart LR
    subgraph Schedulers
        T1["manageOpenPassTimer\n12:00 PT"]
        T2["mark ticks\n*/30m 6:50AM–1PM PT"]
        T3["nightly settlement\npost-SDS"]
    end

    subgraph Manage Domain
        I["ManageInstance\n(runState)"]
        P["PaperTrade position\n(legs[].lastMark,\ncurrentValue, uP&L)"]
        A["st-options-analysis-results\nshadow exit matrix"]
    end

    subgraph Providers
        Q["RH MCP quote provider"]
        SDS["symbol-data daily bars"]
    end

    subgraph Legacy Domain — untouched
        L["StrategyInstanceConfig\n(no runState) + its passes"]
    end

    T1 -->|opens| I --> P
    T2 -->|per-leg quotes| Q -->|signed net mark| P
    T2 -->|first-fire eval| A
    T3 -->|expiry close| SDS -->|worthless / assign| P
    P --> D["Strategy Dashboard"]
    A --> D
    A --> AN["Analysis page"]
```

## User Stories

### US-1 — Live position marks

As a trader watching the dashboard, I want my open positions marked against real option prices during market hours, so that `Current` and `Unrealized` reflect the position's actual value, not its entry price.

*Acceptance criteria:*
- During market hours, every open manage position's `currentValue` updates at each 30-minute tick from per-leg RH quotes.
- `currentValueAsOf` reflects the quote timestamp, so staleness is visible.
- A position whose instance is STOPPED still marks; a position only stops marking when closed/settled.
- `unrealizedPnl` satisfies `signedEntryPremium + netMark` for both credit and debit postures with no posture-branch code paths.

### US-2 — Signed net Current for multi-leg

As a trader, I want the `Current` column to be the signed net value of my whole position, so that a 4-leg iron condor shows its real cost-to-close instead of a gross sum of all four marks.

*Acceptance criteria:*
- `Current` = `Σ (sign × leg_mark × 100 × qty)`, short `+` long `−` convention applied consistently.
- A credit position's current value is a negative liability (cost to close); a debit position's is a positive asset (liquidation value).
- `tradeToPosition`'s unsigned `Σ lastMark` is replaced; the Results dialog and analysis page agree with the dashboard on the same number.

### US-3 — Debit-aware premium display

As a trader running debit structures, I want the dashboard to show what I paid, so that a debit spread doesn't display `Premium $0.00` as if nothing happened.

*Acceptance criteria:*
- The premium column carries signed net premium semantics: credit collected shows positive, debit paid shows its cost — never `$0.00` for a live position.
- Label or formatting distinguishes "collected" from "paid" without requiring the user to know the posture.

### US-4 — Automatic expiry settlement

As a trader, I want positions that reach expiration to close themselves, so that expired options don't sit OPEN forever.

*Acceptance criteria:*
- A position whose last leg has expired settles on the next nightly pass (missed nights retry — never zombies).
- OTM legs expire worthless; ITM legs produce the assignment outcome.
- Settlement uses the underlying's close on the expiration date, walking back over weekend/holiday expirations.
- Settled positions carry `realizedPnl` and move from the open table to the closed table.

### US-5 — Assignment → held shares

As a trader whose short leg assigned, I want the resulting share position tracked and marked daily, so that the dashboard keeps telling the truth after assignment.

*Acceptance criteria:*
- An assigned position transitions to `ASSIGNED_HOLDING_SHARES` with a shares record (quantity, strike cost basis).
- Held shares mark daily against the share close, not an option mark.
- Realized option P&L at assignment is recorded; share P&L accrues against basis.

### US-6 — Intraday shadow-exit matrix

As a trader evaluating exits, I want each exit rule's hypothetical outcome tracked intraday, so that the analysis matrix shows *when* a rule would have fired, not just that it would have by EOD.

*Acceptance criteria:*
- Every open position shadow-evaluates all 6 `EXIT_STRATEGIES` rules at each mark tick.
- Each rule records its first-fire timestamp and the mark that triggered it; the analysis doc accumulates these.
- The matrix matches what the 2 PM scan produces at EOD boundaries — no analytics regression.
- The dedicated SA-replay scan is retired or reduced to an EOD finalizer (blueprint decides); no part of analytics depends on prices unreachable by live trades.

### US-7 — Canonical variant identity

As a user creating variants in either surface, I want one ID grammar and one display name everywhere, so that `SPY-CDS-30-50-40` reads correctly in the manage table, the backtest run list, and future promote flows.

*Acceptance criteria:*
- One ID grammar + one name generator in `shared/`; the manage catalog is the canonical registry.
- The CDS name-segment shuffle is fixed and pinned by specs (id → name round-trips).
- Backtest-side adoption is documented as #1692's consumer task; the shared contract doesn't fork.

### US-8 — Dashboard leg display

As a trader with multi-leg positions, I want to see all my legs, so that an iron condor doesn't render as a single strike and expiration.

*Acceptance criteria:*
- Multi-leg rows expose every leg (expand, popover, or leg-aware cell — FE design decides).
- Primary-leg fields remain the sort anchor; the leg detail is one interaction away.

### US-9 — Population-scope coherence

As a user flipping the population selector, I want the stats and the tables to agree, so that "Signals" doesn't show signal stats over strategy-only rows.

*Acceptance criteria:*
- Either tables become population-aware or the UI explicitly labels the split — no silent mismatch.
- The chosen behavior is spec-pinned.

### US-10 — Row → destination links

As a user on the dashboard, I want each row to take me somewhere, so that monitoring isn't a dead end.

*Acceptance criteria:*
- Each position row links to its manage instance and/or its analysis page.
- Links deep-link correctly (instance-scoped view or analysis `:listDocId` route).

## Implementation Decisions

### Pass architecture

- **Cadence:** the existing 30-minute mark timer (6:50 AM–1 PM PT weekdays) gains manage coverage — blueprint decides whether that's one position-grain mark pass covering both eras or a manage-side sibling sharing `BatchQuoteProvider`, raw-quote writes, and the mark repo writer. Reuse over rebuild.
- **Selection:** open positions directly (position-grain), grouped for batch quote calls. No `runState` gate — STOPPED keeps managing existing positions.
- **Marking:** per-leg quotes → each leg's `lastMark` + signed net `currentValue`/`unrealizedPnl`. Replaces `findPrimaryLeg` single-leg marking for the manage path.

### Exit evaluation

- Shadow-eval of all 6 rules per tick, first-fire accumulation. The `EXIT_STRATEGIES` registry + evaluators are reused; credit-native rule semantics on debit structures remain a known gap → flagged for #1692 (debit-aware rules) rather than forked here.

### Settlement

- Legacy settlement pass repurposed: expiry detection, ITM/OTM on underlying expiration close with lookback, `markPositionSettled`, `LegOutcome` updates, `ASSIGNED_HOLDING_SHARES` + held-shares daily marks.
- Multi-leg expiry: position expires when its **last** leg does (legs typically share expiry; the rule must not settle a position with a live leg) — blueprint pins per-leg vs last-leg outcome semantics.
- `checkBrokerageOutcome` hook stays unused in paper v1.

### Contracts

- Signed `netMark` convention formalized in `shared/` — `unrealizedPnl = signedEntryPremium + netMark` is the single P&L formula for both postures.
- Canonical variant ID grammar + display-name generator in `shared/`; `manage-variant-catalog` is the canonical registry.

### Open unknowns flagged for blueprint

- The manage stats-rollup writer is unidentified — dashboard stats docs exist but the writer path isn't pinned. Blueprint must locate it or declare stats in-scope.
- Whether the 2 PM `manageExitScanTimer` is retired outright or survives as an EOD finalizer.
- Zombie `260819-*` positions: explicitly not groomed — the dashboard may need an expired-but-open filter to keep them from drowning live rows.

## Testing Decisions

- Passes built with injected deps (quote provider, position repo, exit evaluators, underlying-close reader) — the established pattern in this codebase.
- Specs pin: per-leg mark fan-out, signed net math for all 4 postures (CCS/PCS/CDS/PDS + strangle/IC), STOPPED-instance positions still marked/settled, missed-night settlement retry, first-fire idempotence across ticks.
- Verify scripts in `functions/scripts/verify/` exercising the real pass wiring where the convention applies.

## Out of Scope

- Real exit application for options — positions run to expiration; configured exits are shadow analytics only (v1).
- Legacy `260819-*` zombie cleanup/migration — not groomed, only possibly filtered from display.
- Legacy engine retirement — passes left untouched, draining population.
- Stock/signal-trade stop semantics (initial stop → loosest rule post-breakeven) — separate domain (#553 side), parked.
- Real-account trading, `checkBrokerageOutcome`, credential-gated live order paths.
- Backtest-side catalog adoption + promote-to-instance — #1692 consumes this thread's shared contract.
- Debit-aware exit rules — #1692 scope (shared registry).

## Technical Context

- Marks refresh on a 30-minute cadence, not real-time; `currentValueAsOf` is the honesty field for staleness.
- Mark ticks depend on the RH MCP credential path (same path as noon opens; the 7 AM canary already probes it). A credential outage pauses marks + shadow eval — positions stay at last mark, analytics stall; no trades are missed since options never trade intraday in v1.
- Settlement requires nightly `symbol-data` bars — runs post-SDS like the legacy pass.
- Quote volume: ~13 ticks/day × legs/position; batched through the existing provider.

## Further Notes

- The collection partition (`runState` discriminator on `st-strategy-instances`) is deliberate and stays — "reused root, new schema." This thread builds the missing manage-side lifecycle on top of it rather than migrating data.
- The legacy daily-open ladder created ~9× duplicate positions per instance — a defect class the manage model (one instance, explicit start/stop) eliminates by design; no dedupe work needed for manage positions.
