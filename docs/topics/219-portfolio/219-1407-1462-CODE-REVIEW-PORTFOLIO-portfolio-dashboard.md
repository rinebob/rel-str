**Topic:** Portfolio Dashboard  
**Topic Slug:** portfolio  
**Thread:** Load Architecture & Order Surfacing  
**Thread Slug:** load-architecture-order-surfacing  
**Issue:** #1407  
**Thread Parent:** #1403  
**Topic Parent:** #219  
**Task:** #1462  
**Domain:** PORTFOLIO  
**Type:** CODE-REVIEW  
**Status:** Complete  
**Created:** 2026-11-12  
**Last Updated:** 2026-11-12  

# Code Review — #1462 Signal-order workspace orders fetch — page-1 truncation

**Verdict: PASS** (single pass — three remediations applied in-cycle, all minor)

## Change summary

`order.component.ts refreshRhOrders` fired a raw single-page
`executeTool('get_equity_orders')` — silently dropping orders past page 1
(`rhStopRows`, `restingLimitBuyNotional`, `mergeWithRhOrder`/
`reconcileTerminalStatuses`, and `findActiveStopLoss` → duplicate-stop
risk). The fix walks pages via a new verbatim client method:

- `RobinhoodMcpClient.getEquityOrdersRaw(acct)` — shared `walkPages`
  cursor walk (`data.next` → `cursor` verbatim, 25-page cap + warn,
  mid-walk failure rejects) returning un-normalized wire records.
