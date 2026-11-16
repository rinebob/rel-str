**Topic:** ST Firestore Reorg  
**Topic Slug:** st-firestore-reorg  
**Thread:** Pass Family Consolidation  
**Thread Slug:** pass-family-consolidation  
**Issue:** #1554  
**Thread Parent:** #987  
**Topic Parent:** #984  
**Domain:** DATA-PIPELINE  
**Type:** IMPL  
**Area:** BE  
**Status:** Approved  
**Created:** 2026-11-15  
**Last Updated:** 2026-11-16  

# IMPL — Stats Pipeline Consolidation: BE (functions)

## Overview

Consolidate paper-trading stats onto one writer, one namespace, one read
path. SHARED scope-builder change rides this blueprint (per area-split
decision). Increments live inside the ledger *functions* but outside
their Firestore transactions — post-commit, error-swallowed — so a
stats-doc failure can never fail a fill, and `stats-all` hotspot
contention can't add retries to the fill path. The nightly
`runPaperStatsPass` recompute remains the self-healing authority.

## Phase 1 — `src-{source}` scope family

1. `shared/paper-trading-ids.ts` — add `statsScopeSource(source:
   PaperTradeSource): string` returning `src-${source.toUpperCase()}`
   (enum values are lowercase 'strategy'/'signal'/'manual' — uppercased
   like `statsScopeSymbol` → `src-SIGNAL`, `src-STRATEGY`, `src-MANUAL`).
   `import type` only — `paper-trading-contracts` imports
   `PaperTradingKind` from ids as a value, so a runtime import would
   cycle. Placed with the other stats scope builders (~line 162). Spec
   pin in `shared/paper-trading-ids.spec.ts`.
2. `functions/src/paper-trading/passes/paper-stats-pass.ts` —
   `tradeScopes` gains `scopes.push(statsScopeSource(trade.source))`
   unconditionally (every `PaperTrade` carries `source`). Update the
   file-header scope list comment.
3. Result: nightly pass writes `stats-src-SIGNAL` + `stats-src-STRATEGY`
   alongside existing scopes. `SCOPE_RE` (`^[a-zA-Z0-9-]{1,128}$`)
   accepts both unmodified.

## Phase 2 — Ledger increment seam

1. New `functions/src/paper-trading/engine/stats-increments.ts` —
   `incrementStatsOnTransition(input)` where input carries `{ source,
   strategyInstanceId?, deltas }` and deltas are field→number increments
   resolved by the caller. Implementation: one `db.runTransaction` doing
   blind `FieldValue.increment` merge-sets on each scope doc — **no
   reads**, so no read-before-write ordering constraint and a partial
   failure can't leave scope docs diverged. Also merge-sets `kind`,
   `scope`, `updatedAt` (idempotent same-value writes; `createdAt` and
   `equityCurve` are the nightly pass's to own — absent on
   increment-created docs, readers already tolerate `??`).
   - Scopes: `[statsScopeAll(), statsScopeSource(source)]` +
     `statsScopeInstance(strategyInstanceId)` when present.
   - Whole call wrapped in try/catch → `logger.warn` — NEVER throws into
     the caller's fill path.
2. `ledger.ts` wiring — fires post-commit inside the function (zero
   per-callsite wiring; ledger already imports `./engine/*`):
   - `applyEntryFill`: after commit, if the trade landed `OPEN` →
     `{ openTradeCount: +1, totalPremiumCollected: +premium }` where
     premium is the value the trade doc carries for premium collected
     (same quantity `computeStatsFromPositions` sums — verify the exact
     field at impl; `signedCashDelta` is already in hand).
   - `applyPendingFill`: same as above on PENDING → OPEN.
   - `applyExitFill`: only when the transition lands on `CLOSED`
     (terminal) — `{ openTradeCount: -1, closedTradeCount: +1,
     totalRealizedPnl: +exitPnl }` from `computeExitPnl`. A partial exit
     leaving status `OPEN` fires nothing.
