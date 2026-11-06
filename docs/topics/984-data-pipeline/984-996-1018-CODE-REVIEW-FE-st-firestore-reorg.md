**Topic:** ST Firestore Reorg  
**Topic Slug:** st-firestore-reorg  
**Thread:** Data Plane Consolidation  
**Thread Slug:** data-plane-consolidation  
**Issue:** #996  
**Thread Parent:** #985  
**Topic Parent:** #984  
**Task:** #1018  
**Domain:** FE  
**Type:** CODE-REVIEW  
**Status:** Complete  
**Created:** 2026-11-05  
**Last Updated:** 2026-11-05  

# Code Review — #1018 FE-IMPL: ticket UX (cancel_pending, fillSummary, lastError)

Scoped diff: 10 files under `src/app/features/savant-trader` — `filledAt` on `OrderTicketResult`, hydration + patch round-trip in the st-mapper, `last_transaction_at` capture on the execution/reconcile seams, Fill rows + timestamp on the ticket detail (main + stop-loss variants), `status-cancel_pending`/`status-expired` badge styles, and error-hint copy gating on `isEditable()`. One unrelated user hunk rides the same template file (bucket `<select>` class normalization — `cf-input` → `dse-select compact`), excluded from review scope.

## Axis results

### Standards — clean after remediation

- **MINOR (fixed)** — `rhStopToTicket` populated `fillPrice`/`filledAt` on active-only stop rows; `o.price` is the limit price and `lastTransactionAt` the last update time, not fill data.
- **MINOR (fixed)** — `.conf-sub` was scoped inside `.confirmation-section` and never reached the stop-loss detail row's timestamp.
- **NIT (fixed)** — `status-*` badge rules were nested under `.ticket-header .ticket-symbol`; the stop-loss header badge had *no* badge styling at all (pre-existing gap). Rules hoisted to top level so both headers share them.
- **NIT (fixed)** — `filledAt` on the `stopLossTicket` computed was display-dead and semantically wrong on an active-only path; removed.
- Verified clean: ISO-string timestamp conventions, `var()` token usage, `date:'short'` consistency with sibling code, spec conventions (`mount`/`signalTicket`/`makeTicket`), no new duplication beyond the file's existing row-pattern level.

### Spec — both ACs met

- **AC1 `cancel_pending` shows pending-cancel state: MET.** Badge text + new `status-cancel_pending` warning style, shared "Cancellation pending…" indicator (both ticket variants), Modify/Cancel suppression + method-level guards, queue "Cancelling" group with warning dot, canonical round-trip via `STATUS_TO_STATE`/`STATE_TO_STATUS`, display-merge precedence (local CANCEL_PENDING outranks broker non-terminal).
- **AC2 `fillSummary` + `lastError` on ticket detail: MET.** Fill conf-row carries qty @ price + timestamp; the stop-loss variant shows its own exit fill; `lastError` renders message + category (`code`); hint chain corrected for non-editable bookkeeping errors.
- Specs assert observable DOM behavior + mapper round-trip, not internals.

### Thermo-nuclear — 1 major, all remediated

- **MAJOR (fixed)** — `rhStopToTicket` fabricated a "Fill" row on orders that cannot have filled (`isActiveStopLoss` excludes all terminal states). A working stop-limit would have rendered `Fill — qty @ $limit · last-update-time`. Fix: both fields dropped on that seam; regression specs assert the row carries no `fillPrice`/`filledAt` and the detail renders no Fill row on a resting stop.
- **MINOR (fixed)** — `parseEquityPlaceResult`/`mapOrderRecord` stamped `filledAt: last_transaction_at` unconditionally; on a confirmed/queued order that's the creation time. Now gated on `state === 'filled'`.
- **MINOR (fixed)** — "Refresh from Broker" fallback hint could render for cancelled/expired tickets where no Refresh button exists; now gated on `isSubmitted()` with a status-neutral fallback.
- **MINOR (fixed)** — `toStTicketPatch` `filledAt` preference hardened from `??` to `||` (catches `''`).
- **Declined (documented):** `date:'short'` on malformed ISO throws `InvalidPipeArgumentError` — all current producers write ISO; the retryable-hint edge on a submitted ticket is unreachable (hydration always sets `retryable:false`); spec timestamp regex couples to en-US `short` output (default test locale).
- **Verified clean:** display-only merge can't reach persistence (every store method re-reads un-merged canonical tickets); reconcile gates `fillSummary` on `terminal === FILLED`; hydrated `filledAt` implies a persisted fill.

