# RH Agent Broker Sync Capability Spike

**Status:** Path A selected for the simplified Phase A bridge; read-only response sampling remains
**Time box:** Initial catalog discovery complete; response-shape and unattended-authentication verification remain
**Review items:** #3–#6 in the 2026-07-16 Thermo review

## Objective

Determine the smallest safe RH Agent order and trade persistence design supported by the actual Robinhood MCP data. Prefer submitting one human-authorized order at a time and synchronizing authoritative Robinhood orders, positions, and trade history over recreating a local brokerage ledger or automatic exception-recovery engine.

The authoritative Phase A product workflow is `RH-AGENT-DIRECT-MCP-EXECUTION-WORKFLOW-2607-01.md`.

## Required outcome

### Decision — Path A is selected for Phase A

The discovered schemas expose the required authoritative resources: order history and lookup, open positions, open tax lots, closed/realizing trade history, realized-P&L summaries, portfolio values, and caller-generated placement idempotency.

```text
persist exact authorized intent and ref_id
→ submit one exact typed MCP order call
→ persist returned broker identity or ambiguous error
→ refresh the complete configured Agentic account
→ run one-minute stop/target monitoring only after unattended authentication is proven
→ upsert authoritative orders, positions, and required history by broker identity
```

Use Robinhood as the execution source of truth. Store only the typed records required for RH Agent history, source-run linkage, UI projection, discrepancy handling, and error recovery.

Exact output fields, history retention, pagination behavior, and unattended cloud authentication have not yet been observed. These are implementation gates, not reasons to expand into a comprehensive local brokerage ledger. If sampling proves a specific required fact cannot be recovered, add only the smallest missing field or behavior.

## Non-goals

- Building a brokerage platform.
- Implementing tax-lot accounting.
- Preserving every correction or polling event.
- Adding a webhook without evidence that polling and refresh are insufficient.
- Reconstructing every broker state transition locally.
- Automatically resolving rare partial-fill, replacement, or cancellation permutations.
- Batch placement, limit entries, short entries, multi-account routing, or multi-user roles.
- Placing live orders solely for this spike.
- Implementing the production schema during the spike.

## Questions to answer

### MCP tool catalog

Record the actual read-only and mutating tools exposed by the configured Robinhood MCP. Determine whether it can return:

- An order by broker order ID.
- Recent or historical orders.
- Current positions.
- Filled trades or executions.
- Closed positions or trade history.
- Partial-fill details.
- Average fill price, filled quantity, and broker timestamps.
- Rejected, cancelled, failed, voided, and other terminal orders.

Do not assume tool names. Record the discovered names and input schemas.

### Tool-catalog findings — 2026-07-17

The complete inventory, safety classifications, input guide, exercise plan, and use cases are documented in `docs/implementations/RH-AGENT-ROBINHOOD-MCP-DISCOVERY-USAGE-2607-01.md`.

The authenticated Robinhood MCP exposes 49 deterministic tools. Direct clients call an exact tool name with an exact JSON argument object over MCP Streamable HTTP; an LLM is not required in the order or synchronization path.

The following read-only equity tools directly support broker synchronization:

- `get_equity_orders`: list newest-first open and closed orders or look up one `order_id`; filter by state, symbol, lower creation date, placement source, and pagination cursor. Documented states are `new`, `queued`, `confirmed`, `unconfirmed`, `partially_filled`, `filled`, `cancelled`, `rejected`, `failed`, and `voided`.
- `get_equity_positions`: list current open positions with symbol, quantity, average cost, hold breakdowns, and pagination.
- `get_equity_tax_lots`: list open acquisition lots for one symbol with quantity, cost basis, acquisition date, holding period, and pagination.
- `get_pnl_trade_history`: list chronological closed/realizing trades with symbol, side, quantity, price, realized P&L, span/symbol filters, and pagination. Supported spans include `week`, `month`, `3month`, `ytd`, and `all`.
- `get_realized_pnl`: return aggregate realized-P&L buckets, totals, and closing-trade counts over preset or custom windows.
- `get_portfolio`: return account-level portfolio values and buying power.

Use `placed_agent` as provenance when available, not as a management boundary. Synchronization must account for all active orders and every position in the configured Agentic account regardless of origin. Use a safely overlapping `created_at_gte` watermark and broker-identity upserts; do not assume one page is complete.

