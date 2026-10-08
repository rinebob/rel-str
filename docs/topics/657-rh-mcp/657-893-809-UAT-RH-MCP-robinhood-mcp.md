**Topic:** Robinhood MCP  
**Topic Slug:** robinhood-mcp  
**Thread:** Production RH API  
**Thread Slug:** production-rh-api  
**Issue:** #893  
**Thread Parent:** #795  
**Topic Parent:** #657  
**Task:** #809  
**Domain:** RH-MCP  
**Type:** UAT  
**Status:** Complete  
**Created:** 2026-10-07  
**Last Updated:** 2026-10-07  

# UAT — `POST /api/rh/batch` (shared-session sequential execution)

## Scope

Backend-only endpoint: `{ calls: [{tool, args}] }`, cap 20, sequential over
ONE MCP session, ordered per-item `{success, …, tool}` results, per-item
failure isolation, per-call timeout + 75s aggregate budget, auth before
dispatch, per-call audit without args. Deployed + live-verified on `rhApi`
(deployment predates the round-2 remediation refactor — wire contract is
identical; post-ship redeploy re-runs the same script).

## Prerequisites

- Repo dev env (`npm start` spawns ng serve :4210 + observation API :3456;
  the API does **not** hot-reload — restart after backend changes).
- Live checks need an owner Firebase ID token. Mint via the app (sign in →
  `await getAuth().currentUser.getIdToken()`) or
  `.devin/tmp/mint-rh-id-token.ts` pattern (ADC + App Engine default SA).
- Owner UID lives in `RH_OWNER_UID` env (never committed).

## Scenarios

| # | Scenario | Steps | Expected | Result |
|---|---|---|---|---|
| 1 | Unauth rejection | `curl -X POST $RH_API/api/rh/batch -d '{"calls":[…]}'` no token | 401, no dispatch | **PASS** — live 401, 2026-10-07 |
| 2 | Empty / >20 / malformed calls | authed POSTs with `[]`, 21 items, missing `tool` | 400 each, nothing dispatched | **PASS** — live verify + tests 1-4 |
| 3 | Ordered mixed batch, one session | POST `[get_accounts, not_a_tool, get_pnl_trade_history*, get_accounts]` | 200 `{success:true, results:4}` — ok/VALIDATION/MCP/ok, `tool` on every entry, `transportCount===1` | **PASS** — test 5 + live run |
| 4 | Per-item arg-shape failure | `[get_accounts, {get_accounts, args:'x'}, get_accounts]` | item 1 `VALIDATION` 'JSON object', siblings succeed | **PASS** — test 6 |
| 5 | Per-call audit, no args | POST with `SECRET_ARG` value | audit entry per call, success/failure outcome, args absent | **PASS** — test 7 |
| 6 | Connect failure | transportFactory throws | 200 `{success:false, category:'MCP'}`, each call audited `failure` | **PASS** — test 8 |
| 7 | Batch deadline | `batchBudgetMs:40` + 80ms tool | item0 clamped-timeout MCP fail, items 1-2 budget-skip failures | **PASS** — test 9 |
| 8 | Per-call timeout, session survives | `callTimeoutMs:30`, first call sleeps 80ms | item0 `timed out`, item1 succeeds on same session | **PASS** — test 10 |
| 9 | Local dev end-to-end | `npm start` → portfolio allocation page loads | `/api/rh/batch` POSTs return 200 through the :4210 proxy | **PASS** — user-verified after API restart |

## Regression / smoke

- `rh-agent-mcp-batch.test.ts` 11/11, `rh-agent-mcp-cloud-api` 16/16 — **PASS**.
- `functions` typecheck clean; lint 0 errors — **PASS**.
- Single-call `POST /api/rh/tools/:tool` unchanged (route untouched in
  behavior; sendJson `destroyed` guard is additive) — covered by suites.

## Traceability

| Task AC | Scenario |
|---|---|
| `{calls:[{tool,args}]}`, cap 20 | 2, 3 |
| empty / >20 → 400 | 2 |
| per-item schema validation | 4 |
| sequential, one MCP session | 3 |
| ordered results | 3 |
| per-item failure isolation | 3, 4, 8 |
| timeout per call honored | 8 |
| auth before dispatch | 1 |
| audit, no args | 5, 6 |
| prod deploy + live smoke | 1–3 (live), plus re-run post-ship |

## Notes for the rerun after ship

The deployed `rhApi` on prod ran pre-remediation code at this UAT's date —
the `/batch` route, auth, 400s, and per-item contract are identical. After
`/proj ship` redeploys the function, re-run
`npx tsx functions/scripts/verify/rh-mcp-batch-809.ts --token <idToken>` to
confirm the remediated build behaves identically.