## Test results

- Focused post-remediation: 5 suites / 268 tests green (component, page, mapper, execution, store).
- Full suite: **300 suites / 5,222 tests — all green.**
- `tsc -p tsconfig.app.json --noEmit` clean.

## Round 2 — post-remediation axes

All three axes re-ran on the post-r1 state and converged on the same residual finding class: r1 gated `filledAt` but left sibling `fillPrice`/`filledQuantity` fabrication live at three seams, plus one adjacent terminal-state bug.

### Findings — all remediated

- **MAJOR — `mergeWithRhOrder` unconditional `fillPrice`/`filledQuantity`** (`order.component.ts`): a working/resting limit ticket merged `rhOrder.price` (the *limit* price) into `result.fillPrice` → the detail pane rendered `Fill: qty @ $limit` on an unfilled order; `filledQuantity` fell back to the full order `quantity`. The queue already worked around the leak (`anchorFor` gates on FILLED); the detail pane did not. Fixed: both fields gated on `terminal === FILLED`; `cumulativeQuantity` preserved (real partial-fill data). Note: a FILLED limit merge still displays `price` (limit, not weighted average — `executions[]` isn't mapped into the snapshot); acceptable display approximation since canonical `fillSummary` uses `rhOrderFillSummary`.
- **MEDIUM — `parseEquityPlaceResult` stamped `fillPrice: brokerOrder.price` unconditionally** (`order-execution.service.ts`): a `confirmed` place response carried the limit price as a fill. Currently latent (`submitTicket` shrinks `result` to `{orderId, state}`) — gated on `state === 'filled'` anyway.
- **MEDIUM — `stopLossTicket` kept `fillPrice: rhStop.price`** (r1 half-fix): same fabrication, latent (the "Protected by" section doesn't render it). Deleted; `filledQuantity` reduced to `cumulativeQuantity` only.
- **MINOR — `rhStopToTicket` `filledQuantity: ?? o.quantity` fallback** claimed the full order qty as filled on an unrendered field. Dropped for parity.
- **MAJOR (pre-existing, in-seam) — `TERMINAL_STATES` missing `'expired'`** (`broker-order.util.ts`): `rhStateToTerminalStatus` already mapped `expired` → `EXPIRED`, but `isActiveStopLoss`/`restingLimitBuyNotional` treated expired orders as live — an expired stop still "protected" its position, suppressed the stop-placement UI (user could not replace it), emitted an `rh-stop-*` row, and an expired limit buy held notional. Fixed; effects verified across all three consumers.

### New spec pins

- `order.component.spec.ts`: working RH merge → no `fillPrice`/`filledAt`; FILLED merge → `fillPrice`/`filledQuantity`/`filledAt` all carried.
- `broker-order.util.spec.ts`: `isActiveStopLoss` rejects `expired`; `restingLimitBuyNotional` ignores expired orders.

### Declined / carried forward (documented, not folded into #1018)

- `cancel_pending` wedge: a pending ticket whose order vanishes from the (paginated) `get_equity_orders` list never reconciles — needs a single-order probe; separate design question → `/proj triage`.
- `retryable` dropped on `lastError` round-trip: canonical schema has no `retryable` slot — schema decision, not display plumbing.
- `rh-stop-*` synthetic rows can't show cancel-pending (no store entry to mark) — pre-existing.
- `partially_filled_rest_cancelled` loses partial-fill data in reconcile (doc-fidelity only — positions come from RH).
- `submitTicket` drops a synchronous fill's `fillPrice`/`filledAt` (restored by reconcile; "RH authoritative" design).
- `date:'short'` throws on malformed ISO — all producers write ISO.

### Round-2 test results

- 7 touched-area suites / 378 tests green (page, ticket, queue, execution, mapper, store, broker-order util).
- `tsc -p tsconfig.app.json --noEmit` clean.

## Verdict

**PASS** — two converged rounds. R1 remediated the display-surface findings; R2 closed the fill-fabrication class entirely (merge, place-result, stop-synthesis seams) plus the `expired` terminal-state bug. Remaining items are documented tradeoffs or carried to triage.
