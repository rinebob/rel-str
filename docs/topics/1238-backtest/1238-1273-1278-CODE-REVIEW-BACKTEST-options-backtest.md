**Topic:** Options Backtest  
**Topic Slug:** options-backtest  
**Thread:** Selection Replay  
**Thread Slug:** selection-replay  
**Issue:** #1242  
**Thread Parent:** #1240  
**Topic Parent:** #1238  
**Task:** #1278  
**Domain:** BACKTEST  
**Type:** CODE-REVIEW  
**Status:** Complete  
**Created:** 2026-10-26  
**Last Updated:** 2026-10-26  

# Code Review — Task #1278 (SA pick-doc contract spike)

## Verdict: PASS

Three axes run against the converged working tree. Two minor findings fixed
in convergence; no majors.

## Standards

- New exports (`PickDocMissStatus`, `PickDocMiss`, `PickDocDayEntry`,
  `isPickDocPick`) follow the file's JSDoc + section-banner conventions and
  are side-effect-free — consistent with the existing const-vocabulary
  exports in the same file.
- `isPickDocPick` narrows identically to SA's `isPickEntry`
  (`'contractId' in entry && entry.contractId != null`) — deliberate
  cross-repo parity, documented in the JSDoc.
- Spec additions match the existing describe/fixture style; `@ts-expect-error`
  narrowing test is consistent with the file's precedent.
- Doc headers conform; `Last Updated` bumped on all three touched docs.
- **Minor (fixed):** `updatedAt` JSDoc said "stamped by the partner endpoint"
  — corrected to SA's materialization writer (the endpoint passes it through).
- **Nit (fixed):** spec assertion `expect(a && b).toBe(true)` split into two
  assertions so a narrowing failure reports what actually failed.

## Spec (issue #1278 ACs)

| AC | Result |
|---|---|
| Endpoint name + request/response contract confirmed and recorded | **Partial — recorded honestly.** Wire doc shape confirmed against SA `CellYearDoc` (shipped av-proxy-api#219, declared the wire contract by SPEC 213-215). Request granularity confirmed `(symbol, type, delta, dte, year)` per year shard. Endpoint **name** is open — SA#225 not yet implemented (blocked by #223); recorded as an open seam in IMPL-BE §3 + issue comment. Issue body marks the AC checked with the caveat noted. |
| `PickDocument` matches the confirmed shape | **PASS** — reconciled: `days` is now `PickDocDayEntry` (pick \| explicit miss), `updatedAt?` added, `isPickDocPick` guard added. `PickDocDay` was already field-for-field identical to `DayPick`. |
| Auth path = existing partner-proxy pattern | **PASS** — SA#225 states "auth follows existing partner-endpoint conventions"; SPEC 213-215 mandates endpoint-only access. Same HTTPS GET + ID-token path as `partnerHistoricalOptions*`. |

Spike also recorded two consequences downstream tasks need: `startDate` is
a client-side filter (not a request param; year-sharded fetches), and the
grid is keyed on deltaPct magnitude (`abs(targetDelta) × 100`) — both seed
coordinates confirmed on-grid.

## Thermo-Nuclear (maintainability / scope)

- No speculative surface added: `PickDocMissStatus` is exported only because
  #1280's mapper needs it for the reason-mapping (`no_match`→`'miss'`,
  `no_chain`→`'gap'`), mirroring SA's `DayMissStatus` export.
- `updatedAt?: string` — optional, costs nothing, true to the wire.
- Deliberately NOT added: `isPickDocMiss` (two-member union — `!isPickDocPick`
  is total; a negating wrapper is noise), response-envelope fields (endpoint
  unbuilt — recorded as open).
- Verify script change is minimal: real value import + narrowing; no
  duplicated assertions introduced.

## Convergence log

- Pass 1 (self-review): guard aligned to SA null-safety; grid/deltaPct
  derivation + on-grid seed confirmation + codec note added to IMPL-BE §3.
- Pass 2 (review): `updatedAt` attribution corrected; spec assertion split.
- Pass 3 (review re-run): stale wire-semantics in two upstream docs fixed —
  ADR-010 got a dated **Amendment** section (year-shard fetch + explicit miss
  entries + endpoint-pending note; recorded decision text left intact) and
  PRD-1241 three factual fixes (mermaid "1 fetch"→per-year fetch, verify
  bullet now covers miss entries, "one fetch per run"→per year).
- Recovered error: IMPL-SHARED was briefly newline-flattened by a PowerShell
  `Set-Content -NoNewline` during implement; restored from git and re-applied
  via edits — verified intact.

## Test state at review

- `jest shared/options-replay-contracts.spec.ts` — 16/16
- `jest shared/` — 795/795
- verify script `…-1275-contracts.ts` — all checks pass under tsx
- `tsc --noEmit` — clean on task files (2 known unrelated errors stand)
