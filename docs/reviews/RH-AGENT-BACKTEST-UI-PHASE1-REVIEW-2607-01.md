# RH Agent Backtest UI — Phase 1 Code Review

**Status:** APPROVED — Phase 1 implementation passes code review after fixes  
**Date:** 2026-07-21  
**Reviewers:** Cascade (two-axis: Standards + Spec)  
**Scope:** Phase 1 of the RH Agent strategy backtest run management UI.

---

## Change set reviewed

- `docs/implementations/RH-AGENT-BACKTEST-UI-PRD-2607-01.md`
- `docs/implementations/RH-AGENT-BACKTEST-UI-IMPL-2607-01.md`
- `functions/src/rh-agent-cloud-function/backtest/backtest-types.ts`
- `functions/src/rh-agent-cloud-function/backtest/backtest-strategies-callable.ts`
- `functions/src/index.ts`
- `src/app/core/common/interfaces.ts`
- `src/app/core/core-routes.ts`
- `src/app/features/rh-agent/index.ts`
- `src/app/features/rh-agent/backtest/index.ts`
- `src/app/features/rh-agent/backtest/common/backtest.types.ts`
- `src/app/features/rh-agent/backtest/services/backtest-firestore-converter.ts`
- `src/app/features/rh-agent/backtest/services/backtest-run.service.ts`
- `src/app/features/rh-agent/backtest/pages/backtest-dashboard/backtest-dashboard.component.ts`
- `src/app/features/rh-agent/backtest/pages/backtest-dashboard/backtest-dashboard.component.html`
- `src/app/features/rh-agent/backtest/pages/backtest-dashboard/backtest-dashboard.component.scss`

---

## Standards findings and fixes

| Finding | File | Fix applied |
|---|---|---|
| Dashboard used `async` pipe on an `Observable` for the strategy list; repo standards prefer Signals/`toSignal` for template state. | `backtest-dashboard.component.ts` | Converted `strategies$` to `strategies` signal via `toSignal()`; updated template to call `strategies()`. |
| `MatButtonModule` imported but unused in the dashboard template. | `backtest-dashboard.component.ts` | Removed unused `MatButtonModule` import. |
| `configSchema` was required in the UI `BacktestStrategyMetadata` type while the backend callable response makes it optional, risking runtime `undefined`. | `backtest.types.ts` | Made `configSchema` optional in `BacktestStrategyMetadata`. |
| `BacktestTradeLegUi` was missing `contractId`, which the backend `BacktestTradeLeg` now carries per the thermo-reviewed backend refactor. | `backtest.types.ts`, `backtest-firestore-converter.ts` | Added optional `contractId` to the UI type and mapped it in the converter. |
| Backend callable duplicated the `ConfigSchemaField` shape inline. | `backtest-strategies-callable.ts` | Imported `ConfigSchemaField` from `base-strategy.ts` and reused it. |
| Backend `BacktestRun` type did not include `archived`, `qualityDesignation`, or `cancelled`, but the UI types assumed them. | `backtest-types.ts` | Added `archived?: boolean`, `qualityDesignation?: string`, and `cancelled` to the status union. |

### Standards judgement calls (non-blocking, monitor in later phases)

- `backtest-firestore-converter.ts` uses `as` casts for Firestore `DocumentData` fields. This is acceptable for Phase 1 but should be replaced with narrow type guards as the feature matures.
- `BacktestRunService.watchPermutations` orders by `completedAt desc`; pending/running permutations may not have that field. Revisit ordering when the permutation view is wired.
- `BacktestRunService.watchRuns` combines `where('archived', '!=', true)` with `orderBy('createdAt', 'desc')`; Firestore may require a composite index. The implementation plan already flags this risk.

---

## Spec findings

- **Phase 1 deliverables present.** The PRD and implementation plan require types, a strategy-discovery backend callable, a `BacktestRunService`, a lazy-loaded route, and a dashboard shell. All are present.
- **Strategy list wired correctly.** `BacktestDashboardComponent` renders available strategies from `rhAgentBacktestStrategies`, satisfying the PRD dependency for the future strategy/config form.
- **Route and barrel correct.** `AppRoutes.RH_AGENT_BACKTEST` is added to `interfaces.ts`, the route is registered in `core-routes.ts`, and the `backtest` sub-feature is re-exported through `rh-agent/index.ts`.
- **Service surface is correct for Phase 1.** `BacktestRunService` exposes `listStrategies`, `startRun`, `watchRuns`, `watchRun`, and `watchPermutations`. `archiveRun` and `setQualityDesignation` are not yet implemented; they are scheduled for Phase 5 per the implementation plan.
- **PT date conversion deferred.** The converter returns ISO strings. Phase 1 does not display dates, so PT formatting is not yet applied; it must be added in presentation components in later phases.
- **Trade/report shape aligned.** `BacktestTradeUi` and `BacktestTradeLegUi` match the thermo-reviewed backend `BacktestTrade`/`BacktestTradeLeg` shapes: first-leg summary fields, `legs` array, `isUnderlying`, per-leg PnL, and `contractId`.

---

## Verification

- `npm --prefix functions run typecheck` — pass.
- `npm --prefix functions run build` — pass.
- `npm run build -- --configuration development --no-progress` — pass.

---

## Recommended next step

Merge/deploy this Phase 1 commit, then proceed to Phase 2 (run list, filters, and stores) per `docs/implementations/RH-AGENT-BACKTEST-UI-IMPL-2607-01.md`.
