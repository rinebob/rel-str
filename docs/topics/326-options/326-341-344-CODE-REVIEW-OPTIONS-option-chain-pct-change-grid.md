**Topic:** Option chain percent change grid  
**Topic Slug:** option-chain-pct-change-grid<br>
**Thread:** Option chain percent change grid
**Thread Slug:** initial-impl<br>
**Issue:** #341  
**Thread Parent:** #327
**Topic Parent:** #326  
**Task:** #344  
**Domain:** OPTIONS  
**Type:** Code Review  
**Status:** Complete  
**Created:** 2026-09-16  
**Last Updated:** 2026-09-16  

---

# Code Review: Task #344 — BE `getHistoricalOptionsChain` callable

## Summary

Task #344 adds the `getHistoricalOptionsChain` Firebase callable that
wraps the existing `callPartnerHistoricalOptions` proxy function. This
is a thin pass-through callable — no business logic, no caching, no
persistence. Three review axes were run: Standards, Spec, and
Thermo-nuclear.

## Findings by severity

### Minor (resolved during review)

1. **JSDoc `...` placeholder** — The JSDoc referenced
   `proposal doc 326-327-329-PROPOSAL-...` with an ellipsis. The prior
   SHARED review fixed the same pattern. Replaced with the full
   filename: `docs/topics/326-options/326-327-329-PROPOSAL-OPTIONS-savantapi-chain-snapshot-caching-option-chain-pct-change-grid-initial-impl.md`.

2. **`throw` style inconsistent** — Used unbraced `if (!sym) throw ...`
   while the other callables use braced blocks. Fixed to use braced
   blocks matching `getHistoricalOptionsContract`.

3. **Overly defensive optional chaining** —
   `Array.isArray(data?.data?.data) ? data.data.data.length : 0` was
   overly defensive given the shared type guarantees
   `data.data.data: HistoricalOptionContract[]`. Simplified to
   `data.data.data.length` to match the `data.series` pattern in
   `getHistoricalOptionsContract`.

### Minor (deferred)

4. **No unit tests committed** — The BE test plan says the build is the
   primary verification seam for thin pass-through callables. No
   existing test infrastructure for callables exists in this repo.
   Deferring — the callable is a thin wrapper with no business logic.

5. **`source` optionality mismatch** — `PartnerHistoricalOptionsResponse`
   (BE) requires `source: string` while `GetHistoricalOptionsChainResponse`
   (shared) has `source?: string`. This is intentional — SA may not
   include the `source` field yet. The BE type is assignable to the
   shared type. Deferring as a deliberate design decision.

6. **File approaching 400 lines** — `options-contract.callables.ts` is
   now 384 lines with 5 callables. Watch item — if another callable is
   added, consider splitting by responsibility.

### Nit (deferred)

7. **Error-logging boilerplate repeated** — The `catch` block pattern
   is repeated across 4 callables. A `logCallableError` helper could
   reduce duplication. Acceptable for 4 callables; deferred.

## Test results

- **BE build (`cd functions && npm run build`):** PASS
  (`lib\index.js 1.5mb, Done in 86ms`)
- **FE test suite (`npx ng test --watch=false`):** FAIL — pre-existing
  `fs`/`path` module resolution errors in
  `options-strategy-dashboard.component.spec.ts` and `strategy-builder`
  spec files. Verified pre-existing (same errors on base commit).
  Not caused by Task #344.

## Verdict: PASS

All actionable findings resolved during review. Deferred findings are
intentional design decisions or watch items. BE build passes. Pre-existing
test failures are unrelated to this task.
