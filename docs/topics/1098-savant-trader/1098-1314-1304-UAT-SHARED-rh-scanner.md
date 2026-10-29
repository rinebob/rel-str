**Topic:** RH Scanner  
**Topic Slug:** rh-scanner  
**Thread:** Scanner Row Actions  
**Thread Slug:** scanner-row-actions  
**Issue:** #1314  
**Thread Parent:** #1295  
**Topic Parent:** #1098  
**Task:** #1304  
**Domain:** SAVANT-TRADER  
**Area:** SHARED  
**Type:** UAT  
**Status:** Complete  
**Created:** 2026-10-27  
**Last Updated:** 2026-10-28  

# UAT — #1304: get_equity_historicals wire contract

## Scope

SHARED wire contract for the `get_equity_historicals` RH MCP tool —
`EquityHistoricalsRequest`, `EquityHistoricalInterval`,
`EquityHistoricalBar`, `EquityHistoricalsSymbolResult`,
`EquityHistoricalsResult` in `shared/robinhood-mcp-contracts.ts`
(`@robinhood-mcp/contracts`). Consumed downstream by the scanner
untracked-symbol hover chart (ADR-011). No UI surface in this task.

## Prerequisites

- Repo checkout at `C:\aa\projects\rel-str` with `node_modules` installed.
- Live captures on disk: `docs/topics/657-rh-mcp/captures/ro-eq-hist-*.json`
  (11 files — verified present).
- **Scenario 3 only:** the local RH MCP executor listening at
  `http://127.0.0.1:3456` (the same service the observation dashboard uses).
- No Firebase credentials, account number, or Firestore access needed.

## Start instructions

All commands run from the repo root:

```bash
npx tsx scripts/verify/savant-trader-scanner-row-actions-1304-contracts.ts
npx tsx scripts/verify/savant-trader-scanner-row-actions-1304-live.ts
npx jest --coverage=false
```

## Test scenarios

### 1. Offline capture parity (registered in run-all)

- **Confirms:** every request-arg / response-top-level / `data`-level /
  result-entry / bar key observed in the 11 `ro-eq-hist-*` captures is
  declared in the contract, and vice versa.
- **Steps:** run the `-contracts.ts` script above.
- **Expected:** every check prints `OK`; ends `=== PASS ===`; exit 0.
  `WARN` lines (declared-but-unobserved fields) are informational only.
- **Negative behavior (self-check):** the script structurally asserts
  `response.data.results` is an array per capture — a malformed or
  shape-drifting capture fails rather than silently passing.
- **Result:** PASS — 22/22 OK, 0 WARN, exit 0 (run 2026-10-27).

### 2. Compile-level contract resolution

- **Confirms:** the types resolve through the real
  `@robinhood-mcp/contracts` tsconfig alias from a consumer file.
- **Steps:** `npx tsc --noEmit` over a tsconfig that includes the verify
  scripts + the contract file (the scripts import all four types via the
  alias — a broken alias or renamed field fails compilation).
- **Expected:** no diagnostics; exit 0.
- **Result:** PASS — clean under `strict` (run 2026-10-27).

### 3. Live tool call (deliberately NOT in run-all)

- **Confirms:** the declared shape matches the real wire TODAY, not just
  the October captures — calls `get_equity_historicals` with
  `{symbols:['AAPL'], start_time:<~370d ago>, interval:'day'}` through the
  local executor.
- **Prereq:** RH MCP executor at `http://127.0.0.1:3456`.
- **Steps:** run the `-live.ts` script above.
- **Expected:** 7 checks OK — `success`, `data.results` non-empty,
  `symbol='AAPL'`, `interval='day'` echo, ~250 bars, bar field types
  (string prices, number volume, ISO `begins_at`); ends `=== PASS ===`.
- **Failure modes:** executor down → `FAIL RH MCP executor unreachable`;
  HTTP error → `FAIL executor returned HTTP …`; shape drift → `FAIL N/M
  bars violate the contract shape`.
- **Result:** PASS — 7/7 OK, 254 day bars returned (run 2026-10-27).

### 4. Regression — full jest suite

- **Confirms:** the additive contract change broke nothing.
- **Steps:** `npx jest --coverage=false` (full suite, ~2 min).
- **Expected:** all suites pass.
- **Result:** PASS — 270 suites / 4,706 tests, fresh run 2026-10-27.

## Traceability

| Acceptance criterion | Scenario |
|---|---|
| `EquityHistoricalsRequest` w/ field-guide constraints commented (`symbols`/`start_time`/interval cap/`all`≥day) | 1 (arg-name parity), 3 (live `interval:'day'` call) |
| `EquityHistoricalBar` wire names verified vs #657 captures | 1 (bar-key parity across all 11 captures), 3 (live bar types) |
| `EquityHistoricalsResult` (`data.results[]` + `guide`) | 1 (top-level + data-level + result-entry parity), 3 (live envelope) |
| Exported through `@robinhood-mcp/contracts`, no new barrel | 2 (alias-resolving compile) |
| Capture-parity verification per TEST doc | 1 |
| Live verification per TEST doc | 3 |

## Regression / smoke checklist

- [x] `PreviewScan*` contracts unchanged (additive block only — `git diff`
  confirms no edits above line 171)
- [x] `functions/tsconfig` alias `@robinhood-mcp/contracts` still resolves
  (type-only additions)
- [x] run-all registers the offline script only — live script documented
  but unregistered (executor-down machines stay green)

## Findings

None. Refinement pass: **Not applicable — no user-facing surface**
(SHARED type contract; chart UX lands under FE tasks #1305–#1309).
