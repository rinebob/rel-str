**Topic:** Portfolio Dashboard  
**Topic Slug:** portfolio-dashboard  
**Thread:** Portfolio Dashboard — Update Stop Loss  
**Thread Slug:** update-stop-loss  
**Issue:** #884  
**Thread Parent:** #829  
**Topic Parent:** #219  
**Task:** #887  
**Domain:** PORTFOLIO  
**Type:** CODE-REVIEW  
**Status:** Complete  
**Created:** 2026-10-08  
**Last Updated:** 2026-10-09  

# Code Review — Task #887: `updateEquityStopOrder` primitive

## Scope

| File | Change |
|---|---|
| `src/app/features/savant-trader/services/order-execution.service.ts` | `UpdateStopResult`, `updateEquityStopOrder`, `delay`, `MAX_PLACE_ATTEMPTS`/`RETRY_DELAY_MS`; review-driven hardening: three-channel tool-error extraction (`toolError`/`parsed`/`redacted`), cancel now checks tool-level errors, non-retryable terminal/identity patterns, account-mismatch guard, ref-id-conflict `unprotected: false` |
| `src/app/features/savant-trader/services/order-execution.service.spec.ts` | `describe('updateEquityStopOrder')` — 11 tests + envelope coverage on `cancelEquityOrder`; `mockTools` dispatcher |

**Diff note:** the `order-execution.service.ts` diff also contains an unrelated in-flight refactor (`cancelOrder(tool,…)` extraction + `cancelOptionOrder`) belonging to another thread. It is behavior-neutral after this review's fix and interacts correctly with the new code; it is excluded from this task's staging plan.

## Axes summary

### Standards — PASS (no criticals/majors on the new code)