The mutating `place_equity_order` schema accepts `ref_id`, explicitly documented as an idempotency UUID generated once per logical order and reused on retry. It supports market, limit, stop-market, and stop-limit orders, decimal-string quantities or market dollar amounts where eligible, market-hours selection, and optional specified-lot sells.

Account numbers must be explicitly selected and remain backend secrets. The browser must call a narrow authenticated RH Agent API or callable; it must not receive Robinhood OAuth tokens or arbitrary MCP proxy access.

These definitions justify Path A for the simplified Phase A bridge. Exact output shapes, retention behavior, and suitability for complete historical display still require read-only response sampling.

### Placement response

Capture redacted typed shapes from existing evidence and future legitimate orders for:

- A queued or pending order.
- A filled order.
- A rejected or failed order when naturally available.

Determine:

- Broker order ID field.
- Broker state field and values.
- Estimated quantity type.
- Filled quantity field.
- Average fill price field.
- Submission and fill timestamps.
- Whether an account identifier or URL must be discarded or redacted.

### Later status lookup

Using the existing queued order when possible, determine whether the MCP can locate it later and return its final state and fill data.

No additional live order is required solely for discovery.

### Idempotency

Order placement accepts caller-generated `ref_id`, documented as an idempotency UUID.

Required rule:

```text
generate and persist ref_id before first dispatch
→ submit
→ on an ambiguous response, reconcile get_equity_orders
→ retry only when safe, using the original ref_id
→ never generate a replacement ref_id for the same logical order
```

### Persistence identity

Confirm that the selected model supports:

- Multiple orders for the same symbol on the same day.
- Multiple trades for the same symbol on the same day.
- An additional buy after an earlier fill.
- A later sell order after one or more buys.
- An order whose fills reduce, close, or potentially change the broker-reported position without the app guessing that position effect from order side alone.

Symbol, date, timeframe, and signal type must be query metadata rather than the sole record identity. Orders are broker instructions, not locally inferred trade episodes; Robinhood-reported positions and executions determine their actual effect.

### Refresh and polling ownership

#### User-triggered refresh

The Angular UI invokes a narrow authenticated backend callable or endpoint. The backend directly calls MCP tools, validates tool-specific response DTOs, follows pagination, redacts sensitive fields, and upserts broker projections. Do not send a natural-language prompt and do not expose a generic `{ tool, arguments }` proxy to the browser.

Recommended sequence:

```text
get_equity_orders(account, created_at_gte=<overlap watermark>)
→ follow every cursor and upsert by broker order UUID
→ get_equity_positions and replace/reconcile the complete account position projection
→ get_pnl_trade_history and follow every cursor when historical monitoring requires it
→ refresh tax lots only for holdings or screens that require them
```

#### Unattended monitoring

Poll unresolved orders and active synthetic-target policies through an authenticated backend path; the browser and localhost bridge cannot be assumed to be running. Phase A uses a one-minute target-evaluation cadence and explicit refresh for ordinary monitoring.

The existing code demonstrates direct MCP SDK calls, but unattended Robinhood OAuth/session behavior remains unproven. Defer all cloud policy work until backend read and token-refresh authentication are exercised successfully.

#### Conservative request policy

Until observed evidence replaces the defaults:

- Allow at most two concurrent read-only calls.
- Fetch cursor pages sequentially.
- Poll unresolved orders no more frequently than once per minute in the initial Phase A workflow.
- Honor `Retry-After`; otherwise use bounded exponential backoff with jitter.
- Use at most five attempts for reads.
- Never blindly retry a financial mutation.

## Minimum Path A persistence

Catalog discovery replaces the earlier proposal for a locally inferred `OPEN | CLOSED` trade lifecycle. Persist a local execution attempt plus broker-synchronized projections. Do not construct a trade episode merely by pairing buy and sell order sides.

### Local execution attempt

Persist before dispatch so retries and source linkage survive process failure:

