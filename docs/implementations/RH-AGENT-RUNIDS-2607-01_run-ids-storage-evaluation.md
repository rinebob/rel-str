# RH-AGENT-RUNIDS-2607-01 — Run-ids Storage Model Evaluation

- **Last updated**: 2026-07-08
- **Related**: `RH-AGENT-SYMBOL-ONBOARDING-2607-01_symbol-onboarding.md`

## Context

Per-symbol `run-ids/{runId}` docs store every run's signals under `rh-agent-symbols/{symbol}/run-ids`. The grouped review page needs to know which symbols had signals for the active run, and the detail panel reads the active run's signals from the same doc. Canonical nightly EOD signals are also written to `rh-agent-symbols/{symbol}/signal-history/{barDate}`.

### Action-eligibility clarification

Per `RH-AGENT-LATEST-ACTION-WORKFLOW-2607-01.md`, only the latest completed run is actionable for screening, acceptance, order, and execution. Older `run-ids` documents and `signal-history` are historical/read-only inspection sources. This workflow rule is independent of whether old `run-ids` documents are retained temporarily, TTL-cleaned, or replaced by a `latest-signals` document.

Runs are triggered by one of four sources: `nightly`, `pdr`, `manual`, or `symbol-added`. The `symbol-added` trigger produces a per-symbol run ID with the symbol appended to avoid collisions.

Current pain points:
- Collection group query across all `run-ids` is required for the grouped review list.
- `run-ids` docs accumulate indefinitely unless something deletes them.
- Nightly runs duplicate data already present in `signal-history`.

## Query patterns

1. **Grouped review list** (`rhAgentGetSymbolsWithSignals`)
   - Collection group query on `run-ids` filtered by `runId`.
   - Returns symbol list, then fetches `rh-agent-symbols/{symbol}` docs for overview fields.
2. **Grouped review detail** (`getSymbolSignalsForRun`)
   - Direct doc read: `rh-agent-symbols/{symbol}/run-ids/{runId}`.
   - Used to show signals for the selected symbol on the active run.
3. **Canonical history** (`rhAgentGetSymbolSignalHistory`)
   - Reads `signal-history` subcollection directly.
   - Not part of the `run-ids` decision.

## Options evaluated

### Option A — Add a TTL to `run-ids`

Keep the current schema and add a Firestore TTL policy on a `ttl` field in each `run-ids` doc.

Pros:
- Minimal code change.
- Preserves existing grouped review UX (review any recent run).
- `signal-history` remains the canonical long-term store.

Cons:
- Still requires a collection group query.
- Old runs become unreadable after TTL expires, which may be confusing if a user bookmarks a run.
- Need to populate `ttl` field on every write.

Estimated TTL: **7 days** — aligned with the typical grouped review window.

### Option B — Replace `run-ids` with a single `latest-signals` doc per symbol

Store only one doc per symbol (`rh-agent-symbols/{symbol}/latest-signals/current`) containing the most recent run's signals and the run metadata. The grouped review list would query `rh-agent-symbols` directly, filtering by `lastRunId == runId` (or reading the latest-signals doc for each symbol).

Pros:
- Eliminates collection group query and the associated composite index.
- Bounded storage: one doc per symbol.
- Simpler detail view: always read the latest signals doc, no need to pass `runId` around.

Cons:
- Loses the ability to review a specific historical run from `run-ids`.
- Requires frontend changes to stop relying on `runId` for detail view.
- Migration path: backfill `latest-signals` from most recent `run-ids` doc for each symbol, or accept empty docs until the next run writes them.
- `signal-history` can still provide historical lookup by bar date, but not by run.

### Option C — Hybrid: keep `run-ids` for recent runs + single `latest-signals` doc

Maintain `run-ids` with a short TTL (e.g., 7 days) and also write a `latest-signals` doc that is updated on every run. The grouped review list can query `latest-signals` by `runId`, while the detail view can still read `run-ids/{runId}` for recent runs or fall back to `latest-signals`.

Pros:
- Best of both worlds: fast grouped review query and retained run-level detail for recent runs.
- Gradual migration: frontend can switch to `latest-signals` first, then `run-ids` can be reduced/removed later.

Cons:
- Most code changes (writer + frontend + new callable).
- Still writes two places per run.

## Decision

**Recommended: Option B — Single `latest-signals` doc per symbol.**

Rationale:
- The grouped review page is explicitly the driver of this evaluation, and the remediation notes state that only the latest signals matter for grouped review.
- Removing the collection group query simplifies the backend and removes a Firestore index dependency.
- `signal-history` already provides canonical EOD history by bar date, so losing per-run detail in `run-ids` does not lose auditability.
- Storage cost is bounded to one small doc per symbol.

## Next-step task

Create implementation task **RH-AGENT-LATEST-SIGNALS-2607-01** with the following work:

1. Add `rh-agent-symbols/{symbol}/latest-signals` subcollection (doc ID `current`).
2. Update `SignalDateWriter` to also write/merge `latest-signals/current` with the latest run's signals and metadata (`runId`, `marketDate`, `startedAt`).
3. Update `rhAgentGetSymbolsWithSignals` to query `latest-signals` collection group filtered by `runId` (or migrate to direct symbol-doc filtering once the symbol doc includes `lastRunId`).
4. Update frontend `RhAgentSymbolHistoryStore` and `RhAgentSignalService` to read `latest-signals/current` instead of `run-ids/{runId}` for the detail view.
5. Add a Firestore TTL policy on `run-ids` (or delete old `run-ids` docs in a backfill script) to clean up historical run docs after the new path is stable.
6. Deploy and verify the grouped review page still renders correctly.

## Migration path

- No backfill required for `latest-signals` before launch: the next run for each symbol will create the doc.
- Keep `run-ids` read-only for a short transition period while the frontend migrates.
- After confirming the new path, delete `run-ids` docs older than the transition date via an admin script, then remove `run-ids` writes from `SignalDateWriter`.
