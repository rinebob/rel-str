**Topic:** Savant Trader — order execution layer, persistence fixes, and rh-agent → savant-trader rename  
**Issue:** #180  
**Topic Parent:** #176  
**Domain:** SAVANT-TRADER  
**Type:** Implementation Plan  
**Area:** BE  
**Status:** Draft  
**Created:** 2026-08-24  
**Last Updated:** 2026-08-24  

---

## Scope

The BE area covers renaming the cloud function directory, updating BE collection constants, and updating BE imports. No new BE endpoints are needed — order execution goes through the existing `/api/rh/tools/{name}` MCP API. Depends on SHARED completing first (tsconfig aliases).

## Modules

### 1. Cloud function directory rename

Rename `functions/src/rh-agent-cloud-function/` → `functions/src/st-cloud-function/`.

Update all import paths across the functions codebase that reference `rh-agent-cloud-function/`. This is mechanical — TypeScript will catch all missed imports at build time.

**What's in this directory:**
- Signal generation worker and orchestrator
- Backtest simulator and worker
- Strategy registry and implementations (leap-drop, st-trend-rider)
- Dashboard callables
- Data loader
- Run progress tracking

**What stays unchanged:**
- `functions/src/rh-agent-mcp/` — stays as-is. This is the Robinhood MCP server, accurately named.
- `shared/robinhood-mcp-contracts.ts` and `shared/robinhood-mcp-utils.ts` — stay as-is, accurately named.

### 2. BE common files rename

Rename the `rh-agent-*.ts` files in `functions/src/common/`:
- `rh-agent-collections.ts` → `st-collections.ts`
- `rh-agent-overview-helper.ts` → `st-overview-helper.ts`
- `rh-agent-orchestration.ts` → `st-orchestration.ts`
- `rh-agent-job-enqueueing.ts` → `st-job-enqueueing.ts`
- `rh-agent-shared-types.ts` → `st-shared-types.ts`
- `rh-agent-run-creation.ts` → `st-run-creation.ts`

Update all import paths referencing the old filenames.

### 3. BE collection constants

Update the collection constant values in `st-collections.ts` (renamed from `rh-agent-collections.ts`):

| Old constant | Old value | New constant | New value |
|---|---|---|---|
| `RH_AGENT_RUNS_COLLECTION` | `rh-agent-runs` | `ST_RUNS_COLLECTION` | `savant-trader/data/runs` |
| `RH_AGENT_STATUS_COLLECTION` | `rh-agent-status` | `ST_STATUS_COLLECTION` | `savant-trader/data/status` |
| `RH_AGENT_SYMBOLS_COLLECTION` | `rh-agent-symbols` | `ST_SYMBOLS_COLLECTION` | `savant-trader/data/symbols` |
| `RH_AGENT_SYMBOL_LISTS_COLLECTION` | `rh-agent-symbol-lists` | `ST_SYMBOL_LISTS_COLLECTION` | `savant-trader/data/symbol-lists` |

**Note:** `rh-agent-symbols` and `rh-agent-status` are BE-only collections not in the FE `Collection` enum. They also move under `savant-trader/data/`. The `rh-agent-symbols` collection has subcollections (`jobs`, `run-ids`, `signal-history`) — these subcollection names stay unchanged, only the parent collection path changes.

**Subcollection paths:** The BE uses subcollections under `rh-agent-symbols/{SYMBOL}/run-ids`, `rh-agent-symbols/{SYMBOL}/signal-history`, and `rh-agent-runs/{RUN_ID}/jobs`. After the rename, these become `savant-trader/data/symbols/{SYMBOL}/run-ids`, `savant-trader/data/symbols/{SYMBOL}/signal-history`, and `savant-trader/data/runs/{RUN_ID}/jobs`. The subcollection name constants (`RH_AGENT_JOBS_SUBCOLLECTION`, `RH_AGENT_RUN_IDS_SUBCOLLECTION`, `RH_AGENT_SIGNAL_HISTORY_SUBCOLLECTION`) keep their values (`jobs`, `run-ids`, `signal-history`) — only the parent path changes.

**Constant naming:** Rename `RH_AGENT_*` constants to `ST_*` (e.g., `RH_AGENT_RUNS_COLLECTION` → `ST_RUNS_COLLECTION`, `RH_AGENT_SCHEDULE_CRON` → `ST_SCHEDULE_CRON`). Update all references across the BE codebase.

### 4. BE class/interface renames

Rename `RhAgent*` classes and interfaces in the BE:
- `RhAgentSymbol` → `StSymbol`
- `RhAgentSymbolProfile` → `StSymbolProfile`
- `RhAgentSymbolSource` → `StSymbolSource`
- `RhAgentOverviewFields` → `StOverviewFields`
- Any other `RhAgent*` types in BE files

Update all references. Mechanical — TypeScript catches misses at build.

### 5. tsconfig alias updates (BE)

Update `functions/tsconfig.json` path aliases:
- `@rh-agent-mcp/contracts` → `@robinhood-mcp/contracts`
- `@rh-agent-mcp/utils` → `@robinhood-mcp/utils`

Update all BE imports using the old aliases.

### 6. Firestore security rules

Update `firestore.rules` to reference the new collection paths. Any rules referencing `rh-agent-*` collections must be updated to `savant-trader/data/*`. Add rules for the new collections:
- `savant-trader/data/order-intents/{id}` — authenticated user read/write
- `savant-trader/data/trading-config` — authenticated user read/write
- `savant-trader/data/review-list` — authenticated user read/write

## Dependencies

- Blocked by SHARED (tsconfig alias rename must complete first, since BE imports use the aliases)

## Risks

- **Subcollection path depth:** Moving `rh-agent-symbols` to `savant-trader/data/symbols` adds one path segment. Firestore subcollection queries work the same regardless of depth, but any hardcoded path construction in the BE needs updating.
- **BE build verification:** the functions project has its own build (`npm run build` in `functions/`). This must pass after the rename.
- **Cloud Function deployment names:** if any Cloud Functions are named with `rh-agent` in their deployed name (e.g., `rhAgentNightlyRun`), those are deployed function names in GCP — renaming them means updating the deployment config and potentially the Cloud Scheduler targets. This needs checking during implementation. If deployed names are hard to change, the function export names can stay while the source directory moves.