```text
id: unique order-intent/attempt ID
userId: string
accountRef: secret-safe internal reference
refId: UUID
provenance: SIGNAL_OCCURRENCE | EXTERNAL_ACCOUNT_ACTIVITY | POSITION_POLICY
runId?: string
occurrenceDecisionId?: string
symbol: string
side: buy | sell
orderType: market | limit | stop_market | stop_limit
quantity?: decimal string
dollarAmount?: decimal string
limitPrice?: decimal string
stopPrice?: decimal string
timeInForce: gfd | gtc
marketHours: regular_hours | extended_hours | all_day_hours
status: PREPARED | DISPATCHED | ACKNOWLEDGED | AMBIGUOUS | FAILED
brokerOrderId?: string
error?: typed redacted error
createdAt: string
updatedAt: string
```

`refId` is unique per logical order, persisted before dispatch, and never changed for an ambiguous retry. `accountRef` must not expose the brokerage account number to the browser.

### Broker order projection

Upsert by Robinhood broker order UUID:

```text
id: broker order UUID
executionAttemptId?: string
userId: string
symbol: string
side: string
orderType: string
brokerState: string
requestedQuantity?: decimal string
requestedDollarAmount?: decimal string
filledQuantity?: decimal string
averageFillPrice?: decimal string
submittedAt?: broker timestamp
lastBrokerUpdateAt?: broker timestamp
placementSource?: string
rawShapeVersion: string
createdAt: string
updatedAt: string
```

The exact field names and nullability remain gated by response sampling. The same projection may be corrected during refresh; no append-only polling-event ledger is required.

### Broker position projection

Synchronize the complete open-position snapshot from `get_equity_positions`:

```text
id: stable broker position or instrument identity
userId: string
symbol: string
quantity: decimal string
averageCost?: decimal string
holds?: typed hold breakdown
brokerUpdatedAt?: broker timestamp
lastSyncedAt: string
```

A position absent from a successfully completed, fully paginated snapshot is no longer open. Do not apply that rule after a partial or failed snapshot.

### Broker closed-trade projection

Upsert `get_pnl_trade_history` rows by a stable broker identity discovered from actual output:

```text
id: stable broker trade identity
userId: string
assetClass: string
symbol: string
side: string
quantity: decimal string
price: decimal string
realizedPnl?: decimal string
brokerTimestamp: string
lastSyncedAt: string
```

If the response has no stable row identity, define a collision-resistant canonical identity only after observing all relevant fields. Symbol/date must never be the sole identity.

Open tax lots may be fetched on demand or cached as a replaceable broker projection. RH Agent does not calculate tax lots.

## Data-source rules

- Robinhood broker identity and fill data override signal estimates.
- Signal close is never labeled as an actual fill price.
- Locally calculated whole shares are never labeled as actual fractional quantity.
- Broker decimal strings remain precise; do not route prices or quantities through binary floating point before persistence or submission.
- Raw Claude prose is not a canonical record, and no LLM is required in the direct MCP path.
- Raw local bridge files remain prohibited.
- Typed Firestore broker projections are separate from local diagnostic artifacts.
- Primary projections may be corrected; correction history is not required.
- Account numbers, OAuth tokens, account-specific URLs, and raw unredacted payloads are never stored in client-visible records or logs.
- A complete successful paginated snapshot is required before marking a previously cached position absent.

## Multiple-order example

The chosen identity must preserve all of these independently:

```text
09:35 AAPL BUY  — broker order
11:10 AAPL BUY  — broker order
14:20 AAPL SELL — broker order
15:05 AAPL SELL — broker order
```

The app must not infer from these instructions alone which fill opened, added to, reduced, closed, or changed a position. That interpretation comes from Robinhood-reported executions and positions. The spike does not need to implement automatic lot allocation; it must ensure none of the primary broker records overwrite another record.

## Evidence recorded and remaining

Recorded:

- Complete 49-tool schema catalog and full usage guide.
- Deterministic direct `client.callTool({ name, arguments })` execution model.
- Order lookup, order history filters, documented state enum, and cursor support.
- Open-position, open-lot, closed-trade, realized-P&L, and portfolio capabilities.
- Explicit placement idempotency through `ref_id`.
- Per-call payload limits and conservative request policy.

Remaining:

- Redacted queued, filled, partial-fill, cancelled, and rejected order response shapes as naturally available.
- Exact broker order ID, fill quantity, average price, and timestamp fields.
- Stable identity and asset metadata from `get_pnl_trade_history`.
- Page size, cursor lifetime, retention horizon, and normal-use throttling behavior.
- Local versus unattended cloud OAuth/session behavior for read-only synchronization.
- Whether history provides every field needed by the Trade Management UI.

