**Topic:** Strategy Builder UI  
**Topic Slug:** strat-manage  
**Thread:** OpsStrat Manage Page Overhaul  
**Thread Slug:** page-overhaul  
**Issue:** #1536  
**Thread Parent:** #1510  
**Topic Parent:** #137  
**Task:** #1543  
**Domain:** STRAT-MANAGE  
**Type:** CODE-REVIEW  
**Status:** Complete  
**Created:** 2026-11-17  
**Last Updated:** 2026-11-17  

# Code Review — #1543 BE: Manage contract-list writer

## Scope reviewed

New: `paper-trading/engine/passes/contract-list-writer.ts`
(`appendManageContractListRows` + `prodContractListWriterDeps`),
`options-strategy-engine/passes/contract-list-writer.ts` shim,
`contract-list-writer.test.ts` (7 specs),
`strat-manage-contract-list-1543.{ts,md}` verify harness.
Modified: `manage-open-pass.ts` (`ResolvedLegContract`, `quoteByOccId`
side-map, `appendContractListRows`/`getLegs` deps, post-mint append +
dedup-path reconcile, `withTimeout` bound), `rh-mcp-shapes.ts`
(`RhResolvedQuote` + `RhMcpToolCaller` hoisted), `run-all.ts`/`README`
registry entries, IMPL §4 as-built. Foreign in-flight edits elsewhere
in the tree were excluded.

## Axes

### Standards — PASS (4 minors fixed in-cycle)

- **FIXED** direct `firebase-functions/logger` import →
  `createLogger('ContractListWriter')` (sibling convention).
- **FIXED** shim missing the `@topic` header line siblings carry.
- **FIXED** meta coordinate sourced from `instance.variant.legs[0]` →
  `legs[0].leg` (self-consistent + closes an undefined edge).
- **FIXED** `appendContractListRows` default moved into a named
  `defaultAppendContractListRows` factory (file's own Defaults
  pattern); `RhMcpToolCaller` hoisted to `rh-mcp-shapes` (canonical
  home — signature was inlined 4× there); `@topic`/`@task` tags added.

### Spec — PASS (1 major + 1 minor fixed in-cycle)

- **FIXED (major)** `get_equity_quotes` called with `symbols: string`
  — the tool schema requires an array; every prod row would have
  silently written `underlyingClose: NaN`. Now `symbols: [symbol]`.
- **FIXED (minor)** non-transactional read-modify-write → single
  `upsertDoc` seam; prod runs the callback inside `runTransaction` and
  writes a complete `set` (also clears a stale `error` field).
- AC1–AC3 verified: doc id = instanceId, one v1 `pick` row per leg
  contract with full `PickDocDay` fields, `status:'success'` +
  runId/symbol/templateId satisfy the `optionsAnalysisStart` gate;
  worker's `kind==='pick'` filter and `buildPickRecords` field reads
  all covered. IMPL §4 as-built note matches code.

### Thermo-Nuclear — PASS after fixes (2 majors → fixed)

- **FIXED (major)** unbounded `callTool` hang post-mint: the
  `get_equity_quotes` call has no session timeout; a wedge after the
  position minted would skip `lastFiredAt`/result-write and starve
  every later instance in the timer's serial loop. Both append call
  sites now race a 30 s bound — timeout warns + continues like any
  other append failure.
- **FIXED (major)** silent permanent row loss: an append failure
  warned + reported success while `already_opened_today` dedup meant
  the leg group could never land — the analysis would silently omit a
  live position. Two-part fix: the upsert callback dedupes per
  `(entryDate, contractId)` (idempotent — a re-append of a landed
  group returns the doc untouched), and the `already_opened_today`
  path re-attempts the append from persisted `PositionLeg`s via a new
  `getLegs` dep (greeks lost → `NaN`; contractId/mark/strike/
  expiration all real).
- **FIXED (minor)** `quoteByOccId` last-write-wins could pair one
  instrument's mark with another's greeks on same-OCC instruments —
  candidates now dedupe by OCC id so mark+greeks stay same-instrument.
- **Documented residuals** (cosmetic/deferred): `generatedAt` ISO
  string vs SA's `serverTimestamp()` sort nuance; same-index flag
  misaligns on mid-life variant leg-count edits (write-only field);
  the writer must move to v2 rows when the consumer migration lands
  (noted in module header + IMPL).

## Verification

- `tsx --test` contract-list-writer + manage-open-pass specs:
  **33/33 pass** (7 writer + 5 seam/reconcile new).
- `scripts/verify/strat-manage-contract-list-1543.ts`: **37/37 OK**.
- `functions` `tsc --noEmit` + `npm run build`: clean.

## Verdict

**PASS** — all majors and every actionable minor fixed in-cycle;
remaining findings are documented cosmetics or explicitly deferred
(v2 schema migration owns its own coordination).
