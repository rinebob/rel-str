**Topic:** Portfolio Dashboard  
**Topic Slug:** portfolio  
**Thread:** Load Architecture & Order Surfacing  
**Thread Slug:** load-architecture-order-surfacing  
**Issue:** #1405  
**Thread Parent:** #1403  
**Topic Parent:** #219  
**Domain:** PORTFOLIO  
**Type:** TEST (FE)  
**Status:** Approved  
**Created:** 2026-11-05  
**Last Updated:** 2026-11-05  

# FE Test Plan — Load Architecture & Order Surfacing

## E2E / UAT Journeys

1. **Cold load:** open dashboard → positions for default account render (only default-account calls in network tab) → other accounts populate in background without a page-level loader.
2. **Tab select during prefetch:** click account 2 while its fetch is in flight → existing section spinners, no duplicate requests, data lands.
3. **Rapid updates:** update 3 stops back-to-back → each dialog completes normally; orders reconciles dedupe (≤2 wire calls per account); page never blocks.
4. **Protected vs unprotected:** position with live stop shows Stop/Dist/Peak/Retraced; position without shows UNPROTECTED + Add Stop.
5. **Informed update:** Update Stop dialog shows the story chain + metrics; values match table + Open Orders row.
6. **Forensic repro:** NVDA-class resting order appears in Open Orders (or documented broker-side reason it can't).

## Integration Boundaries

- `RobinhoodMcpClient` → store: `executeBatch` per-section `PromiseSettledResult` mapping preserved under `loadAccount`.
- Store → components: section signals unchanged in shape; `globalLoading` narrows to first-paint semantics.
- `get_equity_historicals` batching: ≤10 symbols/call, RFC3339 range; symbol+holdingPeriod cache key.
- Dialog → `OrderExecutionService`: unchanged boundary; reconcile-only on close.

## Unit Test Targets

- **Store:** `initialLoad` request scoping (spy on client specs — assert only selected-account batches), prefetch queue order, `selectAccount` join-vs-fetch vs no-op, `reconcile` dedupe (in-flight + 1 trailing), `globalLoading` false after visible sections.
- **Accounts cache:** concurrent `getAccounts` callers share one wire call; second call is cache-hit.
- **`position-peak.util`:** holding-period detection (single buy, multi-add, full-exit-and-rebuy, sell-partial), peak = max(high) since entry, missing entry → null.
- **Table:** UNPROTECTED marker when no live stop; columns populated from derivation; stop-limit displayed but ineligible.
- **Dialog:** story-chain values, retracement math, locked-in gain vs basis, both-peaks display when they differ.

## Test Seams

- Client specs remain jest-mockable at `executeBatch`/`executeTool` — new `loadAccount` path keeps spec-level mock granularity.
- Historicals mocked per symbol; date-ranged asserts on `startTime`.
- Fake timers NOT used for the macrotask flush — repo convention is `setTimeout(r, 0)` drains.

## Edge Cases

- Account with zero positions → prefetch still covers its sections; no division-by-zero in retracement.
- Position older than order history window → Peak `—`, row still shows stop/distance.
- Prefetch wave interrupted by account select → queued work re-prioritizes, no lost sections.
- Reconcile fired during in-flight prefetch of same (account, section) → deduped, not doubled.
- Orders response containing an unmapped state string → logged + visible (US-4 audit output).
- Dialog opened for symbol whose stop qty ≠ position qty → context shows both values.
