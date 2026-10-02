**Topic:** Signal Pipeline Maintenance  
**Topic Slug:** signal-pipeline-maint  
**Thread:** Misc fixes  
**Thread Slug:** misc-fixes  
**Issue:** #438  
**Thread Parent:** #434  
**Topic Parent:** #433  
**Task:** #707, #709, #717, #719, #723 (Batch A)  
**Domain:** SIGNAL-REVIEW  
**Type:** CODE-REVIEW  
**Status:** Complete  
**Created:** 2026-09-30  
**Last Updated:** 2026-09-30  

# Code Review — Batch A (5 maintenance tasks, one cycle)

## Scope

| Task | Change | Files |
|---|---|---|
| #717 | Requeue of a terminal ticket (CANCELLED **or FAILED**) mints a fresh `refId` (RH burns `ref_id` at terminal state → 409); same fix applied to `onModify`'s cancel→revert path; persist is awaited before the ticket becomes actionable | `pages/signal-order/order.component.ts`, `components/order-ticket/order-ticket.component.{ts,html}`, `stores/order-ticket.store.ts` (`updateTicketAndWait`), `services/order-ticket.types.ts` (comment) |
| #719 | Removing a queue ticket clears its accepted occurrence decision so the signal-review Accept toggle un-checks; legacy hyphen `decisionId`s normalized to canonical doc ids; decisions still referenced by live tickets are protected | `order.component.ts`, `stores/occurrence-decision.store.ts` (`clearDecisionById`), `services/firestore-helpers.ts` (`canonicalOccurrenceDecisionId`), `stores/signal-review.facade.ts` (producer stamps canonical id) |
| #723 | Limit/stop-limit trade cost uses the editable limit price (worst-case committed), falls back to live quote; shared `ticketCostBasisPrice` basis across detail pane, queue rows, and paper-quantity derivation; sell rows label "Proceeds" | `components/order-ticket/order-ticket.component.{ts,html}`, `utils/position-sizing.util.ts`, `order-queue.component.ts` |
| #707 | `restingLimitBuyNotional()` — sum of `price × remaining qty` over non-terminal buy `limit`/`stop_limit` orders (incl. `trigger='stop'` — RH keeps the trigger flag post-trigger, so triggered/untriggered are indistinguishable and both count: conservative direction for a guardrail); `availableCash` nets it; header shows the hold | `utils/broker-order.util.ts`, `order.component.{ts,html,scss}` |
| #709 | Checkboxes staged-only; batch bar "Send N to paper" (N = paper-eligible checked only) → sequential `paperSignalOrder$` per ticket (shared eligibility/request util), derived quantity for unedited tickets, transient local SUBMITTING during each callable await, per-ticket error marking, summary snackbar; checked ids prune when a ticket leaves STAGED; FAILED/CANCELLED rows get per-row Requeue + dismiss | `components/order-queue/order-queue.component.{ts,html,scss}`, `order.component.ts`, new `utils/paper-ticket.util.ts` (+spec), `stores/order-ticket.store.ts` (`setTicketStatusLocal`) |

## Verdict: PASS — CONVERGED (5 rounds)

| Axis | Result |
|---|---|
| Standards | Clean — no hard violations; judgement calls addressed |
| Spec | PASS — all five tasks' acceptance criteria verified in code |
| Thermo-nuclear | CONVERGED — 3 CRITICAL/MAJOR fixes verified + 2 residual majors closed in later rounds |
| Tests | **164/164 suites, 2391 tests green** |

## Findings

### Round 1–2 (initial implementation review)

