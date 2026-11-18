**Topic:** ST Firestore Reorg  
**Topic Slug:** st-firestore-reorg  
**Thread:** Pass Family Consolidation  
**Thread Slug:** pass-family-consolidation  
**Issue:** #1561  
**Thread Parent:** #987  
**Topic Parent:** #984  
**Task:** #1564  
**Domain:** DATA-PIPELINE  
**Type:** CODE-REVIEW  
**Status:** Complete  
**Created:** 2026-11-18  
**Last Updated:** 2026-11-18  

# Code Review — #1564 FE-IMPL: strategy dashboard on getPaperStats + population selector

Three-axis gate review (Standards / Spec / Thermo-nuclear sub-agents) of
the FE stats migration: `PaperTradingService.getPaperStats$`, the
dashboard store's `selectedPopulation` + `statsScope` derivation,
the header Population select, and the retirement of
`getStrategyEquityCurve$` + `GET_STRATEGY_EQUITY_CURVE` + the legacy
shape types — no shim, per task directive.

## Standards

All contract-baseline checks verified:

- `CallableName.GET_PAPER_STATS = 'getPaperStats'` matches the deployed
  export (`functions/src/index.ts:172`, `read-callables.ts:154`).
- `GetPaperStatsRequest`/`GetPaperStatsResponse` match
  `shared/paper-trading-contracts.ts`; every consumed `PaperStats`
  field (`openTradeCount`, `closedTradeCount`, `maxDrawdown`,
  `equityCurve`) exists on the contract.
- All four derived scopes satisfy the BE `SCOPE_RE` validator and are
  now built by the canonical `@paper-trading/ids` builders
  (`statsScopeAll`/`statsScopeSource`/`statsScopeInstance`) — fixed in
  gate, see Findings.
- `getPaperStats$` follows the service's `call<Req,Res>` convention
  exactly; service→callable contract pinned by spec.
- Test conventions followed (`jest.fn()`, `of()`/`throwError`,
  `lastValueFrom`, typed `PaperStats` fixtures).

## Spec

All seven acceptance criteria met:

1. `getPaperStats$` wrapper via `call` seam + `GET_PAPER_STATS` — ✅
2. `selectedPopulation` default `'STRATEGY'` + derived scope — ✅
3. Stats card + curve from `response.stats[0]`, no shape adapter;
   renames applied — ✅ (`lastUpdated`→`updatedAt` is vacuous — no
   template binding exists for it)
4. Population `dse-select`; instance select disabled + retained under
   non-STRATEGY — ✅
5. `getStrategyEquityCurve$` + constant + legacy types deleted — ✅
6. Specs updated; `stats: []` → empty state without error — ✅
7. Position tables unchanged — ✅ (`listStrategyPositions$` untouched)

Notes: `openCount`/`closedCount` intentionally moved from table-row
lengths to stats-doc counters (criterion 3's renames imply the card is
stats-driven under every population); retained `instanceId` still
filters the strategy-only position tables under non-STRATEGY —
defensible, docstring clarified in gate. BE `getStrategyEquityCurve`
export removal is deferred to a BE cleanup task, not this one.

## Thermo-nuclear

File sizes healthy (store ~230 lines). `stats?.equityCurve ?? []`
correctly tolerates increment-minted docs that lack `equityCurve`
until the first nightly recompute. No casts beyond the removal-guard
spec pin (since removed — `'getStrategyEquityCurve$' in service`).

## Findings — all resolved in gate

| Sev | Finding | Resolution |
|-----|---------|-----------|
| MAJOR | Scope literals hand-coded in `statsScope` while canonical `@paper-trading/ids` builders exist — written for this seam | Store now delegates to `statsScopeAll`/`statsScopeSource`/`statsScopeInstance` |
| minor | `getPaperStats$` docstring claimed absent scope → `stats:[]` (actually omitted → enumerate all) | Docstring corrected |
| minor | `loadEquityCurve`/`isLoadingEquityCurve` names stale after migration | Renamed `loadStats`/`isLoadingStats` across store + specs; error messages updated to "stats" |
| minor | `as any` cast in service spec guard | `'x' in service` check instead |
| minor | Stale-response path untested | Subject-backed spec added — superseded request can't overwrite newer state |
| minor | `selectPopulation`/`isEmpty` docstrings ambiguous | Clarified |

Not changed (deliberate): `selectPopulation` reloads positions via
`loadAll` per criterion "same reload path as instance selection" —
costs one extra callable; noted, not a defect.

## Test results

- Touched specs: 46/46 green (store, both services, component).
- Full suite: **5918/5918 green** (318 suites); `tsc --noEmit` clean;
  `git diff --check` clean.

## Verdict

**PASS** — the one major (scope-builder drift) and all minors fixed in
gate; second pass found no new findings and confirmed every first-pass
finding captured. One MAJOR + five minors were the full union of the
three axes; converged in two passes.
