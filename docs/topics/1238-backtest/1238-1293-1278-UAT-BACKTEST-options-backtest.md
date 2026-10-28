**Topic:** Options Backtest  
**Topic Slug:** options-backtest  
**Thread:** Selection Replay  
**Thread Slug:** selection-replay  
**Issue:** #1242  
**Thread Parent:** #1240  
**Topic Parent:** #1238  
**Task:** #1278  
**QA Issue:** #1293  
**Domain:** BACKTEST  
**Type:** UAT  
**Status:** Complete  
**Created:** 2026-10-26  
**Last Updated:** 2026-10-26  

# UAT — Task #1278 (SA pick-doc contract spike)

Spike task — the deliverable is a *confirmed and reconciled contract*, not a
user-facing surface. Scenarios verify the reconciled wire types, the recorded
findings, and the downstream-facing doc updates.

## Scenarios

| # | Scenario | Evidence | Result |
|---|---|---|---|
| 1 | Reconciled wire types compile + pass spec: `PickDocDayEntry` union (pick \| miss), `PickDocMiss` (`no_chain`/`no_match`), `isPickDocPick` narrowing identical to SA `isPickEntry` | `jest shared/options-replay-contracts.spec.ts` — 16/16 | PASS |
| 2 | Registry + collections unaffected by the reconcile | `jest` on `options-replay-templates.spec.ts` + `st-collections.spec.ts` — 32/32 (48 total with scenario 1) | PASS |
| 3 | `PickDocument` wire parity with SA `CellYearDoc` — fields match shipped SA types (`symbol`, `type`, signed `targetDelta`, `expiry`, `gridVersion`, `firstDate`/`lastDate`, `pickCount`/`missCount`, `days` map, `updatedAt`) | spec fixture asserts shape; cross-checked vs `av-proxy-api/shared/options/options-delta-picks.types.ts` | PASS |
| 4 | #1275 verify script survives the union change — real alias + narrowing at runtime | `tsx` script — 19 OK, `ALL CHECKS PASSED` | PASS |
| 5 | Findings recorded: issue comment on #1278 carries confirmed contract, year-shard request shape, open endpoint name (SA#225), auth confirmation | Issue comment posted 2026-10-26; ACs marked with caveat | PASS |
| 6 | IMPL-BE §3 seam section updated — confirmed contract, year-shard consequence, miss entries, grid/deltaPct derivation, codec pointer | Lines 51/62/64/65/78 verified | PASS |
| 7 | Upstream docs consistent: ADR-010 amendment appended (decision text untouched); PRD-1241 fetch granularity + miss-entry verify bullets corrected; TEST-BE mapper bullets updated; IMPL-SHARED wire section + `Last Updated` fields synced | Review pass-3 edits verified in-tree | PASS |
| 8 | Typecheck clean on task files | `tsc --noEmit` — only the 2 known unrelated errors (`bulk-swing-sweep.ts`, `indicator-config-dialog.component.ts`) | PASS |

## Traceability (issue ACs)

| AC | Scenario(s) |
|---|---|
| Endpoint name + request/response contract confirmed and recorded | 5, 6 — contract confirmed; **name recorded as open** pending av-proxy-api#225 (honest partial, flagged on the AC) |
| `PickDocument` wire type matches the confirmed shape | 1, 3, 4 |
| Auth path confirmed = existing partner-proxy pattern | 5, 6 |

## Refinement

N/A — spike task; no user-facing surface. Downstream impact notes (per-year
fetch merge, miss-entry mapping) are recorded in IMPL-BE for #1279/#1280.

## Verdict

**PASS** — all 8 scenarios green; contract reconciled to SA's authoritative
shipped types; open items (endpoint name, materialization) correctly recorded
as external dependencies rather than assumed.