- `broker-order.util` — `parseEquityOrdersList(raw[])` replaces the now-
  dead `parseEquityOrdersResponse`/`extractOrdersFromResponse`; warns on
  id-less orders (#1411 loud-drop doctrine).
- `order-execution.service.ts` — `parseBrokerOrder` field-mapping
  deduped onto `normalizeToBrokerOrderSnapshot` (the canonical
  wire→snapshot normalizer), keeping its stricter `symbol`/`state`
  presence gate.
- Audit doc — #1462 residual marked resolved; new positions-pagination
  residual recorded (→ #1474).

## Deliberate spec deviation — verified necessary, not gratuitous

The issue's fix direction said "route through `getEquityOrders`". The
implementation added a verbatim variant instead because the typed
`BrokerOrder` drops `trigger`, `fees`, `dollar_based_amount`,
`last_transaction_at`, and `placed_agent`. The Spec axis verified this
and found the deviation *stronger* than claimed: `parseOrderState` maps
`expired`/`canceled` → `'unknown'`, which `rhStateToTerminalStatus`
needs verbatim — the typed route would have resurrected expired stops
as "active" and re-enabled duplicate-stop placement. `isActiveStopLoss`
keys on `trigger === 'stop'`; `reconcileTerminalStatuses` uses
`lastTransactionAt`.

## Axis summaries

### Standards — findings (1 hard pre-existing, rest judgement calls)

- **Pre-existing breach, deepened (major, deferred):**
  `robinhood-mcp-client.service.ts` is now 1199 lines — over the
  guidelines' 1k cap (~1170 before this diff). Not created by this task
  and consistent with prior reviews' handling, but the next change will
  cross 1200 — a module split belongs on the backlog.
- Judgement calls: spec-pair shape duplication (justified — verbatim vs
  normalized is a real distinction); `as unknown as` mock cast
  (suite-conventional); leaky console spy (fixed — `mockRestore` added);
  audit-doc `Last Updated` stale (fixed → 2026-11-12);
  `order.component.ts` at 727 lines (pre-existing size smell, +12).
- Contract check PASS: `{account_number}` args, verbatim `next`→`cursor`,
  mid-walk reject — identical semantics to `getEquityOrders`/
  `getOptionInstruments` through shared `walkPages`.

### Spec — PASS

- Defect fixed exactly where named; "do not re-roll a third loop"
  honored (reuses `walkPages`, no new loop).
- All four downstream consumers verified to still see verbatim
  `BrokerOrderSnapshot`s: `rhStopRows`, `restingLimitBuyNotional`,
  `mergeWithRhOrder`/`reconcileTerminalStatuses`, `findActiveStopLoss`.
- No remaining single-page order fetch in the workspace; the
  cancel-confirmation poll uses single-order `{ orderId }` lookup —
  pagination-irrelevant.
- Scope-creep review: id-less warn justified (unkeyed order = invisible
  order); audit annotations accurate; dead-code deletion verified
  zero-referenced.

### Thermo-nuclear — APPROVE

- Right seam; the raw variant is justified, not drift. `BrokerOrder`/
  `BrokerOrderSnapshot` unification is a real refactor (≈6 consumers,
  string→number migration) previously deferred — not this task.
- `Record<string,unknown>[]` passthrough is safe: sole consumer is the
  same boundary type every client parser consumes; `parseSpecResult`
  still gates `toolError`.
- Tests hit the real transport boundary (cursor walk, verbatim
  passthrough, mid-walk reject); no internals-coupled or no-assert
  tests.

## In-cycle remediations applied

| Finding | Fix |
|---|---|
| `equityOrdersRawSpec` hand-built `tool`/`args` instead of delegating | Args now via `equityOrdersArgs` — file's own convention |
| `parseBrokerOrder` field-for-field duplicate of `normalizeToBrokerOrderSnapshot` (deferred twice before) | Deduped onto the canonical normalizer; strict gate preserved (`symbol`/`state` must be wire strings — verified exact-equivalent, not `!truthy`) |
| Leaky `console.error` spy in component spec | `mockRestore()` added |
| Audit-doc `Last Updated` stale | → 2026-11-12 |

## Residuals (all filed, none blocking)

- **#1474 — Position feeds may page-truncate** — `get_equity_positions`/
  `get_option_positions` accept `cursor` (same contract); both
  `portfolio.service.ts` (`brokerPositions`) and the dashboard position
  specs are single-page. Unverified whether the endpoint emits `next`;
  the task covers probing first. Found during the #1462 re-audit.
- Client service >1k lines — pre-existing; module split is a backlog
  tech-debt decision, not a review-cycle fix.
- `BrokerOrder`/`BrokerOrderSnapshot` unification — medium refactor,
  deferred since `219-884-885-CODE-REVIEW` row 3.

## Test results

- Full suite: **308/308 suites, 5491/5491 tests pass**.
- Touched suites post-remediation: 4/4 suites, 284/284 tests
  (`order-execution`, `broker-order.util`, `order.component`,
  `robinhood-mcp-client`).
- `tsc --noEmit` clean on `tsconfig.app.json` and `tsconfig.spec.json`.
- New specs: 3 client (walk / verbatim passthrough / mid-walk reject),
  2 util, 3 component (routing, stop-past-page-1 protects, failure
  path). The `parseBrokerOrder` dedup is covered by the existing
  order-execution suite (unchanged externally observable semantics).

## Round 2 — verification pass (post-bookkeeping)

Re-walked the diff fresh after gate bookkeeping; verified the round-1
remediation claims hold and probed the seams the axes flagged:

- **Cursor injection verified** — `walkPages` spreads `cursor` into
  `spec.args` per page (`args: { ...spec.args, ...(cursor ? {cursor}:{}) }`),
  so the raw spec's static args record is correct; cursor pass-back is
  spec-covered.
- **`toolError` verified** — `walkPages` routes through `parseSpecResult`,
  which throws on envelope-level `toolError` even when `result.success`:
  the old silent-empty-map path is closed structurally, not by the
  component.
- **`mcpService` injection is not dead** — still used by `reauthenticate()`.
- **`parseBrokerOrder` dedup equivalence verified** — strict `symbol`/
  `state` string gate retained; `id` gate now lives inside
  `normalizeToBrokerOrderSnapshot` (identical semantics).
- **`extractList` entry typing** — casts wire arrays without object-guards;
  identical exposure pre-change, wire `results` arrays are objects —
  no new finding (scope discipline).
- **`services/types.ts` diff is foreign** — signal-history doc comments,
  unrelated WIP; excluded from this task's surface.

### Round-2 nits fixed

- `err.mockRestore()` moved into `finally` — a throwing expect previously
  leaked the `console.error` spy into the rest of the suite.
- Audit doc residual bullet now names **#1474** (filed between passes).

### Round-2 verdict

**PASS — converged.** No new majors or minors; both nits were hygiene
fixes. Touched suites re-verified: 4/4, 284/284 green.