Do not record session tokens, account numbers, account-specific URLs, or raw unredacted payloads.

## Decision table

| Capability | Evidence | Design consequence |
|---|---|---|
| Order lookup by broker ID | `get_equity_orders(order_id)`; output not yet sampled | Direct reconciliation is schema-supported |
| Recent order history | Paginated `get_equity_orders` with date/source/state/symbol filters | Refresh without a local event ledger |
| Placement-source metadata | `placed_agent` filter/field | Preserve provenance, but manage the complete configured account rather than excluding external activity |
| Documented order states | Includes new, queued, confirmed, unconfirmed, partial, filled, cancelled, rejected, failed, and voided | Preserve broker state; do not collapse pending into filled |
| Positions | Paginated `get_equity_positions` | Authoritative open-position projection |
| Executions/fills | Order description promises fills; exact returned fill shape remains unsampled | Broker-confirmed quantity and price are probable but still gated |
| Open acquisition lots | `get_equity_tax_lots(account, symbol)` | Avoid local lot reconstruction |
| Closed trade history | Paginated `get_pnl_trade_history`, including realized P&L and `all` span | Replace locally inferred trade episodes with broker history |
| Aggregate performance | `get_realized_pnl` | Use broker totals for comparison and reporting |
| Client idempotency key | `place_equity_order.ref_id` UUID | Persist before submission and reuse on retry |
| Direct non-LLM calls | MCP SDK calls exact tools with JSON arguments | Production execution can be deterministic and typed |
| Browser security boundary | OAuth and account identifiers remain backend-only | Expose narrow authenticated app operations, not generic MCP proxying |
| Rate limits | No published request-rate quota; cursor and per-call limits exist | Start with concurrency two, sequential pages, and bounded backoff |
| Cloud read-only MCP access | Direct SDK code exists; unattended OAuth/session behavior unproven | Defer early-morning scheduler until authenticated read test succeeds |

## Acceptance criteria

- [x] Actual relevant MCP tools and input schemas are documented.
- [ ] Queued/pending placement response shape is documented.
- [ ] Later filled-state response shape is documented when available.
- [x] Order, position, open-lot, and closed-history capabilities are known; exact output shapes remain to be sampled.
- [x] Idempotency support is known: `place_equity_order.ref_id`.
- [x] History retention, page size, cursor lifetime, and request-rate quota are explicitly unresolved and included in response discovery.
- [x] Path A is selected for the simplified Phase A bridge; final field mapping awaits read-only samples.
- [x] Minimal identities support multiple same-symbol same-day records through execution-attempt UUID, `ref_id`, and broker UUIDs.
- [x] On-demand refresh ownership is defined as a narrow authenticated backend direct-MCP operation.
- [x] One-minute unattended policy monitoring is deferred until backend OAuth/session and token refresh are proven.
- [ ] Existing Firestore records receive a non-destructive migration decision.
- [x] Items #3–#6 are divided into small implementation commits below.
- [x] No live order was placed solely for the spike.

## Expected implementation plan after the spike

Implement only after read-only response sampling establishes DTOs. The authoritative sequence is maintained in `RH-AGENT-DIRECT-MCP-EXECUTION-WORKFLOW-2607-01.md` and begins with:

1. **Response and authentication proof:** capture redacted order, quote, and position shapes and prove unattended cloud token refresh.
2. **Minimal typed boundary:** add strict parsers, fake fixtures, owner/account authorization, and allowlisted MCP methods.
3. **Single-order identity:** persist exact reviewed terms and one `ref_id` before dispatch.
4. **Human direct placement:** support one whole-share regular-hours market entry from an accepted LONG signal.
5. **Account-wide monitoring:** synchronize every position and relevant active order, derive capacity, and display exceptional broker states without automatic recovery.
6. **Position protection:** add one broker-held stop, manual exits, and the agreed one-minute synthetic-target policy.
7. **Legacy retirement:** remove `EXECUTED` behavior and isolate/disable the Claude bridge without deleting its reference implementation.

Each implementation commit must use fake MCP responses for automated tests. Live execution remains outside automated validation, and no automated test may place, review, or cancel a real order.