| Sev | Finding | Disposition |
|---|---|---|
| CRITICAL | #719 was a no-op in prod: `buildSignalOrderTickets` stamped `decisionId` as `${runId}-${symbol}-${tf}-${type}` (hyphens) while decision docs are keyed `buildStOccurrenceDecisionId` = `${runId}_${SYMBOL}_${tf}_${type}` — `clearDecisionById` deleted a nonexistent doc | **Fixed** — producer stamps canonical id; `canonicalOccurrenceDecisionId` normalizes legacy ids by suffix-stripping `{symbol}-{tf}-{type}` from the ticket's own ctx (runId hyphens safe — anchored at end); both removed and surviving tickets normalized |
| CRITICAL | #709 batch send would 400 on unedited tickets: staged signal tickets carry `dollarAmount` only — `quantity` materializes only via the detail pane's auto-calc; callable throws `invalid-argument 'no usable quantity'` | **Fixed** — `paperQuantityFor` derives whole shares via `computePositionSize` at the shared cost basis; uncomputable → per-ticket failure + `ticket.error` |
| MAJOR | `removeChecked` emitted any *visible* checked id — a checked ticket going SUBMITTING could be deleted mid-flight | **Fixed** — batch actions derive from `stagedChecked` (checked ∩ currently-visible STAGED) |
| MAJOR | No in-flight marking in the batch loop | **Fixed** — `sendingToPaper` guard + per-iteration re-check |
| MAJOR | Eligibility predicate + request shape duplicated | **Fixed** — extracted `utils/paper-ticket.util.ts` |
| MAJOR | Failed batch tickets carried no persisted error | **Fixed** — `markPaperFailure` writes `ticket.error { message, retryable: true }` |
| MINOR | `restingLimitBuyNotional` excluded `trigger='stop'` buys entirely | **Revised in round 3** — see below |
| MINOR | Sell rows labelled "Cost" | **Fixed** — "Proceeds" |
| NIT | Empty catch discarded the error; duplicate `ctx` helper; duplicate clear calls | **Fixed** |

### Round 3 (fresh diff after unrelated commits landed)

| Sev | Finding | Disposition |
|---|---|---|
| CRITICAL | Ticket stayed STAGED during the `paperSignalOrder$` await — removable or RH-submittable mid-flight → orphaned paper cohort or a live order overwritten to PAPER | **Fixed** — `setTicketStatusLocal(SUBMITTING)` (transient, never persisted) before each callable await in both the batch loop and `onAcceptAsPaper`; failure reverts to STAGED via `markPaperFailure`/`updateTicket` |
| MAJOR | Paper request sent raw `signalContext.decisionId` — legacy hyphen ids defeat backend idempotency/stats | **Fixed** — `toPaperSignalOrderRequest` canonicalizes via `canonicalOccurrenceDecisionId` |
| MAJOR | Checked id silently re-checked if a ticket left and re-entered STAGED | **Fixed** — pruning effect intersects `checkedIds` with `stagedVisible` |
| MAJOR | FAILED tickets dead-ended: no requeue (RH-terminal orders also burn refId); terminal rows had no removal affordance (checkboxes are staged-only) | **Fixed** — Requeue extended to FAILED; per-row dismiss button on terminal rows |
| MAJOR (spec) | #707 excluded all `trigger='stop'` buys — a *triggered* stop-limit is a working limit holding cash, and RH keeps `trigger='stop'` post-trigger (indistinguishable) | **Fixed** — stop-limit shapes now counted (over-reserve = safe direction); specs + comments updated |
| MAJOR (spec) | Queue row $/shares/units used live quote while detail pane used limit price — inconsistent #723 basis | **Fixed** — shared `ticketCostBasisPrice`; detail-pane `costBasisPrice` delegates to it |
| HARD (std) | `paper-ticket.util.ts` redeclared `PaperSignalOrderRequest` | **Fixed** — imports the canonical type from `@paper-trading/contracts` |
| MINOR | Send button counted checked-but-ineligible tickets; no disabled state while sending | **Fixed** — `paperSendCount` filters eligible; `[disabled]="sendingToPaper()"` + "Sending…" label |

### Round 4–5 (fix verification + residuals)

