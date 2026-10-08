**Topic:** Portfolio Dashboard  
**Topic Slug:** portfolio-dashboard  
**Thread:** Portfolio Dashboard — Update Stop Loss  
**Thread Slug:** update-stop-loss  
**Issue:** #884  
**Thread Parent:** #829  
**Topic Parent:** #219  
**Task:** #885  
**Domain:** PORTFOLIO  
**Type:** Code Review  
**Status:** Complete  
**Created:** 2026-10-07  
**Last Updated:** 2026-10-07  

## Summary

Task #885 establishes the order-parameter contract the Update Stop Loss feature builds on: `BrokerOrder` now carries verbatim `timeInForce`/`marketHours` (parsed by `normalizeOrder`), the canonical `EquityTimeInForce`/`EquityMarketHours` unions are exported from `order-ticket.types.ts`, the stop-loss ticket builders accept a `StopOrderParams` options object, and a new `buildStopLossUpdateTicket` emits the `stop_loss_update` sourceRef carrying the replaced order's id.

Three review axes ran in parallel — Standards, Spec, Thermo-nuclear — followed by an in-loop fix pass. The one major finding (no shared string→union narrowing helper) was fixed in this task. Remaining findings are minor/nit or deferred with justification.

## Findings by Severity

### Major

| # | Finding | Status |
|---|---------|--------|
| 1 | **No shared string→union narrowing helper** — consumers must narrow `BrokerOrder.timeInForce: string` → `EquityTimeInForce`, and the repo already has two divergent hand-rolled coercions (`order.component.ts:693` silently maps `fok`/`ioc`/anything → `'gtc'`; `order-ticket.component.ts:338` stuffs a raw `string` into the union via `as EquityOrderTicket`). A third lossy coercion was guaranteed in the prefill task. | **Fixed** — Added `toEquityTimeInForce` / `toEquityMarketHours` to `broker-order.util.ts`: canonical values pass through, unrecognized/absent values return `undefined` so the caller picks the default (never a silent `'gtc'` upgrade). 6 unit tests cover pass-through and non-union values. The pre-existing divergent coercions are deferred to their consumer tasks (#886/#888). |

### Minor

| # | Finding | Status |
|---|---------|--------|
| 2 | **`stop_loss_update` sourceRef invisible to `=== 'stop_loss'` predicates** (`order-ticket.component.ts:207, 230, 533, 684`). | **Answered** — Documented the invariant on `buildStopLossUpdateTicket`: update tickets are submit-and-discard via `updateEquityStopOrder`, never staged into the order-ticket pipeline, so those predicates intentionally do not match. If a future task stages them, this must be revisited. |
| 3 | **`BrokerOrder`/`BrokerOrderSnapshot` are parallel normalized-order shapes** with parallel parsers (`normalizeOrder` vs `normalizeToBrokerOrderSnapshot`) — the same field pair is now maintained twice. | **Deferred** — Pre-existing duplication across the core/client and feature/util layers; consolidating the shapes is beyond this task's contract scope. |
| 4 | **`buildStopLossUpdateTicket` has zero callers** (speculative generality). | **Justified** — Its consumer is task #887/#888 in this same Blueprint; the builder is the contract #885 was asked to establish. |

### Nits

| # | Finding | Status |
|---|---------|--------|
| 5 | `buildStopLossTicketBase` inlined `{ type: string; id: string }` for `sourceRef`. | **Fixed** — Now uses the exported `OrderTicketSourceRef`. |
| 6 | `buildStopLossTicket` (entry variant) params threading was untested. | **Fixed** — Added a typed `EquityOrderTicket` entry fixture + threading test. |
| 7 | `order-ticket.component.ts:122-123` keeps inline `signal<'gfd'\|'gtc'>` / market-hours unions instead of the new aliases. | **Deferred to #886** — that task touches the same file and will adopt the aliases when wiring `model()` inputs. |
| 8 | IMPL doc drift — `timeInForce?: string \| null` (code emits `undefined`), §3 said "parameters" where code takes one options object, and §6 said the dialog builds via `buildPositionStopLossTicket` (which cannot emit `stop_loss_update`). | **Fixed** — §1, §3, and §6 updated to match the as-built contract, including `toEquityTimeInForce`/`toEquityMarketHours` in the prefill recipe. |

## Axis Summaries

**Standards** — No hard violations. `time_in_force`/`market_hours` verified against every parser in the repo (`broker-order.util.ts`, `order-execution.service.ts`, `functions/.../broker-order-normalizer.ts`) and RH probe docs; the `typeof === 'string'` narrowing is stricter than the neighboring `as` casts and matches the `legs`/`executions` undefined-when-absent convention. Judgement calls covered above.

**Spec** — Every acceptance criterion met: `BrokerOrder` fields parsed verbatim, builders accept/default TIF + market hours, `stop_loss_update` sourceRef carries the replaced order id, canonical unions preserved and exported, both existing call sites unaffected (no positional `now` args). No scope creep.

**Thermo-nuclear** — Key trace verified live: `OrderExecutionService.buildReviewArgs` forwards `time_in_force`/`market_hours` to both `review_equity_order` and `place_equity_order` — the params reach the broker, not dead code. Alias placement (canonical unions on the ticket side, verbatim strings on the mcp side) confirmed correct layering. Approval bar met after finding 1 was fixed.

## Test Results

- Focused suites (`stop-loss-ticket.util`, `broker-order.util`, `robinhood-mcp-client.service`): **106 tests pass**.
- Related suites (stop-loss-dialog, order-ticket): 45 tests pass.
- `ng build` (development): clean.
- Full suite: 3068 pass, **3 failures in 2 suites unrelated to this task** — `screenshot-capture-contracts.spec.ts` (`PositionType` values) and `st-anchored-vwap.engine.spec.ts` (history-window tests). Both track the user's in-flight edits in other threads (Topics #746/#261); nothing in this diff touches those files.

## Verdict

**PASS** — one major finding fixed in-loop; all remaining findings are minor/nit or deferred with justification recorded above.
