**Topic:** ST Firestore Reorg  
**Topic Slug:** st-firestore-reorg  
**Thread:** Pass Family Consolidation  
**Thread Slug:** pass-family-consolidation  
**Issue:** #1475  
**Thread Parent:** #987  
**Topic Parent:** #984  
**Domain:** DATA-PIPELINE  
**Type:** PRD  
**Status:** Approved  
**Created:** 2026-11-15  
**Last Updated:** 2026-11-16  

# PRD — Stats Pipeline Consolidation

## Problem

Paper-trading stats are computed **twice nightly over the same trades** into
two namespaces in the same `st-paper-trading/stats/items` collection:

| Writer | Docs written | Reader |
|---|---|---|
| Engine `runStatsPass` (per instance, nightly) | `stats-{instanceId}` + `stats-ALL` — strategy-only population | `getStrategyEquityCurve` → options-strategy dashboard (the only consumer) |
| `runPaperStatsPass` (nightly) | `stats-all`, `stats-inst-{id}`, + ~10 slice families — all sources | `getPaperStats` → paper dashboard |

Same builder (`buildStatsId` → `stats-${scope}`), same `recomputeStats` seam,
same underlying trades — "legacy" is purely an unprefixed scope string. The
two truths can silently disagree, and `listStats()` already surfaces the
legacy docs as visible duplicate scopes on the paper dashboard.

A second asymmetry: `incrementStatsOnOpen` bumps the **legacy** docs live on
every strategy open (open count + premium), while signal opens, all closes,
and all settlements wait for the nightly recompute. Stats freshness is
"live in the up direction, strategy only."

