**Topic:** Strategy Builder UI  
**Topic Slug:** strat-manage  
**Thread:** OpsStrat Manage Page Overhaul  
**Thread Slug:** page-overhaul  
**Issue:** #1588  
**Thread Parent:** #1510  
**Topic Parent:** #137  
**Task:** #1543  
**Domain:** STRAT-MANAGE  
**Type:** UAT  
**Status:** Complete  
**Created:** 2026-11-17  
**Last Updated:** 2026-11-17  

# UAT — #1543 BE: Manage contract-list writer

## Getting to the feature

Not applicable — backend writer with no UI surface. On each successful
manage open (noon-PT `manageOpenPassTimer`, #1539) one v1 pick row per
resolved leg appends to `st-options-contract-lists/{instanceId}`, which
makes the options analysis route
(`options/strategy/backtest/analysis/{instanceId}` →
`optionsAnalysisStart` + `optionsReplayAnalysis` worker) resolvable
for live manage positions. QA acceptance is at the
contract/verification level: doc fields, row shape, idempotent
dedupe/reconcile, and the pass seam.

## Scenarios

### S1 — Verify script passes standalone

1. Run `npx tsx scripts/verify/strat-manage-contract-list-1543.ts`
2. **Expect:** every check prints `OK   name: value`, ends
   `All checks passed`, exit 0. Covers: doc create on first open
   (`runId` = `QQQ-CDS-30-50-40-ALL`, `symbol` `QQQ`, `templateId`
   `cds`, `status` success, no `schemaVersion`), two v1 `pick` rows
   (contractIds `QQQ260306C00450000`/`QQQ260306C00455000`, `dte` 32,
   sides long/short, `underlyingClose` 512.34), synthetic
   `pickDocMeta` (leg-0 coordinate call/0.5/30d, `gridVersion` 0),
   second-open append with same-index `repeatsPrevious` (leg0 same
   contract → true, leg1 new contract → false), `NaN` for missing
   numerics, and the pass seam (append invoked with resolved
   `{leg, contract}` pairs; append failure tolerated).
   **Result: PASS — 37/37 checks.**

### S2 — Specs pass

1. Run (from `functions/`):
   `npx tsx --test ../tests/functions/options-strategy-engine/contract-list-writer.test.ts ../tests/functions/options-strategy-engine/manage-open-pass.test.ts`
2. **Expect:** all green — doc create/append, same-index
   `repeatsPrevious`, `pickDocMeta` bookkeeping, `NaN` missingness,
   empty-legs no-op, idempotent dedupe (re-append returns doc
   untouched; partial reconcile fills only missing rows), pass seam
   (invoked on success, skipped on gate, failure tolerated), and the
   `already_opened_today` reconcile (re-appends from persisted legs;
   count-mismatch guard).
   **Result: PASS — 33/33 tests.**

### S3 — Types + functions build

1. `cd functions && npx tsc --noEmit`
2. `cd functions && npm run build`
3. **Expect:** both exit clean — `ResolvedLegContract`,
   `ContractListLegInput`, `upsertDoc` transaction seam, and the
   `RhMcpToolCaller` hoist all compile.
   **Result: PASS.**

### S4 — Analysis-route gate contract

Static check — the emitted doc satisfies what
`optionsAnalysisStart` requires (`functions/src/options-analysis/start.ts`):

- `st-options-contract-lists/{instanceId}` exists with
  `status: 'success'` — covered by S1 checks (`status success
  (analysis gate)`).
- `runId`/`symbol`/`templateId` populated — the callable builds the
  task payload from these fields; S1 asserts all three.
- Worker row filter (`kind === 'pick'` + `contractId`) — S1 asserts
  `kind:'pick'` rows with OCC contractIds; `buildPickRecords` reads
  `entryDate`/`expiration`/`mark`/`delta`/`iv`/`strike` — all
  asserted populated (or `NaN` when the quote lacks them).
  **Result: PASS.**

### S5 — Post-mint hardening behavior

1. Append failure after position mint → `logger.warn`, open still
   reports success, and the NEXT same-day fire (dedup path)
   re-attempts the group from persisted `PositionLeg`s.
2. Re-append of a landed group is a no-op (upsert callback dedupes
   `(entryDate, contractId)` and returns the doc unchanged).
3. Every append call is bounded at 30 s — a wedged MCP quote call
   cannot skip `lastFiredAt`/result-write or starve later instances.
   **Result: PASS — covered by S1/S2 seams + dedupe specs.**

### S6 — Foreign-change hygiene

All #1543 edits confined to the writer module, pass seam,
`rh-mcp-shapes` extension, tests, verify harness, registry, and IMPL
doc — the tree's other in-flight changes (#1563 stats, #1523 labels)
are untouched. **Result: PASS.**

## Result

| Scenario | Result |
|---|---|
| S1 Verify script (37 checks) | PASS |
| S2 Specs (33 tests) | PASS |
| S3 tsc + functions build | PASS |
| S4 Analysis-route gate contract | PASS |
| S5 Post-mint hardening | PASS |
| S6 Foreign-change hygiene | PASS |

**Status: Complete — QA passed 2026-11-17.**
