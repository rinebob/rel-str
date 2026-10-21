**Topic:** ST Firestore Reorg  
**Topic Slug:** st-firestore-reorg  
**Thread:** Data Plane Consolidation  
**Thread Slug:** data-plane-consolidation  
**Issue:** #996  
**Thread Parent:** #985  
**Topic Parent:** #984  
**Task:** #1015  
**Domain:** FE  
**Type:** CODE-REVIEW  
**Status:** Complete  
**Created:** 2026-10-27  
**Last Updated:** 2026-10-27  

# CODE REVIEW — #1015 order-ticket.service → st-order-tickets

Three axes (Standards, Spec, Thermo-nuclear) run in parallel sub-agents against
the uncommitted task diff. All critical/major findings were remediated in this
round and re-verified by test; minors are documented below.

## Verdict: PASS — two rounds: R1 remediated 5 majors across three axes;
R2 re-attacked the post-remediation diff and found 4 more (2 MEDIUM +
2 LOW, all fixed). Re-verified 357/357 affected specs + clean tsc.

## Scope

- New: `order-ticket-st-mapper.ts` (+spec) — the OrderTicket ↔ StOrderTicket
  boundary seam (`toStOrderTicket`, `toStTicketPatch`, `fromStOrderTicket`,
  `stDocId`); `order-ticket.service.spec.ts` (new)
- `order-ticket.service.ts` — re-pointed to `st-order-tickets`; hydration via
  `state not-in ['filled']`; `deleteField()` sentinel passthrough
- `order-ticket.types.ts` — `CANCEL_PENDING`/`EXPIRED` statuses, `PROGRAM`
  source, `signalContext.signalId`, narrowed `OrderTicketPatch`,
  `TERMINAL_TICKET_STATUSES`/`REQUEUEABLE_TICKET_STATUSES`
- Cancel/expired surfacing: order queue ("Cancelling"/"Expired" groups + SCSS),
  ticket detail (pending indicator, gated Modify/Cancel, stop-loss pending
  flag), gallery card, ticket dialog, option-order guards
- Reconcile: `rhStateToTerminalStatus` maps `expired`; RH-merge preserves local
  `CANCEL_PENDING` until terminal; batch terminal writes carry
  `fillSummary`/`lastError`
- Store: `liv_`-prefix-aware merge; paper send consumes the `liv_` doc and
  repoints to the BE's `pap_{tradeId}` doc
- `shared/st-ids.ts` — `isStTicketId`/`stripStTicketPrefix` helpers
- `Collection.ST_ORDER_INTENTS` removed; pin spec asserts removal

## Standards

**Violations remediated:**
- `as unknown as Record` in the tracking loop — replaced with typed
  `OrderTicketTrackingFields` indexing (§10 checklist).
- `liv_`/`pap_` literals + re-strip regex duplicated the id layout that must
  live in `shared/st-ids.ts` — added `isStTicketId`/`stripStTicketPrefix`
  (§2 shared-constants).
