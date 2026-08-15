**Topic:** Options Strategy Engine — Hybrid Quote Provider (AV EOD + Robinhood MCP)  
**Issue:** #122  
**Topic Parent:** #114  
**Area:** BE  
**Domain:** HYBRID-QUOTE-PROVIDER  
**Type:** Code Review  
**Status:** Complete  
**Created:** 2026-08-15  
**Last Updated:** 2026-08-15

# Code Review — #122 RH MCP Session Manager, Instrument Map Service, and Quote Provider

## Summary

This review covers the #122 implementation: `RobinhoodMcpSessionManager`, `OccRhInstrumentMapService` read/backfill extensions, and `RobinhoodMcpOptionQuoteProvider`. All relevant unit tests, typecheck, and build pass. The implementation meets the PRD/IMPL/TEST acceptance criteria for #122. The minor maintainability notes from the initial review have been addressed.

## Standards

- **@topic tags:** Present on all new and modified files under `options-strategy-engine/` and tests.
- **File size:** All new files under 300 lines; no file exceeds the 400-line guideline.
- **Single responsibility:** Provider, session manager, reader, service, and logger are separate files.
- **Type contracts:** Shared `OptionQuote`, `OccRhInstrumentMapEntry`, `OptionContractRef`, and `OptionQuoteProvider` are reused; no new duplication of shared types.
- **No silent overwrites:** `buildAndPersist` now reads first and logs changes before writing.
- **Resolved notes:**
  - Added `OptionContractRef` in the shared contracts and made `OptionQuote` extend it. Map resolution no longer requires a fabricated `mark` value.
  - Moved `EnvCredentialRepository` to `functions/src/rh-agent-mcp/auth/env-credential-repository.ts`.
  - Replaced `console.log` calls with `createLogger` from `options-strategy-engine/logging.ts`.
  - `parseQuoteItem` now validates that the raw item is a plain object, `quote`/`close` are plain objects when present, and instrument ID fields are strings.

## Spec

| Criterion | Status | Notes |
|---|---|---|
| `RobinhoodMcpSessionManager` opens one MCP session per invocation | Met | `connect()` is lazy; `callTool` reuses `connection`; `close` disposes it. Tests verify reuse and reconnect. |
| Reads `RH_CREDENTIAL_BUNDLE` from environment/Secret Manager | Met | `createRobinhoodMcpSessionManagerFromEnv()` reads `process.env.RH_CREDENTIAL_BUNDLE` and fails closed. |
| `OccRhInstrumentMapService` reads existing entries | Met | `get(occId)` added with `createDefaultOccRhInstrumentMapReader()`. |
| Backfills missing entries via `get_option_instruments`/`get_option_chains` | Met | `getOrResolve` falls through to the resolver and writes the new entry. |
| Writes with correct `expiresAt` | Met | Uses existing `buildOccRhInstrumentMapEntry` / `computeInstrumentMapExpiresAt`. |
| `RobinhoodMcpOptionQuoteProvider` maps `get_option_quotes` to `OptionQuote` | Met | Maps `adjusted_mark_price` → `mark`, `bid_price`/`ask_price`, Greeks, `updated_at` → `asOf`, `source: RH_MCP`. |
| Missing `close.price` surfaces an error | Met | Throws `RH MCP quote provider: missing close.price`. Tested. |
| Batching stays within 20 instrument IDs | Met | `getQuotes` slices at `maxBatchSize` (default 20). Tested with batch size 2. |
| `mark` from `adjusted_mark_price`, decimal strings converted | Met | `parseNumber` handles decimal strings. |
| Optional Greeks skipped when null | Met | `parseNumber` returns `undefined` for null/missing; only populated fields are assigned. |

## Thermo-nuclear

- **Abstraction quality:** `RobinhoodMcpOptionQuoteProvider` defaults to `new OccRhInstrumentMapService(new McpOccRhInstrumentMapResolver(callTool))`, so a caller can hand it a `RobinhoodMcpSessionManager.callTool` and get one-session behavior for both map backfill and quote calls.
- **Type boundary cleanup:** `OptionContractRef` separates the static contract identity (`contractID`, `symbol`, `expiration`, `strike`, `type`) from the full `OptionQuote`. The map resolver, service, and writer now operate on `OptionContractRef`; `buildMinimalQuote` (with its `mark: 0` placeholder) has been removed.
- **Boundary validation:** `parseQuoteItem` now validates the raw MCP item shape instead of blindly casting. This removes the boundary-cast smell and makes the parser safe against unexpected response shapes.
- **Pre-existing per-call session path:** `McpOccRhInstrumentMapResolver`'s default `McpToolCaller` still uses `executeObservationTool`, and `runEodNightlySelection` defaults to `new OccRhInstrumentMapService()`. Those paths are outside #122's component scope but should be wired through `RobinhoodMcpSessionManager` when the EOD orchestrator is moved to session reuse in a later task.
- **No file sprawl or spaghetti:** The diff adds focused files and small extensions; no existing file gained unrelated branches.

## Test results

- `npx tsx --test ../tests/functions/options-strategy-engine/*.test.ts` — **46 pass, 0 fail**.
- `npx jest shared/options-strategy-engine-contracts.spec.ts` — **17 pass, 0 fail**.
- `npm run typecheck` — **pass**.
- `npm run build` — **pass**.
- `git diff --check` — **clean** (only CRLF/LF warnings).

## Findings

- **fixed** — `console.log` replaced with `createLogger`.
- **fixed** — `buildMinimalQuote` removed; `OptionContractRef` introduced and used for map resolution.
- **fixed** — `parseQuoteItem` now validates raw MCP quote item shape.
- **fixed** — `EnvCredentialRepository` moved to `rh-agent-mcp/auth/`.
- **fixed** — `getQuote` redundant missing-quote check removed.
- **nit** — `McpOccRhInstrumentMapResolver`'s default caller still uses `executeObservationTool`; callers must explicitly pass a manager-backed `callTool` for session reuse.

## Verdict

**PASS** — #122 acceptance criteria are met, tests and build are green, and the only remaining finding is a pre-existing per-call wiring path outside #122's component scope.

## Next steps

- Commit the #122 changes if the user approves.
- When wiring the EOD/mark passes, pass the same `RobinhoodMcpSessionManager.callTool` into both `RobinhoodMcpOptionQuoteProvider` and any direct `OccRhInstrumentMapService` instances.
