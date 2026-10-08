**Topic:** Robinhood MCP  
**Topic Slug:** robinhood-mcp  
**Thread:** Production RH API  
**Thread Slug:** production-rh-api  
**Issue:** #803  
**Thread Parent:** #795  
**Topic Parent:** #657  
**Task:** #813  
**Domain:** RH-MCP  
**Type:** CODE-REVIEW  
**Status:** Complete  
**Created:** 2026-10-07  
**Last Updated:** 2026-10-07  

# Code Review — FE: `executeTools` batch client + portfolio fan-out adoption

Scope: `robinhood-mcp-observation.service.ts` (`executeTools` →
`POST /api/rh/batch`), `robinhood-mcp-client.service.ts` (`ToolSpec<T>`
factories + `executeBatch` typed tuple + quote chunking over the batch
transport), `portfolio-dashboard.store.ts` (one batch per account per
phase, per-item → per-section error mapping), plus the five spec/fixture
files. Working tree carries unrelated WIP in the same files (e.g.
`BrokerOrder.timeInForce`/`marketHours`); that was excluded from review.

## Axes

### Standards

- **minor → fixed** — `executeTools` collapsed the documented
  `{success:false, error, category}` session-failure envelope into a
  generic `'Invalid batch response'`, discarding the server's error and
  AUTH category. Now throws `RobinhoodMcpError(response.error, 'batch',
  response.category)`; the generic message only fires on malformed shapes.
- **minor → fixed** — timeout `min(30s·n, 120s)` underestimated the
  server's worst case (~80s: connect ≤30s inside the 75s batch budget +
  ~5s close) for small batches — see Thermo M1.
- **minor → fixed** — the orders `executeBatch` block (loading patch →
  try/catch → `[failed, failed]` fallback → per-item patch) was
  verbatim-duplicated between `loadPhase2` and `retrySection('orders')`.
  Extracted `runOrdersBatch()` + `applyOrdersResults()`.
- **minor → fixed** — equity then option quotes were awaited sequentially
  (two serial MCP sessions server-side); now `Promise.allSettled` in
  parallel.