3. `engine/position-repository.ts` — `settlePosition` is the one
   lifecycle write outside the ledger; fires explicitly post-commit:
   - → `EXPIRED_WORTHLESS`: `{ openTradeCount: -1, closedTradeCount: +1,
     expiredWorthlessCount: +1, totalRealizedPnl: +pnl }`
   - → `ASSIGNED_HOLDING_SHARES`: `{ assignedCount: +1 }` ONLY — the
     recompute counts assigned as open (stats-utils.ts: it increments
     `openPositionCount` AND `assignedCount`), so no open decrement.
4. Delete `incrementStatsOnOpen` (`engine/stats-repository.ts`) and its
   call in `open-pass.ts` — the ledger seam strictly replaces it and
   would double-count alongside it.

## Phase 3 — Legacy writers + read path retirement

1. Delete `engine/passes/stats-pass.ts` (`runStatsPass`,
   `createDefaultStatsPassDeps`) and its orchestrator wiring —
   `options-strategy-pass-orchestrators.ts`: the `statsPass` injectable
   param (~line 257) and the call site (~line 341).
2. Delete `getStrategyEquityCurve`:
   - `options-strategy-callables.ts` — `handleGetStrategyEquityCurve` +
     `getStrategyEquityCurve` `onCall` export + now-dead deps fields.
   - `functions/src/index.ts` export.
   - `GetStrategyEquityCurveRequest` / `StrategyEquityCurveResponse`
     types (wherever declared — engine types or contracts).
3. `engine/stats-repository.ts` cleanup — delete `defaultReadStatsDoc`
   and `paperStatsToLegacy` (read-side adapters with no remaining
   callers). `getStats`/`getEquityCurve` dep-seam exports die too if no
   callers remain (only the deleted callable used them). KEEP:
   `statsDocRef`, `recomputeStats`, `defaultStatsDeps`,
   `legacyToPaperStats` (write-side adapter `computeStatsFromPositions`
   → `PaperStats` — still the canonical write path).
4. `paper-stats-pass.ts` header — rewrite the "keeps writing LEGACY doc
   ids… migration boundary" paragraph: this pass is now THE stats
   writer.
5. FE-side constants — `GET_STRATEGY_EQUITY_CURVE` in
   `src/app/core/common/constants.ts` dies with the FE task (flagged
   cross-area; BE task doesn't touch FE files).

## Phase 4 — Stale-doc cleanup + verification

1. `functions/scripts/` cleanup script (matches existing script
   conventions): enumerate `st-paper-trading/stats/items` docs; delete
   any doc id not matching a canonical scope —
   `all`, or `{inst,var,cohort,sig,sym,sigtype,dir,sector,ind,captier,sigstatus,src}-`.
   What remains: `stats-ALL` + `stats-{unprefixed-instanceId}`. Dry-run
   default (list), `--apply` to delete; register in the verify README
   if conventions apply.
2. Grep-pin verification (part of task ACs, plus a verify script per
   repo convention): zero production references to `runStatsPass`,
   `incrementStatsOnOpen`, `defaultReadStatsDoc`,
   `getStrategyEquityCurve`, `paperStatsToLegacy`, `'ALL'` scope
   literals.
3. Deploy ordering: cleanup script runs AFTER the deploy that removes
   the legacy readers — deleting `stats-ALL` early would blank the
   dashboard's combined view.

## Risks

- **Increment drift** — bounded by design: nightly recompute is
  authoritative; worst case is a few hours of stale counts.
- **Double-counting during transition** — mitigated by deleting
  `incrementStatsOnOpen` in the same task that wires the ledger seam.
- **`stats-all` hotspot** — avoided entirely by post-commit increments
  (no fill-path contention); stats doc txns are small and independent.
- **Stats doc created increment-first** — a doc created by a blind
  merge-set lacks `equityCurve`/`createdAt`; nightly recompute fills
  them; readers tolerate missing curve (`??` paths verified in the
  store/component mapping).