- Dead `case 'cohortId'` — removed (key isn't on `OrderTicketPatch`).
- `nowIso` param misnomer (was passed `terminalAt`) — renamed `writeAtIso`.
- Explicit `updatedAt: undefined` could leave a doc without the audit-required
  stamp — the service's `??=` now overrides the sentinel.
- `OrderTicketPatch` admitted `id`/`sourceRef`, two keys that only exist to hit
  the runtime throw — narrowed via `DistributiveOmit` (loud boundary is now
  also compile-time).
- Status-membership tests repeated in ≥10 files — consolidated
  `TERMINAL_TICKET_STATUSES`/`REQUEUEABLE_TICKET_STATUSES` in
  `order-ticket.types.ts`; rewired `isTerminalRow`, `canRequeue`, `REMOVABLE`,
  `onRequeueTicket`, and the gallery requeue finder.
- Triplicated "Cancellation pending" indicator — extracted to a shared
  `ng-template`.
- Contract baseline verified: `collection`/`doc` segment counts, dotted
  `terms.*` paths, and `deleteField()` sentinels all match the modular SDK and
  repo conventions; the new service spec asserts collection/doc/where/batch
  args.

## Spec

**Acceptance criteria:**
- [x] CRUD + hydration reads new collection + fields (mode, origin,
  brokerOrderId, fillSummary) — MET
- [x] Migrated docs render alongside new-schema tickets — MET (mapper round-trip
  table; `migratedFrom` fixture; `signalContext.signalId` preserved for #1005
  dedupe)
- [x] cancel_pending surfaced in UI — MET ("Cancelling" group, detail
  indicator, dead Modify/Cancel gated, reconcile drives terminal)
- TEST doc: hydration filters, cancel_pending handling, paper-mode reads,
  path-constant assertions, ticket-state rendering — all MET. `lastError`
  surfacing upgraded to MET: error `code` now renders beneath the message and
  `filledQuantity` renders in the Fill row.

**Majors found + remediated:**
1. `sendTicketToPaper` patched `mode:'paper'` onto `liv_` docs — broke the
   `{liv|pap}_` prefix invariant (fails the #1002 audit hard). Also duplicated
   the BE's own `pap_{tradeId}` lifecycle doc. → The staged `liv_` doc is now
   **consumed**: deleted after the callable, local ticket repointed to
   `pap_{res.equityTradeId}`; `status:PAPER` patches throw at the mapper.
2. Terminal `pap_` docs hydrated as live tickets — a cancelled paper doc became
   a requeueable CANCELLED row → zombie `state:'staged'` on a mode-paper doc.
   → `mode:'paper'` hydrates to `PAPER` unconditionally.
3. `batchUpdateTerminalStatus` wrote no `fillSummary`/`lastError` — filled and
   failed docs failed the canonical audit, and a stale `brokerOrderId` let
   reconcile re-kill a requeued ticket. → Batch carries RH fill/error data;
   `status:STAGED` patches strip all terminal/broker artifacts.
4. Reconcile filtered `source === SIGNAL_PIPELINE` — a management ticket in
   `CANCEL_PENDING` could never reach terminal. → Reconcile now gates on
   `result.orderId` only.
5. Hydrated management tickets lost `sourceRef` entirely — `protectedEntry`,
   `isStopLossTicket`, `isFractionalCloseTicket` all broke. → `sourceRef`
   reconstructed as `{type:'management', id:positionGroupId}` (the id
   round-trips); `isStopLossTicket` additionally falls back to
   `orderType==='stop_loss'`; `protectedEntry` normalizes the lookup across
   the `liv_` boundary.

**Deferred:**
- `fractional_close`/`position_close`/`broker_position` sourceRef *kinds* are
  unrecoverable on hydrated docs — the canonical model collapses sourceRef to
  `positionGroupId`. Pre-existing gap (the #1003 migration made the same
  collapse); needs a contract-level field if the distinction matters on
  reloaded tickets. Flagged for blueprint-level follow-up, not this task.
- `isStopLossSubmitted` never receives `CANCEL_PENDING` (RH-derived rows can't
  carry our local marker) — dead branch removed; pending is the local
  `stopLossCancelPending` signal (now reset on selection change and gated on
  the RH stop still existing).

## Thermo-nuclear

**Findings remediated:** majors 1–5 above, plus `result.state` now prefers
`tracking.lastSeenState` (canonical lifecycle state is not an RH vocabulary),
and the `stopLossCancelPending` signal can no longer leak across selections.

**Judgement calls / notes kept:**
- `order-ticket.component.ts` ~1050 lines — decompose (stop-loss section is
  the obvious split); deferred, pre-existing size.
- `order-ticket-st-mapper.ts` ~400 lines — over the 300 target, below the
  strong-smell line; the flat per-key switch is intentionally boring.
- `state not-in` silently excludes docs missing `state` — fail-closed and now
  documented in the service; the #1002 audit is the surfacing mechanism.
- `toNumber` drops unparseable numerics rather than throwing — user-edit
  traffic shouldn't 500; divergence risk noted.

**What held up:** throw-on-unmapped-key loudness, `updateTicketAndWait` →
`paperSignalOrder` ordering, idempotent `create()` doc-id strategy,
index coverage (`userId+state`), no `ST_ORDER_INTENTS` stragglers,
behavior-level specs.

## Round 2 (post-remediation re-review)

Focused re-attack on the R1-remediated code paths — mapper, service
terminal writes, store reconcile/consume, component computeds, queue
predicates. Four findings, all fixed:

| # | Severity | Finding | Fix |
|---|---|---|---|
| R2-1 | MEDIUM | `fillSummary` written **without `filledAt`** on both paths — `StTicketFillSummary` requires it (BE `markFilled` stamps `filledAt`/`terminalAt` from it). Service param was an inline `{averagePrice, filledQty}` so tsc couldn't catch it. | Service param retyped to `StTicketFillSummary` (compile-required); store emits `filledAt: terminalAt` (BE parity); mapper `result` patch stamps `filledAt: writeAtIso`. |
| R2-2 | MEDIUM | `averagePrice: Number(rhOrder.price ?? 0)` — RH market fills report `price: null`, real prices live in `executions[]` → `averagePrice: 0` on the common case. | New `rhOrderFillSummary()` in broker-order.util — weighted-average over `executions[]`, order-price fallback, null only when no usable quantity (a 0-price is a visible gap; a missing field is silent schema drift). 3 specs. |
| R2-3 | LOW | `isTerminalRow` checked `REQUEUEABLE_TICKET_STATUSES` — name lied about the set (FILLED is terminal but not requeueable). | Renamed `isRequeueableRow` (component + template + spec). |
| R2-4 | LOW | `fromStOrderTicket`: a schema-drifted `state` (BE adds a state the FE predates) hydrated `status: undefined` — silently invisible. | `?? OrderTicketStatus.FAILED` — terminal, visible, requeueable (consistent with the `ORIGIN_TO_SOURCE ?? MANUAL` fallback). |

**Round 3 delta-check**: re-reviewed only the R2 changes (helper,
filledAt plumbing, fallback, rename) — no new findings. Converged.

**Accepted, not fixed:**
- `rhOrderFillSummary` returns null when the RH snapshot carries no
  usable quantity — the filled doc then lacks `fillSummary` and the
  canonical audit surfaces it (a malformed-snapshot signal is louder
  than a fabricated zero).
- `sendTicketToPaper` trusts `res.equityTradeId` — required non-null on
  `PaperSignalOrderResponse` (paper-trading-contracts.ts:490), so the
  `stTicketId` throw path is unreachable on a conformant callable.

## Test results

- Full suite green: **252 suites / 4,240 tests** (pre-remediation baseline).
- Affected-scope re-run after R1: mapper/service/store/queue/
  component/dialog/card specs — **813 tests, all green**; `tsc` clean.
- R2 re-verification: mapper/service/store/queue/component/broker-order/
  page specs — **357 tests, all green**; `tsc` clean (project-wide).
- `st-path-cutover-1014.spec.ts` — 4/4 (ST_ORDER_INTENTS removed from
  `Collection`; legacy-path grep allowlist intact).

## Ship notes

- `order-queue.component.scss` also contains the user's `vl.state-block` mixin
  refactor — hunk-level staging needed, or ship both deliberately.
- `order.component.scss` is pure user WIP (mixin refactor) — NOT part of this
  task; leave unstaged.
- Unrelated WIP present in the tree: analysis/scanner/chart-review,
  `firebase-admin-init.ts`, `robinhood-mcp-client.service.*`,
  `functions/scripts/score-symbols-tmp.ts` — exclude all of it.
