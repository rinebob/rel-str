**Topic:** Option chain percent change grid  
**Topic Slug:** option-chain-pct-change-grid<br>
**Thread:** Option chain percent change grid
**Thread Slug:** initial-impl<br>
**Issue:** #329  
**Thread Parent:** #327
**Topic Parent:** #326  
**Domain:** OPTIONS  
**Type:** Test Plan  
**Area:** BE  
**Status:** Draft  
**Created:** 2026-09-15  
**Last Updated:** 2026-09-15  

---

# Test Plan: Option chain percent change grid — BE

## E2E User Journeys

- Callable deployed: `getHistoricalOptionsChain({symbol: 'QQQ', date: '2024-03-15'})`
  returns a chain with contracts (smoke test against deployed function)

## Integration Tests

- Callable correctly proxies `callPartnerHistoricalOptions` and returns
  the raw `PartnerHistoricalOptionsResponse`
- Callable rejects missing `symbol` with a clear error
- Callable rejects missing `date` with a clear error
- Callable normalizes symbol to uppercase before passing to proxy

## Unit Tests

- Input validation: empty symbol → throws
- Input validation: empty date → throws
- Input validation: whitespace-only symbol → throws (after trim)
- Symbol normalization: lowercase input → uppercase passed to proxy

## Test Seams

- Highest seam: mock `callPartnerHistoricalOptions` and verify the
  callable passes correct args and returns the raw response
- Lower seam: the callable is a thin pass-through — the proxy function
  itself is already tested in the existing options-contract suite

## Edge Cases

- Empty chain response (AV returns no contracts for that date) — callable
  should still return `ok: true` with empty `data.data`
- AV rate limit (429) — callable should propagate the error (no retry
  logic in the callable; retry is the caller's responsibility)
- Symbol not in `tracked_symbols` (404) — callable should propagate
- Large response (413) — callable should propagate

## Prior Art

- Existing `options-contract.callables.ts` test pattern
- `getHistoricalOptionsContract` callable tests as the template
