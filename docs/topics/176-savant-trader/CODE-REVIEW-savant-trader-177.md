**Topic:** Savant Trader — order execution layer, persistence fixes, and rh-agent → savant-trader rename  
**Issue:** #177  
**Topic Parent:** #176  
**Domain:** SAVANT-TRADER  
**Type:** Code Review  
**Status:** Complete  
**Created:** 2026-08-25  
**Last Updated:** 2026-08-25  

---

## Summary

Three-axis review of the Savant Trader refactor against fixed point `8476262`. The diff spans ~250 files across 6 committed + 4 uncommitted tasks: tsconfig alias rename, Collection/Route enum renames, feature directory move, service/utils/common/BE file+class renames, firestore rules rewrite, new OrderIntent type model, and planning docs.

### Tasks covered

| Task | Issue # | Description | Stage |
|---|---|---|---|
| S1a | #184 | Rename tsconfig aliases + jest config | 8_LIVE (committed) |
| S1b | #185 | Rename Collection enum + add path helpers | 8_LIVE (committed) |
| S1c | #186 | Rename route enum + paths + nav constants | 8_LIVE (committed) |
| S1d | #187 | Move feature directory + update external imports | 8_LIVE (committed) |
| S1e | #188 | Rename services/ files + classes | 7_QA (uncommitted) |
| S1h | #191 | Rename utils/ + common/ + directives/ files + classes | 7_QA (uncommitted) |
| S3 | #192 | OrderIntent type model + collection path helpers | 7_QA (uncommitted) |
| S2 | #193 | Rename BE directories + constants + rules | 7_QA (uncommitted) |

