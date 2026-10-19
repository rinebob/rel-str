# CODE-REVIEW — #1079 analysis-dataset verify relay

**Topic:** Paper Trading Infra  
**Topic Slug:** paper-trading-infra  
**Thread:** Trade Analysis & Forensics  
**Thread Slug:** trade-analysis  
**Issue:** #1079  
**Blueprint:** #1075  
**Thread Parent:** #1059  
**Topic Parent:** #553  
**Task:** #1079  
**Domain:** PAPER-TRADING  
**Type:** Code Review  
**Status:** Complete  
**Created:** 2026-10-20  
**Last Updated:** 2026-10-20  

## Verdict: PASS (round 1 — one finding fixed during review)

## Scope

Working-tree diff covering only the #1079 files (the tree also holds
unrelated #1007/#755/#1024 work — excluded):

- `functions/scripts/verify/paper-trading-analysis-dataset.ts` (new)
- `functions/scripts/verify/paper-trading-analysis-dataset.md` (new)
- `functions/scripts/verify/paper-trading-analysis-dataset-amat-prototype.csv` (new — checked-in reference fixture)
- `functions/scripts/verify/run-all.ts` (+1 registration line)
- `functions/scripts/verify/README.md` (table row + run-order entry)
- `docs/topics/553-paper-trading/553-1059-1065-IMPL-...-be-....md` (§4 as-builts + Last Updated)

## Findings

### Fixed during review

- **Tautological row-count check (minor)** — the live dry-run compared
  collected rows to the pass's own return value, which is definitionally
  equal and can't catch a scope filter silently dropping trades. Now the
  `listTrades` dep records the independently-enumerated ledger count and
  the check compares `rows.length === enumerated` (pass return kept in
  the fail message). Verified: `247 rows (247 enumerated)`.

### Investigated, held clean

- **#1007 transitional fallback** — canonical `st-paper-trading` is
  empty until the rename migration runs; the `listTrades` dep falls back
  to the legacy path with a `⚠` (same `{id, ...data}` + `isPaperTrade`
  construction `listTrades` uses). Self-healing — post-migration the
  legacy read never fires. Both modes observed green: 1-warn during the
  migration window, warn-free after.
- **Frozen `barRange.to` (2026-10-16)** — the fixture's max referenced
  date; bars past it can't enter the walk, so appended SDS data can't
  drift the parity check. Extracted to `FROZEN_TO` (was a literal in two
  call sites).
- **`agg()`/`loadPrototype` NaN paths** — an all-open run or a malformed
  fixture produces NaN aggregates; every tolerance comparison evaluates
  false → FAIL. Fails safe, no crash.
- **Fixture-derived expectations** — expected stats and the signal key
  set derive from the checked-in CSV at run time rather than hardcoded
  constants; a fixture edit is review-visible in git. Accepted.
- **Naive CSV split** — fixture is flat, unquoted data; CRLF residue can
  only reach the last column (`ind.zoneV2Prev`, unused by the checks).
- **Unused import swept** — `PaperTrade` dropped after the fallback
  refactor; tsc clean.

## Test results

- `npx tsx scripts/verify/paper-trading-analysis-dataset.ts` —
  **ALL CHECKS PASSED**: live 247 trades → 247 rows (229 signal-equity /
  18 excluded, 19 closed / 228 open); AMAT parity 99/98/32.7%/1.30 with
  zero signal-set diff; full-history baseline 194/193/35.8%/1.30
- **Negative path proven** — fixture tampered (5 returns sign-flipped)
  → `2 CHECKS FAILED` → exit 1, expected-vs-actual diff printed;
  restored → green
- `npx tsc --noEmit` (functions) — clean
- `writeDataset` collector seam means the run structurally cannot write
  GCS or index docs (AC)

## Spec traceability (issue ACs)

| AC | Result |
|---|---|
| dry-run never writes to GCS or index | PASS — collector seam, structural |
| AMAT asserts closed/%profitable/payoff in tolerance + prints diff | PASS — printed table + asserts + signal-set diff |
| exits non-zero on parity failure; wired into run-all | PASS — proven by tamper run; registered in `run-all.ts` + README |