- **minor → fixed** — dead `emptySection<T>()` helper deleted.
- **nit → fixed** — `executeTools([])` POSTed an empty batch the server
  400s; now early-returns `[]` (matches `batchQuotes`' own empty guard).
- **nit → fixed** — `equityQuotesError!` non-null assertions replaced by
  `?? 'Quote fetch failed'` fallbacks.
- **minor → flagged follow-up** — the FE↔BE batch contract is duplicated
  three places (`ToolBatchCall`/`BatchResponse` vs
  `ObservationBatchCall`/`ObservationBatchOutcome` vs the inline response
  type; `BATCH_CALLS_LIMIT` vs `MAX_BATCH_CALLS`). Canonical home is
  `shared/robinhood-mcp-contracts.ts` — deferred because it touches the
  BE task's files.
- **minor → noted** — `robinhood-mcp-client.service.ts` (~600 lines) and
  `portfolio-dashboard.store.ts` (~460 lines) exceed the 400-line smell
  threshold; both predated this task and shrank/grew modestly under it.
  The helper extraction recovered ~40 store lines. Spec file is ~1250
  lines — a candidate for a domain-block split, deferred.
- **nit → noted** — `getAccounts`/`getPnlTradeHistory` hand-roll the
  success check instead of routing through a spec (they do now share the
  `toolError` gate — see remediation round 2).

### Spec

| AC | Status |
|---|---|
| `executeTools(calls)` → one `POST /api/rh/batch` `{calls:[{tool,args}]}` | Met + tested — URL/method/body/auth asserted; ordered results returned verbatim. |
| One batch HTTP call per phase per account | Met — `loadPhase1` issues one 3-call `executeBatch` per account; `loadPhase2` issues one 2-call orders batch per account plus one global quotes batch (quotes are symbol-keyed, shared across accounts — the AC's per-account phrasing is imprecise; global fetch is strictly better). |
| Mixed success/error → per-section errors | Met + tested — rejected slots map to `errorSection`; siblings still patch `dataSection`. |
| Transport failure fails the group consistently | Met + tested — batch reject → all-slots-rejected fallback tuple. |
| Quote chunking preserved | Met + tested — 20 symbols per quote call, 20 calls per `/batch` request; 25-symbol and 45-symbol cases asserted. |
| Prod portfolio UAT | Pending — needs the #809+#813 ship; QA gate. |

### Thermo-nuclear

- **HIGH → fixed** — FE batch timeout below the server's worst case:
  `min(30s·n, 120s)` gave 60s for the 2-call orders batch (every phase-2
  and every `'orders'` retry) and 30s for a single-chunk quote request,
  while the server legitimately runs ~80s. Result: false transport
  failures on every section in that batch while the server was
  succeeding. `MCP_TOOL_TIMEOUT_MS` is now 90s flat for both `executeTool`
  and `executeTools` (the single-call path had the same under-coverage:
  connect ≤30s + call ≤45s + close ≈ 80s).
- **MEDIUM → fixed** — session-failure envelope lost `error`/`category`
  (see Standards) — an expired-RH-credentials AUTH failure previously
  surfaced as a generic parse error in every section.
- **MEDIUM → noted, behavior-preserving** — `batchQuotes` is
  all-or-nothing across chunks: one failed chunk discards successfully
  fetched chunks. Verified identical to pre-batch semantics (the old
  `Promise.all` loop threw on the first failure too), so not a
  regression; a partial-quote mode would need SectionData to carry
  data+error together — out of scope.
- **LOW → fixed** — result↔spec correlation was index-only; the wire
  contract stamps `tool` on every entry for exactly this reason.
  `executeBatch` now rejects a slot whose `tool` stamp mismatches its
  spec, so a hypothetical reorder can't feed the wrong parser
  (`get_equity_orders`/`get_option_orders` swap would silently mislabel
  `instrumentType`).
- **LOW → fixed** — post-await patches wrote to `accounts[i]` captured
  before the fetch; a `refresh()` rebuilding the array mid-flight could
  land results on the wrong account. All post-await patch sites now go
  through `patchAccount(accountNumber, …)` which re-resolves the index at
  patch time and no-ops on removal.
- **LOW → fixed** — MCP envelope-level `toolError` was unchecked by every
  FE parser: a tool-level error body could parse as an empty list →
  "no positions" instead of an error section (same blind spot previously
  fixed BE-side). New shared `parseSpecResult` gate throws on
  `toolError` for both `run` and `executeBatch`.
- **LOW → fixed** — `executeBatch` didn't enforce the 20-call server cap;
  `>20` now rejects early with a VALIDATION error instead of a
  wholesale 400.

## Remediation round 2 (re-review of the delta)

**Medium → fixed** — `batchQuotes` consumed `executeTools` directly and
bypassed the new `toolError` gate: a `{success:true, toolError}` quote
chunk parsed as an empty `Map` → quote sections showed "loaded, zero
quotes" and every PnL column went silently null. `batchQuotes` now throws
on `toolError`, and the two hand-rolled methods (`getAccounts`,
`getPnlTradeHistory`) got the same gate — the check is now universal
across all `executeTool`/`executeTools` consumers in this client.

**Low → noted** — `patchAccount` resolves the first `accountNumber` match
(`findIndex`); a duplicate `account_number` in `get_accounts` would
mis-patch. Practically unreachable with RH broker data; documented.

**Verified clean in the delta** — `BatchResponse` narrowing covers all
envelope shapes; `PromiseSettledResult<never>` tuple fallback types
correctly; `tool` cross-check is false-rejection-free (BE stamps `tool`
on every item including failures); `noUncheckedIndexedAccess` is off and
a runtime-null slot is still caught by the slot try/catch.

## Flagged follow-ups (out of scope for #813)

- `equity-price.service.ts` (`fetchPrices`) issues one unchunked
  `executeTool('get_equity_quotes', …)` — >20 symbols silently loses
  closes and bypasses batch transport.
- `allocation-data.service.ts` still fans out on parallel single
  `executeTool` calls (positions ×2, quotes ×2, fills ×3) — batch
  candidate, inherits the timeout/toolError fixes via the shared client.
- Shared-contract extraction of `ObservationBatchCall`/`Outcome`/
  `MAX_BATCH_CALLS` into `shared/robinhood-mcp-contracts.ts` (touches BE
  files; coordinates with #809's shipped surface).
- `ToolExecutionFailure` lacks a `tool` field in the shared contract
  although the BE stamps it at runtime — wire/type drift worth closing
  in the same shared-contracts pass.

## Test results (final)

- `robinhood-mcp-observation.service.spec.ts` — pass; added:
  session-failure envelope surfaces server error/category, malformed
  `{success:false}` → generic error, `executeTools([])` early-return (no
  HTTP), `HTTP_TIMEOUT_TOKEN === 90_000` pin.
- `robinhood-mcp-client.service.spec.ts` — pass; added: tool-stamp
  mismatch rejects only that slot, `toolError` rejects its slot, >20
  specs reject without a request; `mockBatchResolve` now echoes each
  call's `tool` to mirror the wire contract.
- `portfolio-dashboard.store.spec.ts` + `.selectors.spec.ts` — pass
  (unchanged behavior contract: per-section errors, transport-failure
  grouping).
- **115/115 pass** across the four suites; `tsc --noEmit` clean on both
  `tsconfig.app.json` and `tsconfig.spec.json`. No FE lint is configured
  in this repo.

## Verdict

**PASS** — two rounds, converged: every in-scope finding remediated and
re-verified; the all-or-nothing quote behavior is verified
behavior-preserving; follow-ups flagged for the Thread backlog rather
than armored in place.
