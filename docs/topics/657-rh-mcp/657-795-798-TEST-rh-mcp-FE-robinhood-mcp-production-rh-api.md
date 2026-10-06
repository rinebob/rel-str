**Topic:** Robinhood MCP  
**Topic Slug:** robinhood-mcp  
**Thread:** Production RH API  
**Thread Slug:** production-rh-api  
**Issue:** #798  
**Thread Parent:** #795  
**Topic Parent:** #657  
**Domain:** RH-MCP  
**Type:** TEST  
**Status:** Draft  
**Created:** 2026-10-05  
**Last Updated:** 2026-10-05  

# TEST — FE: Production RH API

## E2E User Journeys (manual, prod)

- Sign in → portfolio dashboard: accounts, positions, orders all live; network tab shows `Authorization` on `/api/rh/**` and batched calls.
- Observation dashboard: tool list renders; a read tool executes; auth-expired state renders the reauth message (not a raw error).
- Order ticket: place + cancel a small order end-to-end.

## Integration Tests (Jest + TestBed)

- `RobinhoodMcpObservationService` + `HttpTestingController`: every request carries `Authorization: Bearer <token>`; `listTools`/`executeTool`/`executeTools`/`reauthenticate` shapes.
- Portfolio store + service: `loadPhase1` issues one batch call per account; a failed item lands as that section's `errorSection`, others populate.

## Unit Tests

- Reauth-state mapper: AUTH-category error / `{state:'REAUTHORIZATION_REQUIRED'}` → user-facing message; non-auth errors unchanged.
- Batch response → per-tool result mapping (success + per-item error).

## Test Seams

- Highest: component/store specs with `RobinhoodMcpObservationService` stubbed (existing pattern — `useValue: { ... }`) plus `HttpTestingController` for header assertions.
- Lower: pure mapping functions.

## Existing Coverage

- `robinhood-mcp-client.service.spec.ts`, `portfolio-dashboard.store.spec.ts`, `trading-config.service.spec.ts` already stub the observation service — extend, don't duplicate.

## Edge Cases

- `currentUser === null` → request still fires; 401 surfaces as an error state.
- Batch response with mixed success/error items.
- 401 vs 403 vs network failure — distinct user-facing states.
- Local dev unchanged: observation API on :3456 ignores the auth header.
