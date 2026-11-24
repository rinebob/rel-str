**Topic:** Strategy Manager  
**Topic Slug:** strat-manage  
**Thread:** Live Position Lifecycle  
**Thread Slug:** live-position-lifecycle  
**Issue:** #1699  
**Thread Parent:** #1690  
**Topic Parent:** #137  
**Domain:** SHARED  
**Type:** IMPL  
**Status:** Draft  
**Created:** 2026-11-23  
**Last Updated:** 2026-11-23  

# IMPL-SHARED: contracts for the manage position lifecycle

## Architecture overview

Three shared contracts, all in `shared/` and consumed by both the BE passes and the FE dashboard:

1. **Signed net-mark + uniform P&L** — formalize the convention the backtest already uses: `netMark = Σ (sign × leg_mark × 100 × qty)` with long `+1`, short `−1`; `unrealizedPnl = signedEntryPremium + netMark` for every posture (credit and debit alike, no branching).
2. **Position-selection predicate** — the single definition of "what a lifecycle pass touches": `status == OPEN` AND the trade carries option legs. Era-agnostic (legacy + manage docs), source-agnostic (strategy + future signal option trades), runState-agnostic.
3. **Canonical variant identity** — one ID grammar + one display-name generator; `manage-variant-catalog` is THE registry. Fixes the CDS name-segment shuffle. Backtest adoption is #1692's consumer task — this contract only guarantees the grammar is stable and single-sourced.

## Boundary

- `shared/` owns: types, pure functions (netMark, unrealizedPnl, posture helpers, ID parse/format, display-name gen), the selection-predicate constant/type, catalog contract.
- BE consumes: mark pass (net valuation), settlement (leg-expiry semantics), shadow-eval (netMark fed to rules), contract-list/analysis writers.
- FE consumes: display-name generator output, signed `currentValue`/`premium` contract semantics.
- NOT here: Firestore reads/writes, timers, quote providers (BE); rendering (FE).

## Files

- `shared/manage-variant-catalog.ts` — grammar + name-gen become canonical here (or extracted to a new `shared/variant-identity.ts` if the catalog import graph argues for it — decide at impl).
- `shared/options-position-math.ts` (new, or extend the existing shared net-mark module the backtest uses — locate `buildNetSeries`/`netMark` home and consolidate rather than fork).
- `shared/paper-trading-contracts.ts` — `signedEntryPremium` / posture vocabulary if it isn't already expressed; extend rather than duplicate.
- `shared/manage-instance-contracts.ts` — unchanged unless the selection contract needs a trade-shape type.
- Specs beside each (`*.spec.ts` convention).

## Contracts

- `netMark(legs: {side, mark, multiplier?, qty}[]): number` — pure, signed, `×100×qty` inside.
- `unrealizedPnl(signedEntryPremium, netMark): number` — one line, pinned by specs for all four spread postures + naked strangle.
- `signedEntryPremium(trade): number` — credit positive, debit negative — the field or derivation the position doc must expose.
- `hasOptionLegs(trade): boolean` — the selection predicate; spec-pinned against signal stock trades (no legs → excluded) and manage/legacy option trades.
- `variantDisplayName(idOrVariant): string` — segment-order-safe; `SPY-CDS-30-50-40` → "call debit spread 30-50 40" (spec-pinned round-trip: parse → render → re-parse).

## Decisions

- One P&L formula — no posture branching anywhere in callers.
- The position-selection contract is expressed on the **trade doc shape** (option legs present), NOT `strategyInstanceId` — signal-source option trades carry no instance id.
- Variant catalog: manage registry is canonical; no REPLAY_VARIANTS merge in this thread (#1692 adopts).
- `positionGroupId` is out of scope here — minted by #553's paths (#1703 covers the curated-mint gap).

## Sequence / phases

1. Locate + consolidate the existing shared net-mark code the backtest uses; extract uniform helpers.
2. Variant ID grammar + display-name gen + CDS fix (spec-pinned).
3. Selection predicate + trade-shape contract.

## Prior art / regression

- `buildNetSeries`/`netMark` in the shared backtest modules — same convention; consolidate, don't fork.
- #1500's posture normalization (credit = cost-to-close, debit = liquidation value) — same math this formalizes for live.
- `tradeToPosition`'s unsigned `Σ lastMark` is the regression site — its `currentValue` must adopt `netMark` output (BE task applies it; the contract lives here).
- CDS shuffle: `SPY-CDS-30-50-40-ALL` rendering "call debit spread 50-40 30" — the canonical name-gen fixes it; spec pins the round-trip.

## Verify relay

- `npx jest shared/` green; round-trip specs for ID ↔ name; posture matrix specs (CCS/PCS/CDS/PDS + strangle) pin the formula.
- Hand-off: BE consumes the helpers in mark/settle passes; FE binds `variantDisplayName` + signed fields.

## Risks / open seams

- Where the existing backtest net-mark code lives — consolidation could touch backtest imports (coordinate: #1692 consumes the same contract).
- If `signedEntryPremium` isn't already on the trade doc, a contract addition ripples to open-pass writers — check `premiumCollected`/`capitalRequired` shape first.