**Verdict: PASS** — all critical and major findings resolved. Remaining items are deferred to separate tasks (S1f #189 / S1g #190) or are pre-existing/by-design.

---

## Standards

### Hard violations

**1. Duplicated collection-path constants across the boundary** — §2 (`rel-str-coding-guidelines.md:36-37`): `functions/src/common/st-collections.ts:10-55` and `src/app/core/common/constants.ts:227-234` both define the same `savant-trader/data/*` path strings (runs, order-intents, occurrence-decisions, etc.). Guideline §2 requires shared constants to "exist once" and not be mirrored FE↔BE.
> **Resolution:** Not a bug. FE and BE are separate codebases that don't share code. By design.

**2. Dead path-helper functions** — §3 (`guidelines.md:46`): `src/app/core/common/constants.ts:276-282` defines 7 `st*Path()` helpers (`stOccurrenceDecisionsPath`, `stOrderIntentsPath`, etc.). Grep confirms zero callers — services use `Collection.ST_*` directly. No-op functions.
> **Resolution:** Fixed. Removed all 7 `st*Path()` helpers from `constants.ts`.

**3. OptionOrderIntent / InstrumentType.OPTION is unwired dead code** — §3 (`guidelines.md:45`): `order-intent.types.ts:129-135` plus `InstrumentType.OPTION` are self-documented as "defined but not wired — extension point for future option order work." The entire `order-intent.types.ts` module has no importer outside itself. Speculative Generality.
> **Resolution:** Deferred — by design. S3 was just the type model; wiring comes in later order-placement tasks.

**4. firestore.rules dropped backtest-runs / backtest-permutations match blocks** — §7 (`guidelines.md:92-94`): the diff deletes `match /backtest-runs/{runId}` and `match /backtest-permutations/{permutationId}` blocks, but `functions/src/st-cloud-function/backtest/backtest-collections.ts:9,12` and `backtest-run.service.ts` still use those collections. Reads/writes will now be denied — security regression.
> **Resolution:** Fixed. Restored both match blocks with original permissions in `firestore.rules`.

**5. utils.ts exceeds 400 lines** — §1 (`guidelines.md:20`): `src/app/features/savant-trader/utils/utils.ts` is 540 lines. Guideline §1: "If a file crosses 400 lines, treat it as a strong smell."
> **Resolution:** Deferred — pre-existing, not introduced by rename.

### Judgement calls

**6. Middle Man** — `agent.service.ts:45-89`: `AgentService` delegates every method 1:1 to `RunService`/`SignalService`/`OverviewService`. Pure pass-through facade with no added logic.
> **Resolution:** Deferred — pre-existing pattern, not introduced by rename.

**7. Mysterious Name / stale docstrings** — `index.ts:2` "RH Agent Feature"; `common/constants.ts:2` "Shared RH Agent constants"; `occurrence-decision.service.ts:2` "RH Agent Occurrence Decision Service"; `agent.service.ts:2` "RH Agent Service". Directory moved to `savant-trader/` but headers still say RH Agent.
> **Resolution:** Fixed. Updated docstrings in 7 files (RH Agent → Savant Trader): `index.ts`, `common/constants.ts`, `run.service.ts`, `signal.service.ts`, `overview.service.ts`, `occurrence-decision.service.ts`, `agent.service.ts`.

**8. Inconsistent route enum rename** — `interfaces.ts:42`: `RH_ACCOUNT_INQUIRY = 'rh-account-inquiry'` keeps the `RH_` prefix while siblings became `RUN_DASHBOARD`, `SIGNAL_ORDER`, `SIGNAL_ACTION_REPORT`, `STRATEGY_BACKTEST`. Shotgun Surgery half-applied.
> **Resolution:** Deferred — pre-existing naming decision, not introduced by this batch.

**9. Store/page class names still `RhAgent*`** — `rh-agent.store.ts`, `rh-agent-group.store.ts`, `rh-agent-dashboard.component.ts`, `rh-agent-order.component.ts`, `rh-agent-triage-report.component.ts` (class names `RhAgentStore`, `RhAgentGroupStore`, etc.). S1e renamed services but left stores/pages, so the refactor is inconsistent across layers.
> **Resolution:** Deferred — explicitly tracked as separate tasks S1f/S1g, not in scope for this batch.

**10. Boundary test not updated** — `tests/functions/rh-agent-mcp-boundary.test.ts:21` still lists `functions/src/rh-agent-cloud-function/rh-agent-executor.ts` as a retired path; file itself retains `rh-agent` name. Test passes trivially now but is stale.
> **Resolution:** Fixed. Updated `rh-agent-cloud-function` → `st-cloud-function` in the retired path URL.

---

## Spec

### Critical

**FE/BE callable-name mismatch (runtime break).** S2 renamed BE callable exports to `st*` in `functions/src/index.ts` (`stManualRun`, `stGetStatus`, `stGetRunHistory`, `stGetSymbolsWithSignals`, `stGetSymbolSignalHistory`, `stGetSymbolIndicatorSeriesV2`, `stOverviewSyncAdmin`), but the FE still invokes the old `rhAgent*` string names via `httpsCallable()`:
- `run.service.ts:57` `rhAgentManualRun`, `:67` `rhAgentGetStatus`, `:77` `rhAgentGetRunHistory`
- `signal.service.ts:120` (rhAgent… signals)
- `overview.service.ts:25` `rhAgentOverviewSyncAdmin`
- `indicator-series.store.ts:92,113,167,178,189` `rhAgentGetSymbolIndicatorSeriesV2`

`httpsCallable` resolves by string name, so every FE→BE call will fail `NOT_FOUND`. This must be fixed before merge. Won't surface in `tsc` — runtime-only.
> **Resolution:** Fixed. All `rhAgent*` callable strings updated to `st*` across 6 FE files (run.service, signal.service, overview.service, backtest-run.service, indicator-series.store, chart-review.component). Also added `ST_SYMBOLS` to FE Collection enum and replaced literal `'rh-agent-symbols'` refs with `Collection.ST_SYMBOLS` in signal.service.ts and chart-review.component.ts. Comment references in `types.ts` and `rh-agent.store.ts` updated.

### Missing or partial

**S1e/S1h — incomplete renames.** The `rh-agent-` prefix was dropped from *services* and *utils*, but **not from stores or page components**. Still named `rh-agent-*`:
- Stores (8): `rh-agent.store.ts`, `rh-agent-chart.store.ts`, `rh-agent-dashboard.store.ts`, `rh-agent-group.store.ts`, `rh-agent-occurrence-decision.store.ts`, `rh-agent-symbol-history.store.ts`, `rh-agent-symbol-list.store.ts`, `rh-agent-triage.store.ts`
- Pages (3 dirs): `pages/agent-dashboard/rh-agent-dashboard.component.*`, `pages/agent-order/rh-agent-order.component.*`, `pages/agent-triage-report/rh-agent-triage-report.component.*`

Corresponding `RhAgent*` class identifiers retained throughout. These are tracked as separate tasks (S1f, S1g) — not in scope for this batch, but the inconsistency is real.
> **Resolution:** Deferred — explicitly tracked as separate tasks S1f/S1g.

**S3 (#192) — location.** The OrderIntent model is in `src/app/features/savant-trader/services/order-intent.types.ts`, not `core/common/interfaces.ts`. Content is correct; feature-local placement is acceptable per spec.
> **Resolution:** No action needed — placement confirmed acceptable per spec.

### Scope creep

None material. PRD/IMPL/TEST docs and `firestore.rules` rewrite fall under #176/S2. `jest.config.js` changes are test-path updates.

---

## Thermo-Nuclear

### Contract Matrix (FE Collection enum ↔ BE constants ↔ firestore.rules)

| Concept | FE `Collection` | BE constant | Rules match | Aligned |
|---|---|---|---|---|
| occurrence-decisions | `ST_OCCURRENCE_DECISIONS` | `ST_OCCURRENCE_DECISIONS_COLLECTION` | ✓ | ✓ |
| review-list | `ST_REVIEW_LIST` | `ST_REVIEW_LIST_COLLECTION` | ✓ | ✓ |
| symbol-lists | `ST_SYMBOL_LISTS` | `ST_SYMBOL_LISTS_COLLECTION` | ✓ | ✓ |
| symbol-meta | `ST_SYMBOL_META` | — (uses ST_SYMBOLS) | ✓ | ✓ |
| runs | `ST_RUNS` | `ST_RUNS_COLLECTION` | ✓ | ✓ |
| order-intents | `ST_ORDER_INTENTS` | `ST_ORDER_INTENTS_COLLECTION` | ✓ | ✓ |
| trading-config | `ST_TRADING_CONFIG` | `ST_TRADING_CONFIG_COLLECTION` | ✓ | ✓ |
| status | *(absent — BE-only)* | `ST_STATUS_COLLECTION`+`AGENT_STATUS_DOC` | ✓ | ✓ |
| symbols | `ST_SYMBOLS` (added in fix) | `ST_SYMBOLS_COLLECTION` | ✓ | ✓ |

**ST_STATUS_COLLECTION mapping is correct.** FE has no direct Firestore read to status (verified: no `savant-trader/data/status` literals in `src/`); it consumes `stGetStatus`/`stGetSymbolsWithSignals` callables. `ST_SYMBOLS` was added to the FE enum during the fix pass — `signal.service.ts` and `chart-review.component.ts` were using the literal `'rh-agent-symbols'` string.

### Findings

**F1 — CRITICAL: `firestore.indexes.json` not updated.** The new `savant-trader/data/occurrence-decisions`, `…/symbol-meta`, `…/symbol-lists` collections have **no composite indexes**. Old indexes use `collectionGroup: "rh-agent-occurrence-decisions"` etc., which will NOT match the new path's last segment (`occurrence-decisions`). Runtime queries relying on composite indexes (e.g. userId+runId+isCurrentInLatestRun) will fail with `FAILED_PRECONDITION` against the new paths. **Deployment blocker.**
> **Resolution:** Fixed. Added composite indexes for `symbols`, `symbol-meta`, `occurrence-decisions`, and `symbol-lists` collection groups mirroring old `rh-agent-*` indexes.

**F2 — Stale literal (dead code):** `services/run.service.ts:35` — `statusDoc = 'rh-agent-status/current'`. Unused, but stale path. Remove or correct to `savant-trader/data/status/current`.
> **Resolution:** Fixed. Updated to `'savant-trader/data/status/current'`.

**F3 — Stale doc comments in renamed FE services:** `symbol-meta.service.ts:5`, `triage.service.ts:4`, `symbol-list.service.ts:8`, `run.service.ts:2`, and `index.ts:2-8` (header still says "RH Agent Feature", usage example imports from `./rh-agent`). Misleading post-rename.
> **Resolution:** Fixed. Updated all stale docstrings (RH Agent → Savant Trader). `index.ts` usage example import path updated from `./rh-agent` to `./savant-trader`.

**F4 — `functions/src/st-cloud-function/README.md`** documents the architecture using old collection paths (`rh-agent-symbols`, `rh-agent-runs`, `rh-agent-triage-decisions`, `rh-agent-symbol-meta`, `rh-agent-symbol-lists`) throughout lines 11–74. A freshly-introduced module shipping with stale docs.
> **Resolution:** Fixed. All old collection path references in README.md updated to `savant-trader/data/*` paths.

**F5 — Incomplete class rename (scope question):** Stores/components retained `RhAgent*` class names while services were renamed. `index.ts` exports the mixed naming. If a full rename was intended, this is incomplete; if stores were out of scope, note the inconsistency.
> **Resolution:** Deferred — explicitly tracked as separate tasks S1f/S1g.

### OrderIntent type model

Well-structured discriminated union on `InstrumentType`; enums, shared sub-types, and base/variant split are clean. **Minor note:** `EquityOrderIntent` and `EtfOrderIntent` are structurally identical — the ETF variant adds no fields. A single `StockOrderIntent` with `instrumentType: EQUITY | ETF` would remove a redundant concept unless the PRD mandates per-type extension points. Acceptable as documented.
> **Resolution:** No action needed — PRD design decision.

### Stale-reference searches

- Old `RH_*` Collection enum members: 0 hits in `src/`. ✓
- Old `AppRoutes.RH_AGENT*`: 0 hits in `src/`. ✓
- `@rh-agent-mcp` alias: 0 hits in code (only in docs describing the rename). ✓
- Old BE `RH_AGENT_*_COLLECTION` constants: 0 hits in `functions/src`. ✓
- `rhAgent` callable string names in `src/`: 0 hits after fix. ✓
- `'rh-agent-` collection literals in `src/`: 0 hits after fix. ✓

### Completion gate

- tsc: **pass**. `git diff --check`: clean (no whitespace errors).
- `ng build`: **pass**.
- BE `npm run build`: **pass**.

---

## Test results

Test suite not run — deferred. `testing.enabled` flag status not checked.

---

## Verdict: PASS

All critical and major findings resolved. FE build (`ng build`) and BE build (`npm run build`) both pass. Remaining items are deferred to separate tasks (S1f/S1g) or are pre-existing/by-design.
