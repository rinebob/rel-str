**Topic:** Option chain percent change grid  
**Topic Slug:** option-chain-pct-change-grid<br>
**Thread:** Option chain percent change grid
**Thread Slug:** initial-impl<br>
**Issue:** #329  
**Thread Parent:** #327
**Topic Parent:** #326  
**Domain:** OPTIONS  
**Type:** Implementation Plan  
**Area:** BE  
**Status:** Draft  
**Created:** 2026-09-15  
**Last Updated:** 2026-09-15  

---

## Scope

The BE area covers the new `getHistoricalOptionsChain` callable that
wraps the existing `callPartnerHistoricalOptions` proxy function. This
is a thin pass-through callable — no business logic, no caching, no
persistence.

## Modules

### 1. New callable: `getHistoricalOptionsChain`

Add to `functions/src/options-contract.callables.ts`:

```ts
/**
 * getHistoricalOptionsChain — Fetch the full historical options chain
 * snapshot for a symbol on a specific date via the Savant Partner API.
 *
 * Wraps `callPartnerHistoricalOptions` behind a callable so the FE
 * never calls the partner API directly. Live fetch from Alpha Vantage
 * every request — no caching (SA may add GCS caching in the future;
 * see proposal doc 326-327-329-PROPOSAL-...).
 */
export const getHistoricalOptionsChain = onCall(
  { region: 'us-central1', cors: ST_ALLOWED_ORIGINS },
  async (req): Promise<GetHistoricalOptionsChainResponse> => {
    const { symbol, date } = (req.data || {}) as GetHistoricalOptionsChainRequest;
    const sym = String(symbol || '').trim().toUpperCase();
    const dt = String(date || '').trim();

    if (!sym) throw new Error('symbol is required');
    if (!dt) throw new Error('date is required');

    logger.info('getHistoricalOptionsChain', { symbol: sym, date: dt });

    try {
      const data = await callPartnerHistoricalOptions({ symbol: sym, date: dt });

      logger.info('getHistoricalOptionsChain_response', {
        symbol: data.symbol,
        date: data.date,
        contractCount: Array.isArray(data?.data?.data) ? data.data.data.length : 0,
      });

      return data;
    } catch (e: unknown) {
      logger.error('getHistoricalOptionsChain_error', {
        symbol: sym,
        date: dt,
        message: e instanceof Error ? e.message : String(e),
        stack: e instanceof Error ? e.stack : undefined,
        error: e,
      });
      throw e;
    }
  },
);
```

**Pattern consistency:** Follows the exact pattern of the existing
`getHistoricalOptionsContract` callable — `onCall` with
`ST_ALLOWED_ORIGINS`, input validation, `logger.info` on request and
response, `catch (e: unknown)` with `instanceof Error` narrowing, re-throw.

### 2. Export from index

Add to `functions/src/index.ts`:

```ts
export { getHistoricalOptionsChain } from './options-contract.callables';
```

## Dependencies

- SHARED area must be complete first (request/response types)
- `callPartnerHistoricalOptions` already exists in
  `functions/src/options-contract-proxy.ts` — no new proxy function needed

## Verification

- `cd functions && npm run build` passes
- Callable is deployed and returns a chain for a test symbol+date
  (e.g., QQQ 2024-03-15)
