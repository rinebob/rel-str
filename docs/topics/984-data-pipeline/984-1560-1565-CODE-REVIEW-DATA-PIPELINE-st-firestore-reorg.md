**Topic:** ST Firestore Reorg  
**Topic Slug:** st-firestore-reorg  
**Thread:** Pass Family Consolidation  
**Thread Slug:** pass-family-consolidation  
**Issue:** #1560  
**Thread Parent:** #987  
**Topic Parent:** #984  
**Task:** #1565  
**Domain:** DATA-PIPELINE  
**Type:** CODE-REVIEW  
**Status:** Complete  
**Created:** 2026-11-18  
**Last Updated:** 2026-11-18  

# Code Review — #1565 BE-IMPL: retire legacy stats writers + read path

Three-axis gate review (Standards / Spec / Thermo-nuclear sub-agents) of
the legacy stats surface deletion: `stats-pass.ts` (canonical + shim),
the `getStrategyEquityCurve` callable end-to-end, the stats-repository
read side, orchestrator stats wiring — plus the new grep-pin spec
(`test:legacy-stats-1565`) and the verify-script repoints.

Pass sequence:

```text
First pass complete — 1 convergent MAJOR (stale verify script on the
retired stats surface), 1 convergent MINOR (anemic deps interface),
2 nits; all ACs otherwise met with evidence.
Second pass complete — remediations verified compile + pin green; no
new findings; deferred items documented below.
Convergence: PASS — convergent major + minors remediated in-gate, test
suite green, remaining items are pre-existing or out-of-scope debt.
```

## Standards

Clean deletion — every surviving export in `stats-repository.ts` has a
verified caller (`statsDocRef` ← stats-increments + verify scripts;
`recomputeStats`/`defaultStatsDeps` ← paper-stats-pass;
`legacyToPaperStats` ← `writeStatsAtomically`; private `readStatsDoc` ←
`defaultStatsDeps.getExistingEquityCurve`). Zero repo references to any
deleted symbol. All four production `runSettlementForAllInstances`
callers use defaults — positional-param removal is safe. The pin spec
faithfully mirrors the `legacy-roots-cleanup-1013` convention; modified
specs verified hermetic (fake shapes match the real pass-summary
types). Verify-562 repoint reads the real canonical `PaperStats` field
names (`openTradeCount`, `totalPremiumCollected`, `equityCurve[]`).

## Spec — acceptance criteria

| AC | Verdict | Evidence |
|---|---|---|
| stats-pass.ts deleted + orchestrator wiring removed | MET | both files deleted; params + call site gone; pin covers |
| `getStrategyEquityCurve` deleted (handler, onCall, index.ts, types) | MET | zero refs repo-wide; `index.ts` exports only `listStrategyPositions` |
| stats-repository read side deleted; KEEP list retained | MET | `paperStatsToLegacy`/`defaultReadStatsDoc`/seams gone; all 4 KEEP symbols have live callers |
| `paper-stats-pass.ts` header rewritten | MET | "THE stats writer (#1565)" — no migration-boundary language |
| grep-pin | MET | 13/13; pins all AC symbols + `'ALL'` literals (per-line, `stopType` exempted) |
| deleted-callable specs removed; remaining specs green | MET | 2 spec files deleted; stats-repository spec 26/26 |

Sequencing safe: `listStrategyPositions` retained; FE off the callable
since shipped #1564 (pin spec `options-strategy.service.spec.ts:70`).

## Thermo-nuclear

Deletion verified complete and honest — the healed EXPIRED fixtures
(`unrealizedPnl: 0→75`) match the real adapter contract
(`trade-adapter.ts` maps terminal realized P&L into
`position.unrealizedPnl`; corroborated by verify-562's settlement
check). The passes-test rewrite *improved* hermeticity — four global
passes that previously fell through to real Firestore defaults are now
trivial fakes. The pin spec is real, not theater: verified the
`stopType` exclusion exists for exactly one legit comment, and the core
regression cases (reintroduced `recomputeStats('ALL'…)` /
`statsDocRef('ALL')`) are caught.

## Findings (all remediated in-gate unless noted)

- **MAJOR (convergent Spec+Standards) — `functions/scripts/verify/paper-trading-engine-open-1247.ts`
  stale since #1563**: exercised the retired `stats-ALL`/`stats-{id}`
  surface (snapshot/assert/undo) — assertions would fail on next run,
  and its "restore" would *resurrect* `stats-ALL` after Phase-4
  cleanup. **Fixed in-gate**: all `statsDocRef('ALL'|INST_*)` repointed
  to `statsScopeAll()`/`statsScopeInstance(id)` — snapshot/increment/
  undo semantics preserved on canonical docs; cleanup + survivor check
  keep the canonical pair consistent. Companion `.md` + README wording
  updated.
- **MINOR (convergent) — anemic deps interface**: `OptionsStrategyCallableDeps`
  collapsed to a one-member interface + no-op `Pick` after the handler
  deletion. **Fixed in-gate**: param typed inline
  (`{ listAllPositions }`), interface deleted — zero external importers.
- **NIT — pin `'ALL'` scan radius undocumented**: asymmetry (symbols
  scan `functions/src`, `'ALL'` scans `functions/src/paper-trading`)
  is a deliberate false-positive trade-off; now documented in-spec.
- **NIT — `docs/AS-BUILT-options-strategy-engine.md` stale**: five
  bullets documented retired surfaces as current. **Fixed in-gate**:
  annotated with retirement pointers. (Broader staleness — pre-#562
  file-layout description — is pre-existing doc debt, not this task.)
- **Deferred (pre-existing, not this diff)**: `runSettlementForAllInstances`'s
  8-positional-param seam (type-identical pass slots; order-fragile) —
  scope-expanding refactor, mitigated by the ordering spec.
- **Deferred (by design)**: prod `stats-ALL`/`stats-{id}` stale docs and
  `listStats` enumerating them — Phase-4 cleanup (#1566), explicitly
  deploy-ordered after this ships.

## Test results

- `npm run build` (esbuild): clean.
- `npx tsc --noEmit -p functions/tsconfig.json`: clean (covers scripts).
- `test:paper-trading`: **398/398**.
- `test:legacy-stats-1565` (pin): **13/13**.
- Touched/adjacent node:test specs: stats-repository 26/26,
  passes + eod-close + stats-utils + stats-from-positions +
  list-strategy-positions green.
- `npx jest --coverage=false`: **6078/6078**.

## Verdict

**PASS** — every acceptance criterion met with evidence; the one
convergent major and the convergent minors were remediated in-gate and
re-verified; the suite is green end-to-end.
