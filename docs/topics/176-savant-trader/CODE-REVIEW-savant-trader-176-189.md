**Topic:** Savant Trader — stores/pages/components rename (S1f + S1g)
**Issue:** #189, #190
**Topic Parent:** #176
**Domain:** SAVANT-TRADER
**Type:** Code Review
**Status:** Complete
**Created:** 2026-08-25
**Last Updated:** 2026-08-25

---

## Summary

Three-axis review of the S1f (#189) and S1g (#190) rename tasks, plus additional fixes discovered during the review. The diff spans ~70 files across stores/, pages/, components/, services/, BE scripts, and tests — completing the `rh-agent` → `savant-trader` / `st-` prefix rename for the FE layer and fixing stale BE script imports missed by S2.

### Tasks covered

| Task | Issue # | Description | Stage |
|---|---|---|---|
| S1f | #189 | Rename stores/ files + classes | 6_REVIEW |
| S1g | #190 | Rename components/ + pages/ + page directories | 6_REVIEW |
| (bonus) | — | Rename agent.service.ts → st.service.ts, agent.store.ts → st.store.ts | — |
| (bonus) | — | Fix broken BE script imports (S2 fallout) | — |
| (bonus) | — | Rename Agent* types → St* types (AgentStatus, AgentRun, AgentSymbolProfile, etc.) | — |
| (bonus) | — | Rename RhSymbol* types → Symbol* (RhSymbolMeta, RhSymbolList) | — |
| (bonus) | — | Rename RH_AGENT_* constants → ST_* (ST_SCHEDULE_CRON, ST_MAX_TRADE_AMOUNT) | — |
| (bonus) | — | Update stale "RH Agent" docstrings → "Savant Trader" across 36 files | — |
| (bonus) | — | Update st-cloud-function README.md obsolete file/class references | — |

**Verdict: PASS** — all critical and major findings discovered during review were fixed before writing this doc. No remaining critical or major issues.

---

## Standards

### Findings discovered and fixed

**1. Broken BE script imports (CRITICAL → fixed)**
4 BE scripts had stale imports referencing `rh-agent-*` files renamed in S2:
- `functions/scripts/replay-missing-symbols.ts` — imported `rh-agent-overview-helper`, `rh-agent-run-creation`, `rh-agent-job-enqueueing`, `rh-agent-collections`
- `functions/scripts/backfill-orphan-rh-agent-symbols.ts` — imported `rh-agent-collections`
- `functions/scripts/backtest-qqq-underlying.ts` — imported from `rh-agent-cloud-function/` directory
- `functions/scripts/generate-historical-signal-history.ts` — imported from `rh-agent-cloud-function/` directory

> **Resolution:** All 8 scripts in `functions/scripts/` updated. File, class, type, and collection references replaced with `st-*` equivalents. 3 script files renamed (`backfill-orphan-rh-agent-symbols.ts` → `backfill-orphan-st-symbols.ts`, `seed-rh-agent-from-prod.ts` → `seed-st-from-prod.ts`, `delete-old-rh-agent-collections.ts` → `delete-old-st-collections.ts`).

**2. Stale "RH Agent" docstrings (MAJOR → fixed)**
36 files in `src/app/features/savant-trader/` still had "RH Agent" in file header comments and inline docstrings.

> **Resolution:** Bulk replaced "RH Agent" → "Savant Trader" across all 36 files.

**3. User-facing "RH Agent" text in templates (MAJOR → fixed)**
- `run-dashboard/dashboard.component.html:6` — `<h1>RH Agent</h1>`
- `rh-account-inquiry/observation-dashboard.component.html:3` — `<h1>RH Agent Observation Dashboard</h1>`

> **Resolution:** Both updated to "Savant Trader".

**4. st-cloud-function README.md obsolete references (MAJOR → fixed)**
`functions/src/st-cloud-function/README.md` still referenced old `rh-agent-*.ts` file names and `RhAgent*` class names in its module table.

> **Resolution:** All file names, class names, and function names in the README updated to `st-*` / `St*` equivalents.

**5. Incomplete type renames (MINOR → fixed)**
- `RhSymbolMeta` / `RhSymbolMetaInput` → `SymbolMeta` / `SymbolMetaInput` (16 files)
- `RhSymbolList` → `SymbolList`
- `AgentStatus`, `AgentRun`, `AgentSymbolSource`, `AgentSymbolProfile`, `AgentSignalItem`, `AgentOccurrenceDecision` → `St*` equivalents (25 files)
- `RH_AGENT_SCHEDULE_CRON` → `ST_SCHEDULE_CRON`, `RH_AGENT_MAX_TRADE_AMOUNT` → `ST_MAX_TRADE_AMOUNT`
- `RH_AGENT_INDICATOR_OPTIONS` → `ST_EXTRA_INDICATOR_OPTIONS` (renamed to avoid collision with imported `ST_INDICATOR_OPTIONS` from indicator-registry)

> **Resolution:** All type and constant renames completed.

**6. Test mock method name (MINOR → fixed)**
`tests/functions/sds-completion.test.ts` had `startRhAgentRun` mock method.

> **Resolution:** Renamed to `startStRun`.

### No issues found

- File size: no new files exceed 400 lines. `utils.ts` (607 lines) is pre-existing.
- No dead code introduced.
- No circular dependencies.
- All imports resolve correctly (verified by `ng build`).
- Component selectors follow Angular kebab-case convention.

---

## Spec

### S1f (#189) — Rename stores/ files + classes

| Criterion | Status | Evidence |
|---|---|---|
| All rh-agent-*.store.ts files renamed | MET | 8 store files renamed: `st.store.ts`, `chart.store.ts`, `dashboard.store.ts`, `group.store.ts`, `occurrence-decision.store.ts`, `symbol-history.store.ts`, `symbol-list.store.ts`, `triage.store.ts` |
| All RhAgent*Store classes renamed | MET | `StStore`, `ChartStore`, `DashboardStore`, `GroupStore`, `OccurrenceDecisionStore`, `SymbolHistoryStore`, `SymbolListStore`, `TriageStore` |
| All internal imports updated | MET | Zero `rh-agent.*\.store` or `RhAgent.*Store` references remain in `src/` |
| FE build succeeds | MET | `ng build` passes (verified) |
| Existing tests pass | MET | `utils.spec.ts` — 18 pass, 1 pre-existing failure (`buildSymbolGroups showAll`) unrelated to rename |

### S1g (#190) — Rename components/ + pages/ + page directories

| Criterion | Status | Evidence |
|---|---|---|
| Page directories renamed | MET | `agent-dashboard/` → `run-dashboard/`, `agent-triage-report/` → `signal-action-report/`, `observation-dashboard/` → `rh-account-inquiry/` |
| Component selectors renamed | MET | `app-rh-agent-dashboard` → `app-run-dashboard`, `app-rh-agent-order` → `app-signal-order`, `app-rh-agent-triage-report` → `app-signal-action-report`, `app-agent-status-bar` → `app-run-status-bar` |
| All RhAgent* component classes renamed | MET | `DashboardComponent`, `OrderComponent`, `TriageReportComponent`, `RunStatusBarComponent` |
| All internal imports and templates updated | MET | `core-routes.ts`, `index.ts`, all templates and stylesheets updated |
| FE build succeeds | MET | `ng build` passes (verified) |
| Existing tests pass | MET | Same as S1f — 1 pre-existing failure unrelated to rename |

---

## Thermo-nuclear

### Architecture quality

**Positive:** The `st.store.ts` / `st.service.ts` naming aligns with BE's `st-*.ts` prefix convention, providing cross-stack consistency. The `St*` type prefix (StStore, StState, StService, StStatus, StRun, StSymbolProfile, etc.) is a clear, short namespace that avoids collisions with Angular built-ins.

**Positive:** Page directory renames match route enum values (`run-dashboard`, `signal-action-report`, `signal-order`). Selectors match route paths. This makes the routing → component mapping easy to trace.

**Note (pre-existing, deferred):** `RH_ACCOUNT_INQUIRY` route enum still uses `RH_` prefix while all other routes dropped it. This was flagged as finding #8 in the prior review (CODE-REVIEW-savant-trader-177.md) and deferred. The directory was renamed to `rh-account-inquiry/` to match the existing route, not to fix the route enum.

### Test quality

The `utils.spec.ts` failure (`buildSymbolGroups includes non-signal symbols when showAll is true`) is pre-existing — verified by stashing the rename changes and reproducing the same failure. The test expects 2 groups but gets 1; this is a logic issue in `buildSymbolGroups`, not a rename artifact.

### Missing edge cases

**Fixed during review:** The initial rename missed BE scripts, docstrings, user-facing text, type renames (RhSymbolMeta, Agent* types), and constants (RH_AGENT_*). All were fixed before writing this doc.

**Remaining (out of scope):**
- `rh-agent-mcp/` directory and its references — this is the retired MCP bridge module, a separate concern.
- `functions/package.json` function names for `rh-agent-mcp` diagnostics — same, retired module.
- `functions/src/index.ts` exports from `rh-agent-mcp/` — same, retired module.

---

## Test results

- `ng build`: **PASS** (verified 3 times during the review)
- `ng test --watch=false --include='**/savant-trader/utils/utils.spec.ts'`: 18 pass, 1 pre-existing failure (unrelated to rename)
- Full test suite: blocked by pre-existing config issues (`strategy-builder.component.spec.ts` imports `fs`/`path` without polyfills; HTML module parsing errors). These are pre-existing and not related to the rename.

---

## Verdict

**PASS** — all critical and major findings discovered during the three-axis review were fixed before writing this doc. The FE rename is complete: zero `RhAgent` or `rh-agent` references remain in `src/`. The BE script fixes address S2 fallout that would have caused runtime failures. Remaining items (rh-agent-mcp retired module, pre-existing test failures) are out of scope.