AC coverage verified at the spec level; `jest.fn()` convention used for new tests; async tests per AGENTS.md; constants named; file at ~390 lines (under thresholds). Minors: real 500ms waits in retry tests (accepted — fake timers can't flush native `await` here); mid-class static placement; duplicated inline mock (fixed in remediation); `unprotected:false` on ambiguous cancel failure is "believed protected" not verified (documented in the docstring).

### Spec — PASS (all ACs met)

All 8 acceptance criteria met with spec evidence; every IMPL §4 contract point realized (signature, retry bound, delay, success shape, caller contract); every TEST-doc unit bullet has a real assertion. Doc-hygiene nit fixed: IMPL §4's `phase`/`unprotected` wording now matches the optional-fields realization.

### Thermo-nuclear — 1 critical + 3 majors found, ALL fixed in-flight

| # | Severity | Finding | Resolution |
|---|---|---|---|
| C1 | Critical | `cancelOrder` treated a tool-level rejection (`success:true` + `isError`/`toolError` envelope, per `err-cancel-bad-order.json` capture) as success → update would place a **second live stop** | `cancelOrder` now routes through `extractToolError`; both equity and option cancels covered |
| M1 | Major | RH `ref_id` dedupe is a 409 *error* ("Reference ID must be unique."), which classified retryable → burned all 3 attempts → false `unprotected` while the replacement is actually live | Pattern added to non-retryable; `updateEquityStopOrder` detects ref-id conflict → `phase:'place', unprotected:false` + caller doc says reconcile, don't re-place |
| M2 | Major | `extractToolError` missed the `toolError` channel (only carrier when error text parses as JSON, per `robinhood-mcp-contracts.ts:45-47`) | Extended to three channels: `toolError` → `parsed.isError` (top or `data`) → `redacted.isError` |
| M3 | Major | "not found"/"already filled" cancels classified retryable → documented "retry whole update" contract livelocks | Terminal patterns non-retryable; caller contract now conditions cancel-retry on `error.retryable` |

Minors fixed: account-mismatch guard (cancel vs `ticket.accountNumber` divergence could cancel in acct A / place in acct B). Minors deferred (recorded, non-blocking): optional `phase`/`unprotected` instead of a discriminated union (matches IMPL shape; consumers in #888/#890 will drive the contract); flat 500ms backoff without jitter (defensible; RH rate-limit semantics may warrant a follow-up); latent-throw hardening around the loop (unreachable today — `submitEquityOrder` catches internally); `orderType`/`side` guard so the method only accepts stop-sell tickets (name honest via docstring; #830 contract to revisit); PRD wording says #830's engine is "server-side" while this primitive is client-side — docs contradiction to correct in the #830 thread.

## Remediation evidence

New/updated specs (all assertions real, no `as any` fixtures):

- `cancelEquityOrder`: isError-envelope fixture → failure, non-retryable
- `updateEquityStopOrder`: cancel `isError` envelope → `phase:'cancel'`, no place; place `toolError` envelope → `phase:'place'`; ref-id 409 → `phase:'place', unprotected:false`, single attempt; retryable→non-retryable sequence stops at 2; account mismatch → zero tool calls
- Existing 'already filled' cancel spec updated to the corrected non-retryable classification

## Test results

- Focused: `order-execution.service.spec.ts` — **27/27 pass**
- Build: `ng build` clean
- Full suite: **3210/3211** — sole failure `shared/screenshot-capture-contracts.spec.ts` (PositionType enum grew past a stock-only assertion; belongs to another thread's in-flight work, unchanged by #887)

## Verdict

**PASS** — with in-flight remediation. The thermo axis found a real money-safety hole (C1) inherited from the shared cancel path plus three semantics majors (M1–M3); all were fixed during this review and are covered by new specs, including captures-faithful envelope fixtures.

---

## Round 2 — fresh axes on the post-remediation state

### Standards / Spec — no criticals or majors

Spec axis verified all ACs against the remediated code. Minors: TEST doc missing the new edge-case bullets (fixed); shared literal for the ref-id pattern (fixed — `REF_ID_CONFLICT_PATTERN`).

### Thermo-nuclear — 2 majors found, fixed in-flight

| # | Severity | Finding | Resolution |
|---|---|---|---|
| R2-M1 | Major | Pattern list built from imagined messages — the captured 403 reads `"Order cannot be cancelled at this time."` (`mx-can-bid-403-filled`), which matched nothing → defaulted retryable → caller livelock | `'cannot be cancelled'`/`'cannot be canceled'` added, verified against the capture corpus (also `'not enough shares'`, `'no longer available'` from 400 captures) |
| R2-M2 | Major | RH cancel is asynchronous — `{data:{accepted:true}}` is an *ack*, not a terminal state. The old stop could fill in the race and the replacement would be placed onto a changed position | `awaitCancelled` polls `get_equity_orders` (3 × 500ms) until the order lands cancelled-family; `filled`/partial-fill aborts non-retryably; unconfirmed → no place |

Minors taken in-flight: broker-terminal patterns split out of `isRetryableException` (`'not found'` no longer misclassifies transport 404s / "session not found"); `envelopeToolError` mixed-shape message fallback; place-success-without-order-id treated as unconfirmed attempt; account-guard `phase` honesty (absent — no broker phase ran).

## Round 3 — fresh axes on the post-round-2 state

### Standards / Spec — no criticals or majors

Spec: every AC + every IMPL §4 contract point re-verified. Minor: `parsed.isError` channel had no direct spec (added). Standards: `awaitCancelled` fetch-rejection path untested (added); `getEquityOrders` arg assertion added; `rejected`-terminal confirm spec added.

### Thermo-nuclear — 4 majors found, fixed in-flight

| # | Severity | Finding | Resolution |
|---|---|---|---|
| R3-M1 | Major | `awaitCancelled` scanned page 1 of order history — paginated, newest-first; long-lived GTC stops sit deep in history → `find` misses → unconfirmed → caller retries → second cancel on an already-cancelled order → false `unprotected:false` on a bare position | `getEquityOrders`/`equityOrdersSpec` gained `opts.orderId` → `order_id` single-order mode (`dep-eq-orders-id.json` confirms the `{data:{orders:[…]}}` shape); poll now targets the exact order |
| R3-M2 | Major | Post-`accepted` confirm failures reported `phase:'cancel', unprotected:false` — but the cancel is past the point of return; the honest signal is "likely bare, reconcile + re-place", and a caller retrying the whole update hits a terminal reject on the second cancel | Accepted-but-unconfirmed now returns `phase:'place', unprotected:true`, retryable, message directs reconcile → `submitEquityOrder` on the retained ticket (never re-cancel). Fill-adjacent aborts stay `phase:'cancel', unprotected:false` — the position exited/shrank, refresh first |
| R3-M3 | Major | `partially_filled_rest_cancelled` (named in the `mx-can-bid` guide) wasn't in `VALID_STATES` → normalized to `'unknown'` → never confirms → same cascade; and `cancelled`-with-fills was treated as clean → full-quantity replacement oversells | Added to `OrderState` union + `VALID_STATES` + `TERMINAL_ORDER_STATES` + `CANCELLED_STATES` + savant `TERMINAL_STATES`/`rhStateToTerminalStatus`; fill-adjacent abort on `filled`/`partially_filled`/`cumulativeQuantity>0` |
| R3-M4 | Major | `submitEquityOrder` could return `success:true` with `orderId:undefined` on the standalone path → shipped callers (order-ticket store, dialogs) persist a phantom SUBMITTED ticket — uncancellable from the UI | No-order-id success now returns `success:false, retryable:true` (`PLACEMENT_UNCONFIRMED_MESSAGE`); the update loop detects the message → `placementUnconfirmed` → `unprotected:false` |

## Round 3 test results

- Focused: `order-execution.service.spec.ts` — **41/41 pass** (incl. `parsed.isError`, fetch-rejection-continues-polling, order_id-miss, partial-fill aborts, `partially_filled_rest_cancelled` confirm, no-order-id submit failure)
- `robinhood-mcp-client.service.spec.ts` — 64/64 pass (incl. `order_id` arg spec)
- Build: `ng build` clean
- Scoped suite (`savant-trader` + `robinhood-mcp` + `portfolio-dashboard`): **2221/2221 pass**

## Round 4 — fresh axes on the post-round-3 state

### Standards / Spec — no criticals or majors

Spec: every return site enumerated and consistent; docstring contract verified. Standards: `partially_filled_rest_cancelled` consistent across all five state sets; comments accurate; scope discipline satisfied (no over-hardening — every layer maps to a captured wire behavior).

### Thermo-nuclear — 2 majors at the CALLER layer, fixed in-flight

| # | Severity | Finding | Resolution |
|---|---|---|---|
| R4-M1 | Major | `ClosePositionDialogComponent` rebuilt the ticket (fresh `refId`) on every retry — post-M4, a lost-ack placement returns retryable → Retry mints a **second sell order** | `lastTicket` retention added (same pattern as `StopLossDialogComponent`); spec now asserts ticket/refId identity across retry |
| R4-M2 | Major | Manual cancel/modify paths (`order-ticket.component` `onCancel`/`onModify`/`onCancelStopLoss`, dashboard `onCancelOrder`) treat `accepted:true` as terminal → revert-to-STAGED + fresh refId immediately → resubmit while old order is `pending_cancelled` | **Deferred — pre-existing shipped behavior**, bounded by RH completing accepted cancels; proper fix (confirmed-cancel UX) belongs to #889 where the Open Orders update action lands. Recorded as known issue |

Minors taken in-flight: dead-state place response (`rejected`/`failed`/`voided`/`cancelled`/`partially_filled_rest_cancelled` + orderId) now fails non-retryable with `result.orderId` forwarded through the update loop's exhausted return; `partially_filled_rest_cancelled` + absent `cumulative_quantity` aborts fill-adjacent (ambiguous — don't assume zero fills); `PLACEMENT_UNCONFIRMED` keyed on `error.code` not message text; `filledQuantity` no longer falls back to full quantity (over-report); `partially_filled_rest_cancelled` added to `FILL_STATES`/`EXECUTED_ORDER_STATES` so its real fills reach P&L attribution; worst-case duration (~15 min on wedged MCP timeouts) documented in the docstring; retained-ticket docstring now flags that a dead order may have consumed the refId (unverified — hedged wording).

Deferred nits: `toolError: ''` edge; `parseBrokerOrder`/`normalizeToBrokerOrderSnapshot` duplication (pre-existing); all-3-polls-throw and `cancelOptionOrder` coverage; `cancelEquityOrder` standalone "accepted ≠ cancelled" snackbar overclaim (part of R4-M2).

## Round 4 test results

- Focused: `order-execution.service.spec.ts` — **46/46 pass**; close-position-dialog — **17/17 pass**
- Client + PnL + allocation specs: pass

## Round 5 — fresh axes on the post-round-4 state

### Standards / Spec — no criticals or majors

Standards verified all r4 changes present and correct; minors only (state-set duplication nits, stale const docstring, spec-coverage gaps — all closed). Spec verified every AC against the shipped contract; doc-drift minors only.

### Thermo-nuclear — 4 majors, fixed in-flight

| # | Severity | Finding | Resolution |
|---|---|---|---|
| R5-M1 | Major | Dead-state place failure burned the refId — the documented "re-place retained ticket" contract would 409/re-reject forever | `PLACEMENT_DEAD` error code; update loop reports `unprotected:true` + dead `result.orderId` + "re-place with a **fresh** ticket" message |
| R5-M2 | Major | Dead states (`cancelled`, `partially_filled_rest_cancelled`) can carry fills — re-placing the original ticket would oversell the shrunken position | `PLACEMENT_DEAD` with `filledQuantity > 0` → `{ phase:'cancel', unprotected:false }` refresh-first, same class as fill-during-cancel |
| R5-M3 | Major | `OrderTicketStore.submitTicket` reverted failures to STAGED **with the burned refId** → guaranteed 409 wedge; `PLACEMENT_UNCONFIRMED` could hide a live order | Dead-state → revert STAGED with fresh `refId` + dead `orderId` recorded for reconciliation; unconfirmed/conflict → **keep** the refId so a retry converges (fresh refId would duplicate a possibly-live order) |
| R5-M4 | Major | Dialog dismiss (ESC/backdrop) during/after submission → `afterClosed` resolves `undefined` → **no refresh** → stale position → duplicate order on reopen | Both dialogs set `disableClose` while `submitting` and close `true` after any submission attempt — a possibly-registered outcome always refreshes |

Minors taken in-flight: `cancelled`-with-absent-`cumulative_quantity` now aborts fill-adjacent (same ambiguity rule as rest-cancelled — but `rejected`/`failed`/`voided` exempt since they never fill); `executions[]` non-empty aborts; synchronously-`filled` place response inside the update loop → fill-adjacent abort, not success; ref-id-conflict pattern applies to thrown exceptions too (identity error, safe on the throw path); stale `PLACEMENT_UNCONFIRMED_MESSAGE` docstring fixed; `PLACEMENT_*` literals → named consts; state-set duplication cross-referenced; `partially_filled_rest_cancelled` normalization pinned at the client layer (was only covered post-normalization).

### Could-not-verify (probe captures recommended before #888 wires callers)

- Whether `order_id` single-order mode returns **terminal** orders — `dep-eq-orders-id.json` only covers a live `confirmed` order; `dep-opt-orders-13.json` proves a miss returns `{orders:[]}` (fails safe → unconfirmed), but if RH excludes terminal orders every update ends `unprotected:true`.
- Whether RH consumes `ref_id` on a **rejected** order (affects the `PLACEMENT_DEAD` → fresh-ticket contract's exact failure mode — broken either way, wording hedged).
- Whether RH can return `filled`/`partially_filled` synchronously in a `place_equity_order` response.

### Known issues (recorded, deferred)

- **R4-M2** manual cancel/modify treats `accepted:true` as terminal — pre-existing, shipped; proper fix belongs to #889.
- **R5-M3 residual**: a `PLACEMENT_UNCONFIRMED`/409 STAGED ticket whose order is actually live stays wedged-but-safe until reconciliation — the store can't link it without a reconcile-by-refId path (follow-up candidate for #888/#890 consumer work).

## Round 5 test results

- Focused: `order-execution.service.spec.ts` — **51/51 pass** (incl. dead-with-fills abort, sync-filled abort, cancelled-null-cum abort, executions abort, thrown-ref-id-conflict)
- `robinhood-mcp-client.service.spec.ts` — **65/65 pass** (incl. `partially_filled_rest_cancelled` normalization pin)
- `order-ticket.store.spec.ts` — pass (incl. PLACEMENT_DEAD fresh-refId + PLACEMENT_UNCONFIRMED refId-retention specs)
- Build: `ng build` clean

## Round 6 — fresh axes on the post-round-5 state

### Spec — no criticals or majors

All 12 enumerated return paths verified against IMPL §4 with spec coverage mapped. Minors: TEST-doc dialog coverage missing (added — `disableClose` pin + post-attempt `onCancel`→true specs on both dialogs); fill-field asymmetry between cancel-confirm and dead-state split (fixed — `cancelled`/`rest_cancelled` with absent/unparseable fill field now aborts refresh-first on the place side too).

### Standards — 3 majors, fixed in-flight

| # | Severity | Finding | Resolution |
|---|---|---|---|
| R6-S1 | Major | `disableClose` was restored after the call settled — ESC/backdrop on the *success/error* screen still resolved `undefined` → no refresh → stale-view duplicate | `disableClose` now stays `true` permanently once a submission runs; all exits are Cancel/Done which close `true` |
| R6-S2 | Major | Store treated dead-**with-fills** as clean-dead — fresh refId + original-quantity ticket → resubmit oversells the shrunken position | Fills/ambiguous dead keeps the burned refId (retry 409s harmlessly) + "refresh and re-stage" message |
| R6-S3 | Major | `filledQuantity` direct-path read used unverified key `filled_quantity` (appears nowhere in captures) | Prefers verified `cumulative_quantity`, `filled_quantity` demoted to fallback; direct-path spec pins it |

### Thermo — 1 major, fixed in-flight

| # | Severity | Finding | Resolution |
|---|---|---|---|
| R6-T1 | Major | The clean-dead fresh `refId` was minted **in-memory only** — a reload before reconcile restored the persisted burned refId → permanent 409 wedge (and broke `sendTicketToPaper`'s refId doc lookup) | The refId/`result.orderId` mint is now persisted via `ticketService.updateTicket` — same durability rule as the #717 requeue mints; spec asserts the persist call |

Minors taken in-flight: explicit `accepted:false` cancel envelope → cancel-phase failure (absent field still proceeds — the confirm poll is the truth source); place-response state check inverted to a live-denylist — novel/unrecognized states (`'canceled'`, absent state) classify `PLACEMENT_UNCONFIRMED` instead of phantom-dead-or-success; unparseable non-empty `filledQuantity` counts as ambiguous on fill-capable dead states (service + store); non-reentrancy note added to the docstring (concurrent updates on one order can double-place); stale docstring claim about unconditional `unprotected:true` on dead states corrected.

Deferred/declined: recording the dead `orderId` on a fills-dead revert was deliberately NOT done — `reconcileTerminalStatuses` would flip it FAILED, enabling Requeue, which resubmits the stale quantity (oversell). The burned-refId wedge + "re-stage" message is the safer terminal. `'500'`/`'pdt'` substring patterns, `toolError:''` edge, `existing`-snapshot revert basis — pre-existing/bounded, recorded.

### Round 6 test results

- `order-execution.service.spec.ts` — **54/54**; `order-ticket.store.spec.ts` — **40/40**; close-position-dialog **19/19**; stop-loss-dialog **15/15**
- Scoped suite: **128/128** across the four touched suites; `portfolio-dashboard` dir **372/372**
- Build: `ng build` clean

## Round 7 — fresh axes on the post-round-6 state — CLEAN SWEEP

### All three axes: no criticals or majors

- **Spec** — every AC and IMPL §4 contract point re-verified against the shipped code; every enumerated return path covered.
- **Standards** — state sets consistent, docstrings accurate, test conventions met, scope discipline satisfied.
- **Thermo** — PASS recommendation; no new money-safety, idempotency, or recovery-contract findings.

Minors all closed in-flight:

| # | Finding | Resolution |
|---|---|---|
| R7-m1 | Exhausted place retries could drop the last-seen broker `result` (order id of an unrecognized-state order) | `lastResult` forwarded on the exhausted return |
| R7-m2 | SUBMITTED persistence could replay a stale refId if the clean-dead mint's persist silently failed | Successful persist now carries the in-flight `refId` (self-heals) |
| R7-m3 | Empty-string `toolError` masked `parsed`/`redacted` `isError` envelopes | `toolError` only wins when non-empty; falls through otherwise |
| R7-m4 | `FILL_CAPABLE_DEAD_STATES` predicate triple-copied between service and store | Shared const exported from the service; store consumes it |
| R7-m5 | Clean-dead refId persist failure was silent `console.error` | Snackbar now surfaces it — the un-persisted mint would wedge on reload |
| R7-m6 | `awaitCancelled` docstring didn't enumerate `executions`/plain-`cancelled`-null-cum; `classifyError` comment claimed a caller retry contract that doesn't exist | Docstrings corrected |
| R7-m7 | Store spec missing the ambiguous-dead keeps-burned-refId branch | Added |
| R7-m8 | IMPL/TEST doc drift — `accepted:false` branch, live-denylist placement semantics, place-side fill ambiguity, store clean-dead-vs-ambiguous split | §4 wording + TEST edge-case rows updated |

### Round 7 test results

- Four touched suites: **129/129** (`order-execution` 54, `order-ticket.store` 41, close-position-dialog 19, stop-loss-dialog 15)
- Build: `ng build` clean

## Final verdict

**PASS — exit condition met.** Seven rounds; every round's criticals/majors were verified against the wire contract and capture corpus before fixing. Round 7 is a clean sweep on all three axes. Known deferred items are recorded above (R4-M2 manual cancel/modify; the three unverified RH wire behaviors awaiting live probe captures).
