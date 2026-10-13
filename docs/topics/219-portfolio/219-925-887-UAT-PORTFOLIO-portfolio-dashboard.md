**Topic:** Portfolio Dashboard  
**Topic Slug:** portfolio-dashboard  
**Thread:** Portfolio Dashboard — Update Stop Loss  
**Thread Slug:** update-stop-loss  
**Issue:** #925  
**Thread Parent:** #829  
**Topic Parent:** #219  
**Task:** #887  
**Domain:** PORTFOLIO  
**Type:** UAT  
**Status:** Complete  
**Created:** 2026-10-09  
**Last Updated:** 2026-10-09  

# UAT — Task #887: `updateEquityStopOrder` primitive

## Scope

`OrderExecutionService.updateEquityStopOrder(accountNumber, orderId, ticket)` — the per-order cancel→place primitive that powers Update Stop (#888/#889), Update All Stops (#890), and future Thread #830 trailing stops. No production caller is wired yet, so this UAT verifies the primitive's contract through its spec suite plus build/regression gates. An optional live probe against a real stop is documented for the user's call.

Task acceptance criteria (#887):

- Cancel success → replacement submitted; cancel failure → place never attempted, `phase: 'cancel'`
- Retryable place errors retried up to 3 total attempts reusing the same ticket/`refId`
- Non-retryable place error surfaces immediately; exhausted retries → `phase: 'place'`, `unprotected: true`
- Specs cover call order, retry bound, refId reuse, and both failure phases

## Prerequisites

- Repo: `C:\aa\projects\rel-str`, dependencies installed (`npm install` already run — `node_modules` present).
- Commands run from the repo root in PowerShell or bash.
- No credentials, services, or emulator needed for scenarios 1–13 — everything executes under Jest mocks.
- Optional live probe (scenario 14) requires the user's real Robinhood MCP session and an actual protected equity position.

## Start instructions

```powershell
cd C:\aa\projects\rel-str
# Focused primitive suite:
npx jest src/app/features/savant-trader/services/order-execution.service.spec.ts --coverage=false
# Adjacent touched suites:
npx jest src/app/features/savant-trader/stores/order-ticket.store.spec.ts src/app/core/robinhood-mcp/robinhood-mcp-client.service.spec.ts src/app/features/portfolio-dashboard/components/close-position-dialog/close-position-dialog.component.spec.ts src/app/features/portfolio-dashboard/components/stop-loss-dialog/stop-loss-dialog.component.spec.ts --coverage=false
# Build gate:
npx ng build
```

## Scenarios

Each scenario names the Jest spec(s) that assert it. Run the focused suite and confirm each listed spec reports PASS; `-t "<name>"` runs one spec in isolation.

### 1. Happy path — cancel confirmed, replacement placed

- **Spec:** `describe('updateEquityStopOrder')` — *"cancel confirmed → places the replacement and returns success"*
- **Expected:** cancel tool called first, `get_equity_orders` polled with `{ orderId }` single-order mode, `place_equity_order` called once; result `success: true`; the placed ticket carries the original `refId`.

### 2. Cancel failure — place never attempted

- **Specs:** *"cancel failure → phase 'cancel', no place"*; cancel `isError`/`toolError`/`parsed.isError` envelope specs (three wire channels).
- **Expected:** `phase: 'cancel'`; `place_equity_order` never invoked.

### 3. Explicit `accepted: false` cancel envelope

- **Spec:** *"accepted:false cancel envelope → cancel-phase failure"*
- **Expected:** non-retryable `phase: 'cancel'` failure, no place.

### 4. Terminal cancel messages non-retryable (no livelock)

- **Specs:** *"cannot be cancelled"* (captured 403 text), *"already filled"*, *"not found"* classifications.
- **Expected:** `error.retryable === false`; the caller's retry-whole-update contract cannot spin.

### 5. Async cancel race — fill-adjacent aborts

- **Specs:** `filled` during confirm → non-retryable abort; `partially_filled` abort; `cumulativeQuantity > 0` abort; `executions` present abort; `partially_filled_rest_cancelled` / `cancelled` with absent `cumulative_quantity` → ambiguous abort (`rejected`/`failed`/`voided` exempt).
- **Expected:** `phase: 'cancel'`, `unprotected: false`, `retryable: false`, no place — refresh-first; the replacement ticket's stale quantity never re-places over a shrunken/exited position.

### 6. Cancel accepted but never confirmed

- **Spec:** *"accepted-but-unconfirmed → phase 'place', unprotected: true"*
- **Expected:** after the confirm budget the result is `phase: 'place'`, `unprotected: true`, retryable — reconcile + re-place the retained ticket, never re-cancel.

### 7. Bounded place retry with same refId

- **Spec:** *"retryable place error → up to 3 attempts, same refId"*
- **Expected:** exactly 3 `place_equity_order` calls, identical ticket/`refId` each time, ~500ms backoff; exhausted → `phase: 'place'`, `unprotected: true`.

### 8. Non-retryable place error — single attempt

- **Spec:** *"non-retryable place error → single attempt"*
- **Expected:** one place call; immediate `phase: 'place'` failure.

### 9. `ref_id` 409 conflict — reconcile, don't re-place

- **Spec:** *"ref-id conflict → phase 'place', unprotected: false"*
- **Expected:** a "Reference ID must be unique" response (thrown or envelope) stops retries immediately; `unprotected: false` — the replacement likely registered broker-side.

### 10. Placement response integrity

- **Specs:** success envelope with no order id → `PLACEMENT_UNCONFIRMED`; known order id + unknown/absent state → `PLACEMENT_UNCONFIRMED` (live-denylist); synchronously `filled` → fill-adjacent `phase: 'cancel'` abort; dead state (`rejected`/`cancelled`/…) → `PLACEMENT_DEAD`.
- **Expected:** no phantom `success: true`; dead-with-fills or fill-ambiguous dead → `phase: 'cancel'`, `unprotected: false` refresh-first; clean dead → `phase: 'place'`, `unprotected: true` with the dead order id forwarded for reconciliation.

### 11. Account mismatch guard

- **Spec:** *"accountNumber ≠ ticket.accountNumber → rejected before any broker call"*
- **Expected:** zero tool calls; failure with no `phase` (nothing ran).

### 12. Store recovery contract (adjacent live path)

- **Specs (`order-ticket.store.spec.ts`):** clean `PLACEMENT_DEAD` → STAGED + fresh persisted `refId` + dead orderId recorded; dead-with-fills/ambiguous → keeps burned `refId`; `PLACEMENT_UNCONFIRMED`/409 → keeps `refId` (converging retry).
- **Expected:** store suite green; no wedge, no duplicate risk.

### 13. Regression gate

- **Commands:** the four touched suites above + `npx ng build` + `npx jest src/app/features/portfolio-dashboard --coverage=false`.
- **Expected:** all suites pass; build clean. (Known unrelated failure outside this scope: `shared/screenshot-capture-contracts.spec.ts` PositionType assertion — another thread's in-flight work.)

### 14. OPTIONAL live probe — real cancel + re-place (user's call)

- **Prereq:** dev server (`npm start`), authenticated Robinhood session, one real protected equity position.
- **Steps:** pick an existing protective stop in Open Orders; note its order id, price, qty; trigger `updateEquityStopOrder` (no UI yet — dev console or temporary harness); confirm: old order reaches `cancelled` in RH, replacement appears at the new price with the same `refId`.
- **Unverified wire behaviors this could resolve** (all fail-safe today): whether `order_id` lookup returns terminal orders; whether RH consumes `ref_id` on rejected orders; whether place responses can synchronously report `filled`.
- **Expected / or:** PASS with order ids recorded — or **deferred to #888 QA** where the dialog drives the same flow with a UI.

## Traceability

| AC / checklist item | Scenario |
|---|---|
| Cancel success → replacement submitted; failure → `phase:'cancel'`, no place | 1, 2, 3, 4 |
| Retryable place errors ≤3 attempts, same ticket/`refId` | 7 |
| Non-retryable place → immediate; exhausted → `phase:'place'`, `unprotected:true` | 7, 8, 10 |
| Specs cover call order, retry bound, refId reuse, both phases | 1–11 |
| Cancel failure incl. `isError`/`toolError` envelopes → no place | 2 |
| `ref_id` 409 → `unprotected:false`, reconcile | 9 |
| accountNumber mismatch → rejected pre-flight | 11 |
| Focused suite green; `ng build` clean; suite green except known unrelated failure | 13 |
| Optional live check | 14 |

## Regression / smoke checklist

- [ ] `order-ticket.store.spec.ts` — SUBMITTED persist carries in-flight refId (self-heal)
- [ ] `robinhood-mcp-client.service.spec.ts` — `order_id` single-order mode + `partially_filled_rest_cancelled` normalization
- [ ] Both dialogs — `disableClose` pinned during/after submission; post-attempt cancel closes `true`
- [ ] `portfolio-dashboard` dir suite — no collateral (PnL state sets, allocation mappers)

## Results

| # | Scenario | Result | Evidence |
|---|---|---|---|
| 1–12 | Spec-driven contract | PASS | `order-execution.service.spec.ts` 59/59 (includes the `updateEquityStopOrder` describe + envelope/phase coverage); `order-ticket.store.spec.ts` green incl. dead/ambiguous refId split |
| 13 | Regression gates | PASS | 5 touched suites 193/193; `portfolio-dashboard` dir 376/376; `ng build` clean |
| 14 | Live probe — SCHB `6a9b1879` @ 27.38 → 27.28 | PASS | `scripts/verify/samples/portfolio-update-stop-887-1791568677672.json` — cancel landed (`state=cancelled`, cum 0), replacement `6ac92b23` live `confirmed` @ 27.28, qty 3, same-order flow through real service + client |

### Live-probe wire facts learned (2026-10-09, Agentic account)

- `get_equity_orders` `order_id` single-order lookup **does return terminal orders** — old order read back as `cancelled` post-cancel. The confirm poll is sound on the real wire.
- `place_equity_order` returns a synchronous `state: 'unconfirmed'` for a resting stop — inside `LIVE_PLACE_STATES`, correctly accepted.
- Open-order list responses do not echo `ref_id` through `BrokerOrder` (field is absent from the normalization map). Implication: reconcile-by-id via `result.orderId` (which the primitive forwards) — refId matching on the normalized list is impossible today. Recorded as a finding below; not blocking (orderId forwarding covers reconciliation).

### Findings

- **Minor:** `BrokerOrder` drops `ref_id` — if #889/#890 reconciliation ever needs ref-id matching, map it in `normalizeOrder`. Follow-up candidate, not a defect of this task.

