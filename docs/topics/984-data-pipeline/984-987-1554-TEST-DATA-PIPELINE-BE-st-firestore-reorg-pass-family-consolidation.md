**Topic:** ST Firestore Reorg  
**Topic Slug:** st-firestore-reorg  
**Thread:** Pass Family Consolidation  
**Thread Slug:** pass-family-consolidation  
**Issue:** #1554  
**Thread Parent:** #987  
**Topic Parent:** #984  
**Domain:** DATA-PIPELINE  
**Type:** TEST  
**Area:** BE  
**Status:** Approved  
**Created:** 2026-11-15  
**Last Updated:** 2026-11-16  

# Test Plan — Stats Pipeline Consolidation: BE

## E2E User Journeys

- Strategy position opens intraday → `stats-inst-{id}`,
  `stats-src-STRATEGY`, `stats-all` show `openTradeCount +1` and premium
  within seconds (no nightly wait).
- Signal trade fills intraday → `stats-src-SIGNAL` + `stats-all` bump —
  live signal increments for the first time.
- Position exits / settles → open count decrements and closed/realized
  fields update intraday; assigned increments `assignedCount` only.
- Nightly `runPaperStatsPass` → every scope recomputed from scratch;
  any increment drift corrected; `stats-src-*` populated.
- Post-deploy + cleanup → `listStats` returns only canonical docs; no
  `stats-ALL`/`stats-{id}` ghosts.

## Integration Tests

- `stats-increments` against the real dep seam (mock Firestore txn or
  emulator): scopes resolve `[all, src-{source}, inst-{id}?]`; blind
  `FieldValue.increment` merge-sets; one txn per event; failure →
  warn, never throws.
- `applyEntryFill`/`applyPendingFill`/`applyExitFill` with injected
  increment seam (deps pattern) — increment fires post-commit on
  transition; NO increment on partial exit (status stays OPEN), on
  `createPendingTrade`, or on `cancelPendingTrade`.
- `settlePosition` — EXPIRED → expired deltas; ASSIGNED →
  `assignedCount` only.
- `handleGetPaperStats({scope: 'src-STRATEGY'})` → returns the doc;
  `SCOPE_RE` accepts `src-*`.
- Deleted-path smoke: orchestrator runs with no `statsPass` stage;
  `open-pass` no longer calls any stats increment directly.

## Unit Tests

- `statsScopeSource` in `paper-trading-ids.spec.ts` — `src-SIGNAL`,
  `src-STRATEGY`; `buildStatsId('src-STRATEGY')` → `stats-src-STRATEGY`.
- `tradeScopes` — includes the source scope for SIGNAL and STRATEGY
  trades; every existing scope assertion still passes.
- Scope-set derivation in `stats-increments` — instance present/absent.
- Delta-mirror table — each transition maps to the same counts
  `computeStatsFromPositions` produces (OPEN→open+1; CLOSED→open−1,
  closed+1, realized+=; EXPIRED→+expiredWorthless; ASSIGNED→+assigned
  only). A spec asserting parity against the stats-utils branch
  semantics.

## Test Seams

- Highest seam: dep-injected `incrementStatsOnTransition` + dep-injected
  ledger functions — the existing `LedgerDeps`/pass-deps patterns.
- Lower seams: `tradeScopes`/`statsScopeSource` pure functions;
  delta-table pure logic if extracted.

## Existing Test Coverage

- `paper-trading-ids.spec.ts` — builder pins (extend).
- `paper-stats-pass` spec — `tradeScopes` fan-out (extend for src).
- `stats-repository` specs — `incrementStatsOnOpen` tests → deleted,
  replaced by increment-seam specs.
- `open-pass` specs — assert no direct stats writes remain.
- Callable specs for `getStrategyEquityCurve` → deleted.

## Edge Cases

- Increment fires on a stats doc that doesn't exist yet → merge-set
  creates a partial doc (no equityCurve/createdAt) — nightly recompute
  fills; readers tolerate absent curve.
- Signal trade with no `strategyInstanceId` → scopes `[all, src-SIGNAL]`.
- Exit fill on an ASSIGNED trade → CLOSED transition decrements open
  (assigned counted open), realized += exit pnl.
- Settlement on a non-OPEN trade → `settlePosition` already throws
  (not idempotent-safe) — unchanged; no increment.
- Cleanup script: dry-run lists candidates; `--apply` deletes only
  non-canonical ids; a canonical-prefixed doc is never deleted.
