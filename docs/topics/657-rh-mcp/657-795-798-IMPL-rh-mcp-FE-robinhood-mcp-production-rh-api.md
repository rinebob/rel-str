**Topic:** Robinhood MCP  
**Topic Slug:** robinhood-mcp  
**Thread:** Production RH API  
**Thread Slug:** production-rh-api  
**Issue:** #798  
**Thread Parent:** #795  
**Topic Parent:** #657  
**Domain:** RH-MCP  
**Type:** IMPL  
**Status:** Draft  
**Created:** 2026-10-05  
**Last Updated:** 2026-10-05  

# IMPL — FE: Production RH API

Frontend work is deliberately small: the relative `/api/rh` base URL already
resolves correctly in both environments once the hosting rewrite lands.

## Components

### 1. ID-token attach — `robinhood-mcp-observation.service.ts`

Inject `Auth` (`@angular/fire/auth`), and on every request attach
`Authorization: Bearer ${await getIdToken(currentUser)}` (the `run.service.ts`
pattern). The local API ignores the header — one code path, no env branching.

If `currentUser` is null, let the request fire and surface the 401 (routes are
already `authGuard`-protected; this is a belt line, not the auth mechanism).

### 2. Reauth-required UX

- `executeTool` errors carry `category` — map the AUTH/reauthorization state to
  a user-visible message: "Robinhood session expired — contact admin / run local
  reauth" rather than a generic failure.
- `reauthenticate()` on prod returns `{ success:false, state:'REAUTHORIZATION_REQUIRED' }`
  — the order page / observation dashboard should render that state instead of
  implying an in-browser reauth happened.

### 3. Batch adoption — `executeTools(calls)`

- New client method: `POST /api/rh/batch` with `{ calls: [{ tool, args }] }` →
  ordered `[{ tool, result }]`.
- `RobinhoodMcpClient` gains batch variants used by
  `portfolio-dashboard.store.ts` `loadPhase1`/`loadPhase2` — one HTTP request per
  phase per account instead of N parallel calls.
- Per-item failure handling mirrors today's `Promise.allSettled` semantics:
  failed items → `errorSection` per section, not whole-page failure.

## Blocked by

- FE-1 technically unblocked (local API ignores the header; specs cover it) —
  prod verification needs `rhApi` deployed.
- FE-3 blocked by the BE `_batch` endpoint task.

## Verification

- Jest specs: header attached with token, `executeTools` request shape,
  portfolio store batches + per-section error mapping, reauth state rendering.
- Manual UAT on prod after BE deploy: portfolio dashboard live, observation
  dashboard tools list, order place/cancel round-trip.