The substrate merge this thread once waited on already landed (#562 + #1007):
engine positions ARE `PaperTrade` docs (`source: STRATEGY` +
`strategyInstanceId`) in `st-paper-trading/trades/items`. This is a
compute/read-path consolidation — no data migration of trades.

## Concept

One canonical stats pipeline. Full transition — no shim, no legacy namespace
(prototype; nothing external depends on the legacy docs).

1. **`src-{source}` scope family** — new `statsScopeSource` builder emits
   `src-SIGNAL` / `src-STRATEGY`; `tradeScopes` adds it so the nightly pass
   writes `stats-src-SIGNAL` / `stats-src-STRATEGY`. Replaces `stats-ALL`
   (strategy-only) with an *explicit* per-source rollup — the dashboard gets
   a population selector instead of a silently widened "all".
2. **Ledger-level increment seam** — the five lifecycle functions in
   `ledger.ts` are the single choke point for every open/close across both
   sources. Status-transition-triggered increments inside `applyEntryFill`,
   `applyPendingFill`, and `applyExitFill` — plus an explicit call in the
   engine's direct-write `settlePosition` — make opens live for ALL sources
   and closes live for the first time. Bounded to the dashboard-live scopes
   (`all` + `src-{source}` + `inst-{id}`); long-tail slices and the
   daily-granularity equity curve stay nightly. The nightly recompute remains
   the self-healing source of truth — increments are freshness only.
3. **One read path** — `getPaperStats` (canonical) replaces
   `getStrategyEquityCurve` on the strategy dashboard; the callable and its
   legacy adapters are deleted.
4. **Legacy retirement** — `runStatsPass`, `incrementStatsOnOpen`, the
   callable, the shape adapters, and the stale `stats-ALL` /
   `stats-{instanceId}` docs all die.

## User stories

### US-1: Source scope family

**As a** dashboard user, **I want** a per-source stats rollup, **so that**
"Strategy" vs "Signal" populations are explicit choices, not a hidden
widening of the combined view.

Acceptance criteria:

- [ ] `statsScopeSource(source)` in `shared/paper-trading-ids.ts` returns
  `src-${source}` (source is the uppercase `PaperTradeSource` enum →
  `src-SIGNAL`, `src-STRATEGY`); covered by the existing id-builder spec.
- [ ] `tradeScopes` in `paper-stats-pass.ts` includes the source scope for
  every trade.
- [ ] After a nightly pass, `stats-src-SIGNAL` and `stats-src-STRATEGY` exist
  (populated scopes only — a source with zero trades writes no doc, matching
  the existing per-scope convention).
- [ ] `src-STRATEGY` population == trades with `source: STRATEGY`;
  `src-SIGNAL` == `source: SIGNAL`; `all` == both.

### US-2: Ledger increment seam — opens

**As a** dashboard user, **I want** open-count and premium stats to update
intraday for any paper trade, **so that** the stats card reflects reality
within seconds regardless of how the trade was opened.

Acceptance criteria:

- [ ] A shared `incrementStatsOnTransition(trade, event)` helper (in
  `stats-repository.ts` or a new `stats-increments.ts`) computes scopes
  `[all, src-{source}, inst-{id}?]` and applies field deltas in one
  Firestore transaction — a partial failure can't leave scope docs diverged.
- [ ] `applyEntryFill` and `applyPendingFill` invoke it on transition into
  `OPEN` — covering strategy opens, signal fills, expression fills,
  auto-paper ingest, and manual entries with zero per-callsite wiring.
- [ ] Open deltas: `openTradeCount +1`, `totalPremiumCollected += entry
  premium` (derived from the fill's signed cash delta — same inputs the
  ledger already computes).
- [ ] `createPendingTrade` and `cancelPendingTrade` fire no increment —
  pending/cancelled trades were never open.
- [ ] `incrementStatsOnOpen` and its `open-pass.ts` call are deleted — the
  ledger seam strictly replaces it (and would double-count alongside it).

### US-3: Ledger increment seam — closes + settlement

**As a** dashboard user, **I want** closes and settlements reflected
intraday too, **so that** open counts don't inflate upward until the
nightly pass.

Acceptance criteria:

- [ ] `applyExitFill` fires the increment **only on transition to a terminal
  status** (`CLOSED`) — a partial exit that leaves the trade `OPEN` must not
  decrement.
- [ ] `settlePosition` (`engine/position-repository.ts`) — the one direct
  write path that bypasses `applyExitFill` — invokes the same helper on
  transition to `EXPIRED` / `ASSIGNED`.
- [ ] Close/settle deltas: `openTradeCount −1`, `closedTradeCount +1`,
  `totalRealizedPnl += exit pnl` — exact deltas mirror
  `computeStatsFromPositions` semantics for the same transition (e.g.,
  whatever the nightly pass counts for `ASSIGNED_HOLDING_SHARES`, the
  increment mirrors).
- [ ] Nightly `runPaperStatsPass` still recomputes every scope from scratch —
  it is the correction mechanism; increments are never authoritative.

### US-4: Strategy dashboard on canonical read path

**As a** strategy-dashboard user, **I want** a scope selector (All /
Strategy / Signal / per-instance) reading canonical stats docs, **so that**
there is one stats read path and the population is explicit.

Acceptance criteria:

- [ ] `getPaperStats$` wrapper added to `PaperTradingService` (the `call`
  seam + `GET_PAPER_STATS` constant already exist).
- [ ] `options-strategy-dashboard.store` calls `getPaperStats$({ scope })`
  instead of `getStrategyEquityCurve$({ instanceId })`; `stats[0]` supplies
  both the stats card and `equityCurve` points (same doc).
- [ ] Field renames applied in the store/component: `openPositionCount` →
  `openTradeCount`, `closedPositionCount` → `closedTradeCount`,
  `lastUpdated` → `updatedAt` (or the component binds `PaperStats` fields
  directly — no legacy-shape translation anywhere).
- [ ] Scope selector state in the store: `all` / `src-STRATEGY` /
  `src-SIGNAL` / `inst-{selectedInstanceId}` — the prior "combined" view
  (was `stats-ALL`, strategy-only) maps to `src-STRATEGY`; `all` is a new,
  honest "everything" option.
- [ ] Per-instance dropdown unchanged in UX — scope string changes from
  `{instanceId}` to `inst-{instanceId}`.

### US-5: Legacy retirement + doc cleanup

**As a** maintainer, **I want** every legacy stats writer, reader, adapter,
and stale doc gone, **so that** one pipeline owns stats end to end.

Acceptance criteria:

- [ ] Deleted: `engine/passes/stats-pass.ts` (`runStatsPass`,
  `createDefaultStatsPassDeps`) and its orchestrator wiring
  (`options-strategy-pass-orchestrators.ts` — per-instance `statsPass`
  injection + call site).
- [ ] Deleted: `getStrategyEquityCurve` callable + `handleGetStrategyEquityCurve`
  + `functions/src/index.ts` export + `GetStrategyEquityCurveRequest` /
  `StrategyEquityCurveResponse` types + `getStrategyEquityCurve$` service
  wrapper + `GET_STRATEGY_EQUITY_CURVE` constant.
- [ ] Deleted: `defaultReadStatsDoc`, `paperStatsToLegacy`, and any
  stats-repository exports left orphaned (`getStats`/`getEquityCurve` dep
  seams if no callers remain). `legacyToPaperStats` **stays** — it is the
  write-side adapter from `computeStatsFromPositions` output to `PaperStats`.
- [ ] One-time cleanup script (under `functions/scripts/`) deletes stale
  `stats-ALL` and every `stats-{id}` doc whose scope matches no canonical
  builder (`inst-`, `var-`, `cohort-`, `sig-`, `sym-`, `sigtype-`, `dir-`,
  `sector-`, `ind-`, `captier-`, `sigstatus-`, `src-`, or literal `all`).
- [ ] After cleanup, `getPaperStats` with no scope returns only canonical
  docs — no ghost scopes on the paper dashboard.
- [ ] `grep` for `runStatsPass`, `incrementStatsOnOpen`,
  `defaultReadStatsDoc`, `getStrategyEquityCurve`, `'ALL'` scope literals —
  zero production references.

## Technical context

- `buildStatsId(scope)` = `stats-${scope}` for ALL scopes — legacy docs are
  the same builder fed unprefixed scope strings (`'ALL'`, `instanceId`).
  Migration is scope-string + writers, nothing structural.
- `SCOPE_RE = /^[a-zA-Z0-9-]{1,128}$/` accepts `src-STRATEGY` unmodified.
- Lifecycle choke points (all in `functions/src/paper-trading/ledger.ts`):
  `applyEntryFill` (→ OPEN), `applyPendingFill` (PENDING → OPEN),
  `applyExitFill` (→ CLOSED, accepts OPEN|ASSIGNED sources),
  `createPendingTrade`, `cancelPendingTrade` (no stats impact). Engine
  settlement `settlePosition` (position-repository.ts ~line 274) writes
  EXPIRED/ASSIGNED directly — the only lifecycle write outside the ledger.
- `applyEntryFill`/`applyExitFill` already run inside Firestore transactions
  (account cash/equity/ openTradeCount update atomically with the trade) —
  the stats-doc increments join the same transaction.
- Canonical stats doc shape (`PaperStats`): `scope`, `totalPremiumCollected`,
  `totalRealizedPnl`, `totalUnrealizedPnl`, `openTradeCount`,
  `closedTradeCount`, `assignedCount`, `expiredWorthlessCount`,
  `maxDrawdown`, `equityCurve[]`, `createdAt`, `updatedAt` — everything the
  dashboard needs is already there; no data-shape migration.
- Deploy ordering (prototype-tolerant): single deploy is acceptable — the
  reader migration and writer deletion land together, and the cleanup
  script runs any time after deploy. The only ordering constraint is
  cleanup-after-deploy: deleting `stats-ALL` before the dashboard migrates
  would blank the combined view.

## Out of scope

- Mark-pass and settlement-pass consolidation, `Position`/`PositionLeg`
  adapter retirement, entry-path unification — deferred (recorded in #987).
- Live trading (`liv_` tickets, Robinhood) — untouched.
- Long-tail scope increments (`sym-*`, `sig-*`, `cohort-*`, `var-*`,
  `sigtype-*`, `dir-*`, stamp slices) — nightly-only, deliberately.
- Intraday equity-curve points — daily granularity by design.
- `computeStatsFromPositions` emitting `PaperStats` directly (retiring
  `legacyToPaperStats` on the write side) — optional later cleanup.

## System context

| Area | Files |
|---|---|
| Scope builders | `shared/paper-trading-ids.ts` (+ spec) |
| Canonical nightly writer | `functions/src/paper-trading/passes/paper-stats-pass.ts` |
| Stats repository / increments | `functions/src/paper-trading/engine/stats-repository.ts` |
| Lifecycle seam | `functions/src/paper-trading/ledger.ts` |
| Engine settlement (direct write) | `functions/src/paper-trading/engine/position-repository.ts` |
| Legacy pass + wiring | `functions/src/paper-trading/engine/passes/stats-pass.ts`, `options-strategy-pass-orchestrators.ts` |
| Legacy increment callsite | `functions/src/paper-trading/engine/passes/open-pass.ts` |
| Legacy read path | `functions/src/paper-trading/engine/options-strategy-callables.ts`, `functions/src/index.ts` |
| Canonical read path | `functions/src/paper-trading/read-callables.ts`, `repository.ts` |
| Frontend | `src/app/features/savant-trader/stores/options-strategy-dashboard.store.ts`, `services/paper-trading.service.ts`, `services/options-strategy.service.ts`, `src/app/core/common/constants.ts` |
| Recompute semantics | `functions/src/paper-trading/engine/stats-utils.ts` |

## Open questions (impl-time)

- ASSIGNED transition: does `computeStatsFromPositions` count an assigned
  (share-holding) position as open? The increment mirrors whatever it does.
- Whether `incrementStatsOnTransition` lives in `stats-repository.ts` or a
  sibling `stats-increments.ts` (ledger already imports a stats concern? —
  check import direction; ledger → engine is existing, engine → ledger is not).
- Cleanup script shape: script under `functions/scripts/` (matches existing
  verify/probe scripts) vs console delete — decide at impl.
- Exact premium field for the open increment: entry fill `signedCashDelta`
  vs the ledger's already-computed premium — use whichever the ledger has
  in hand inside the transaction.