| Sev | Finding | Disposition |
|---|---|---|
| MAJOR | `loadTickets()` wholesale map replace clobbered the transient SUBMITTING — navigating away/back mid-callable returned the ticket to STAGED (removable/submittable) while the callable was still in flight | **Fixed** — rehydrate preserves local SUBMITTING only when the stored doc is still STAGED; server wins past STAGED or when the doc is gone |
| MAJOR | The new dismiss button rendered off *merged* (RH-derived) status — a mid-submit ticket displaying terminal could be deleted while a broker call was in flight → untracked live order | **Fixed** — `onRemoveTickets` gates on the store ticket's status: only STAGED/CANCELLED/FAILED removable; skips emit a snackbar |
| MAJOR | `updateTicket`/`updateTicketAndWait`/`removeTicket` error paths restored the entire captured `tickets` map — clobbering concurrent local changes (e.g. a sibling's transient SUBMITTING) and resurrecting tickets deleted meanwhile | **Fixed** — per-entry restore only, skipped when the entry no longer exists |
| MAJOR | FAILED tickets were `isEditable` → Submit/Retry resubmitted with the burned refId → deterministic 409 loop; only escape was the queue-row Requeue | **Fixed** — `isEditable` is STAGED-only; FAILED renders "Requeue to Staged" (both entry and stop-loss template branches) emitting `requeueRequested` → `onRequeueTicket`; `onSubmit`/`onSubmitStopLossTicket` guarded; `onRetry` removed |
| MAJOR | `onModify` cancels at RH then reverted to STAGED **without** regenerating refId — same burned-refId 409 loop by another door | **Fixed** — revert patch now mints `crypto.randomUUID()` and clears `terminalAt`, via awaited `updateTicketAndWait` so the fresh refId is persisted before the ticket is actionable |
| MINOR | `updateTicketAndWait` swallowed write errors but the caller still selected + toasted "moved to staged" | **Fixed** — returns boolean; `onRequeueTicket` bails on failure. Method is now pessimistic (local patch only after the write lands) — also keeps the terminal ticket non-checkable during the write |
| MINOR | Stale docs/hints: store header method list, "can be retried" hint on FAILED stop-losses, describe tag | **Fixed** |

## Accepted / deferred (documented, not blockers)

- **Cross-session in-flight exposure**: transient SUBMITTING is never persisted, so a second browser session sees STAGED and could act while a paper callable runs. The backend callable validates fields but not ticket status. Single-user app — a server-side `status === 'staged'` precondition would close it cheaply; noted for a future hardening pass.
- **Local-submit revert keeps refId** (submitTicket failure paths): correct for idempotent retry when RH holds a live order; a latent edge exists if RH went terminal while the client saw failure — next submit 409s and the user requeues. Pre-existing design, unchanged.
- **`onAcceptAsPaper` builds the request from the pre-`saveEdits` snapshot**: the backend prefers persisted quantity, so a saveEdits write still in flight could fill the cohort at the pre-edit quantity. The modal confirm round-trip dominates write latency in practice.
- **Requeue has no in-flight guard**: double-click fires two `updateTicketAndWait`s minting different refIds; last-writer-wins keeps local/server consistent — cosmetic.
- **`removeTicket` failure after decision cleared**: a failed delete re-adds the ticket but its decision was already cleared — live ticket referencing a deleted decision (edge-of-edge; the Accept toggle un-checks and re-accept re-stages).
- `order.component.ts` is ~750 lines with 12 injected collaborators — god-page; next substantial feature should decompose (batch paper logic is a natural seam).
- `order-queue.component.ts` ~450 lines — over the 400 guideline; #440 (Batch B) should consider extraction.
- Empty/invalid limit price: cost display falls back to live quote while submit validation fails first — display-only divergence. Accepted.
- Legacy `signalContext` fields missing/case-differing make `canonicalOccurrenceDecisionId` a no-op — deletes nothing rather than deleting wrong; #719 stuck-toggle persists undiagnosed for malformed legacy docs only.
- `ngOnDestroy → setFullscreen(false)` (order.component.ts) is unrelated user work riding a shared file — noted, not reviewed.

## Evidence

- Focused suites (order-queue, order-ticket, order.component, order-ticket.store, occurrence-decision.store, signal-review.facade, broker-order.util, paper-ticket.util): all green across every fix round.
- New spec coverage added this cycle: transient SUBMITTING during callable await, failure revert, second-batch suppression, selection pruning/no-resurrection, eligible-only send count, in-flight disable, FAILED non-editable + requeue emit, onModify fresh-refId, terminal-row dismiss, removal status guard, loadTickets SUBMITTING preservation, per-entry rollback, pessimistic updateTicketAndWait, canonical signalId, limit-price quantity basis.
- Contract verification: `PaperSignalOrderRequest` imported from `shared/paper-trading-contracts.ts:403`; callable quantity rule at `callables.ts:164-174`; decision doc-id contract at `firestore-helpers.ts:50-57`.
- Full suite final run: see "Tests" in verdict table.

## Post-review QA fix (UAT scenario 1)

| Severity | Finding | Disposition |
|---|---|---|
| MAJOR | `acceptSignals` persists one decision doc **per signal**, but `buildSignalOrderTickets` dedups tickets by `symbol+side` — a multi-signal symbol's single ticket carried only the first `decisionId`, so removal cleared 1 of N docs and a surviving sibling kept the Accept toggle checked (UAT repro: SPCX) | **Fixed** — `signalContext.decisionIds` carries every same-side decision id; `onRemoveTickets` clears each unreferenced id; legacy single-`decisionId` tickets fall back. Specs added (facade + component); retest PASS. |

