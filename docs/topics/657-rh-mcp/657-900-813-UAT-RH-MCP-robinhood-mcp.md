**Topic:** Robinhood MCP  
**Topic Slug:** robinhood-mcp  
**Thread:** Production RH API  
**Thread Slug:** production-rh-api  
**Issue:** #900  
**Thread Parent:** #795  
**Topic Parent:** #657  
**Task:** #813  
**Domain:** RH-MCP  
**Type:** UAT  
**Status:** Complete  
**Created:** 2026-10-07  
**Last Updated:** 2026-10-07  

# UAT — FE: `executeTools` batch client + portfolio fan-out adoption

QA issue: #900. Code review:
`657-803-813-CODE-REVIEW-RH-MCP-robinhood-mcp.md` (PASS, 2 rounds).
Backend batch contract verified under #809 (QA #893, PASS).

## Automated evidence

- `robinhood-mcp-observation.service.spec.ts` + `robinhood-mcp-client.service.spec.ts`
  + `portfolio-dashboard.store.spec.ts` + `portfolio-dashboard.store.selectors.spec.ts`:
  **115/115 pass** (re-run at QA). Covers: batch request shape, ordered
  results, per-item failure → per-slot rejection, transport failure →
  group rejection, `tool`-stamp cross-check, `toolError` gate, >20-cap
  early reject, empty-calls early return, `HTTP_TIMEOUT_TOKEN` = 90s,
  store phase batching + per-section error mapping.
- `tsc --noEmit` clean on `tsconfig.app.json` and `tsconfig.spec.json`.

## Live local evidence (through the Angular proxy, `:4210 → :3456`)

Executed 2026-10-07 against the running dev stack:

| Check | Result |
|---|---|
| `POST :4210/api/rh/tools/get_accounts` | 200 — single-call path intact through proxy |
| Mixed batch `[accounts, portfolio(bad args), accounts]` | 200 `success:true`, ordered `[ok, FAIL VALIDATION "Tool arguments must be a JSON object.", ok]` — per-item isolation + `tool` stamps on every entry |
| `{calls:[]}` | 400 |
| Malformed item (missing `tool`) | 400 |
| Portfolio page loads end-to-end | User-verified — page load via `/api/rh/batch` confirmed working after dev-server restart |

## Scenario checklist (QA #900)

- [x] Phase 1 = one `POST /api/rh/batch` per account — store spec asserts
  a single `executeBatch` per account; live page load confirmed by user.
- [x] Phase 2 = one global quotes batch (≤20 calls per request) + one
  orders batch per account — spec-asserted; live mixed batch green.
- [x] Per-item failure → per-section error, siblings populate — proven
  at the transport layer above and by store specs (`VALIDATION` slot
  isolated, siblings `ok`).
- [x] Transport/envelope failure → all grouped sections error —
  spec-covered (`executeTools` reject → all-slots-rejected fallback).
- [x] `retrySection('orders')` → single batch — spec-covered via the
  shared `runOrdersBatch`/`applyOrdersResults` helpers.
- [x] >20-symbol safety — chunking spec'd (25→2 calls, 45→3 calls,
  ≤20 calls per `/batch` request); `BATCH_CALLS_LIMIT` guard added.
- [x] Timeout headroom — FE 90s ≥ server ~80s worst case (75s budget +
  connect inside + ~5s close); pinned in spec.
- [x] Diagnostics — session-failure envelope now surfaces server
  `error`/`category` (e.g. AUTH) instead of a generic message; spec'd.
- [ ] **Production UAT — deferred to post-ship** (precedent: #810 UAT).
  After `ship 657 809` + `ship 657 813` deploy `rhApi` + the frontend,
  verify on savanttrader.com: portfolio page loads, devtools shows
  `/batch` calls to `us-central1-rel-str.cloudfunctions.net`, per-section
  errors surface with real messages, retry works.
- [ ] Manual eyeball: per-section error affordance on a forced failure —
  spot-check during the prod pass (no local failure-injection needed
  today; behavior is spec-pinned).

## Findings disposition

All review findings remediated in-loop (see the CODE-REVIEW doc). Open
follow-ups (not QA blockers): `equity-price.service.ts` unchunked quote
call and `allocation-data.service.ts` parallel singles — flagged as
Thread backlog items; shared-contract type consolidation deferred to a
BE-touching task.

## Verdict

**PASS** — local evidence + test gate green; production scenario is the
post-ship smoke noted above and tracked on #900's checklist.
