# Code Review — FE: Gallery card + ordering/sink model (#755)

**Topic:** Gallery Order Ticket View  
**Topic Slug:** gallery-view  
**Thread:** Gallery View Page  
**Thread Slug:** gallery-view-page  
**Issue:** #753  
**Thread Parent:** #744  
**Topic Parent:** #743  
**Task:** #755  
**Domain:** FE  
**Type:** CODE-REVIEW  
**Status:** Complete  
**Created:** 2026-10-04  
**Last Updated:** 2026-10-05  

## Re-review — 2026-10-05 (round 4 — GATE PASS)

Scope: the round-3 remediation delta — `warmConfig` busy-key preservation; `onAcceptAsPaper` pessimistic `updateTicketAndWait` before dialog/send (guard flag covering the save await); `tradeCard`/`paperCard` any-status `findCardTickets` recheck inside `withBusy`; `allRejected` moved to `filterGalleryCards` over the full pre-trim set; `loadTickets` local-PAPER-over-STAGED preservation; friendly eligibility snackbar; ~15 new/updated specs.

**Verdict: PASS.** Standards: PASS — all round-3 fixes verified fixed; minors/nits only (see below). Spec: PASS — every #755 acceptance criterion re-verified met with coverage; no regressions. Thermo-nuclear: PASS — all six round-3 fixes verified against real failure paths; no critical/major findings.

**Minors/nits carried to the QA issue (#790, "Findings — review rounds 3/4 residuals"):** `findCardTickets` in-busy/enrich matching uses the trimmed occurrence set (disjoint legacy decisionIds invisible — fix is full-set matching as `removeStagedTickets` does); wholesale `occurrence-decision.store` rollback can resurrect concurrently-cleared entries; `ticketsBySymbol` raw-symbol casing vs uppercased lookup; silent dead-click on the stale-snapshot bail; `stageCardTicket` sizes off an unsorted occurrence's close; double snackbar / unmapped eligibility wording in `onAcceptAsPaper`; `failed|settled`+`allRejected` cards have no gallery Restore path; pre-fix staged tickets can still carry REJECT ids; minute-granular `buildTicketId` overwrite + unchecked `signal-review` staging path; `order-ticket.store.ts` ~500 lines (documented exception); dialog-opens-on-other-page race; `cardOccurrences` cache-miss fallback; `rejectCard` synchronous busy no-op; duplicated `actionContext` computed across facade/service; dead `findStagedCardTicket` export; `?? 100` literals vs `DEFAULT_DOLLAR_AMOUNT`; stale `order.component.ts` header comment; TEST-doc wording drift.

**Test results:** full suite **188 suites / 2807 tests — green**; `tsc --noEmit` clean; `ng build` clean. New round-3/4 coverage: `warmConfig` busy survival, stale-snapshot bail (trade+paper), save-before-send ordering + save-failure abort + re-entry-during-save, `loadTickets` PAPER preservation, full-set `allRejected` under narrowing filter.

---

## Re-review — 2026-10-05 (round 3)

Scope: the round-2 remediation delta — `sendTicketToPaper` source-state guard + revert-before-persist ordering; `GalleryCard.allRejected` + reject-aware trade gate + REJECT-id exclusion from staged `decisionIds`; run-scoped `removeStagedTickets` via canonical matching; reopen-inside-busy; `ensureConfig`; `markPaperFailure` write trimmed; dead injection/`acceptAsPaper` cleanup; `warmConfig` busy-key reset. ~20 spec additions.

### Verdict: FAIL

Standards: **PASS** — all three round-2 majors verified fixed with regression coverage; all claimed minors verified. Spec: **PASS** — all six ACs met. Thermo-nuclear: **FAIL** — two majors, both in remediation-adjacent code paths.

### Findings

**Critical** — none.

**Major:**

1. **`warmConfig` clears `busyCardKeys` while actions are legitimately in flight — re-opens the exact double-send the keys prevent** (`gallery-card-actions.service.ts:109-110`). `warmConfig` runs on every `gallery-view` `ngOnInit`; the service is root-scoped, so a `paperCard` in-flight survives navigation — the user navigates back, the busy set is wiped, a second Paper click passes the guard, `findStagedCardTicket` misses the SUBMITTING ticket, and a second ticket stages → second `paperSignalOrder` call on the same `signalId`. Worse: `buildTicketId` is minute-granular, so the second ticket can carry the **same doc id** — `stageTicketAndWait` overwrites the doc the first callable resolves by `refId`, and the first send's failure-path STAGED+error write lands on the second ticket's doc. Fix: don't clear keys — `withBusy`'s `finally` always releases them (the root-scoped promise outlives the page).
2. **`onAcceptAsPaper` saves edits fire-and-forget before the paper callable — the backend prefers the persisted doc's quantity over the request's** (`order-ticket.component.ts:628` → `saveEdits` → optimistic `updateTicket`; backend `callables.ts:163-174` resolves `ticket.quantity` from `getTicket(refId)` first). If the `saveEdits` write is in flight or fails (silent `updateTicket` rollback), the callable fills the *old* quantity — the confirmed 4-share send executes 10. Same defect class as round-1's persist race; `updateTicketAndWait` exists for exactly this.

**Minor:** `allRejected`/`deriveCardStatus` evaluate the *timeframe-trimmed* `card.occurrences` — a partially-rejected card over-blocks Trade under a narrowing filter (bounded; restores still full-set — decide/document); `tradeCard`/`paperCard` evaluate `canTradeCard` on the render snapshot inside `withBusy` — a ticket submitted elsewhere between render and click slips past the STAGED-only reopen check and mints a duplicate; `updateTicket` early-returns before issuing the PAPER write when the ticket was deleted mid-flight (all UI remove paths gate on STAGED, but `removeTicket` itself carries no status guard); `loadTickets` preserves only SUBMITTING — an optimistic PAPER in the write window can be clobbered back to STAGED by a racing refetch; `paperCard`'s no-quantity path keeps a *created* ticket while the send-failure path discards (inconsistent with method doc); `cardOccurrences` falls back to the trimmed set on cache miss — the round-1 F4 under-coverage returns under a timing edge; `rejectCard` busy-checks but is synchronous — a click during an in-flight action is a silent dead button; `order-ticket.store.ts` at 497 lines crosses the 400-line guideline — document or decompose; minute-granular `buildTicketId` + bare `batch.set()` overwrite means a same-minute same-side staging silently swaps `refId`/`decisionIds`.

**Nits:** `sendTicketToPaper` failure path unconditionally reverts to STAGED (a server-won FAILED mid-flight would be un-failed); duplicate `every(isRejected)` computation between enrich and deriveCardStatus; internal-sounding eligibility error in a user snackbar; dialog can open on a different page if user navigates mid-`tradeCard`-await; `jasmine.createSpy` in new order-ticket spec lines (AGENTS.md prefers `jest.fn()`); `warmConfig` has zero test coverage; no double-failure or mid-flight-delete test for `sendTicketToPaper`; TEST-plan doc drift (stale ACCEPT-decision wording, `floored` vs `Math.round`).

### Test results

- Full suite: **186 suites, 2784 tests — green**
- `ng build`: clean (zero warnings)
- Targeted additions verified: stale-snapshot guard, concurrent-send guard, failed-PAPER-write → STAGED (no SUBMITTING wedge), watched+rejected gating/restore, REJECT-id exclusion from decisionIds, cross-run ticket survival on reject, reopen busy coverage, dialog SUBMITTING/FAILED-stay-open.

### Remediation path

1. Remove the `_busyKeys.set(new Set())` from `warmConfig` (one line — keys self-release in `withBusy.finally`).
2. Make the pre-send save pessimistic in `onAcceptAsPaper` — `updateTicketAndWait` (or equivalent await) before `sendTicketToPaper`.
3. Cheap minors: re-check `findCardTicket` (any status) inside `withBusy` before staging; discard-or-document the created ticket on the no-quantity path; `removeTicket` status guard or leave-documented; document the `allRejected` trimmed-set semantic (or compute pre-filter).

Re-run `/proj review 743 755`.

### Round-3 remediation — 2026-10-05

**Majors fixed:**

1. `warmConfig()` no longer clears `_busyKeys` — `withBusy`'s `finally` owns key release; a comment on `warmConfig` documents why clearing mid-flight would re-open the double-send window. Regression test holds a deferred stage, calls `warmConfig`, and asserts the key (and the second-click rejection) survive.
2. `onAcceptAsPaper` now persists pending edits through `updateTicketAndWait` *before* the confirm dialog and `sendTicketToPaper` — the backend resolves quantity from the stored doc first, so the write must have landed. A failed save aborts with a snackbar (no dialog, no send). `saveEdits` was refactored onto a shared `editedPartial()`; `onSubmit` keeps the optimistic path (RH submit reads local state, not the doc).

**Minors folded in:**

- `tradeCard`/`paperCard` re-check `findCardTickets` (any status) inside `withBusy` — a ticket submitted elsewhere between render and click now bails instead of minting a duplicate.
- `allRejected` moved to `filterGalleryCards`, computed over the **full pre-trim** occurrence set (all timeframes) — matches the full-set reject/restore writes. `deriveCardStatus` reads the flag; the duplicate `every(isRejected)` in enrich is gone.
- `loadTickets` preserves a local `PAPER` over a stale persisted `STAGED`, same as the `SUBMITTING` rule — the optimistic mark lands before the persisted write resolves.
- `paperCard` no-quantity path documents the intentional keep (Trade reopens the ticket to fix quantity).
- Eligibility-guard errors (`'no longer paper-eligible'`) map to a user-actionable snackbar.

**Noted, not fixed (accepted residuals):** `order-ticket.store.ts` at ~500 lines (cohesive store; decomposition deferred); minute-granular `buildTicketId` overwrite (pre-existing id scheme); `updateTicket` mid-flight-delete skip (all UI remove paths already gate STAGED); `cardOccurrences` trimmed fallback on cache miss (page blocks interaction while signals load); `rejectCard` synchronous busy no-op; un-failed server-side FAILED on send revert.

**Verification:** targeted specs 134/134; full suite **188 suites / 2806 tests green**; `tsc --noEmit` clean; `ng build` clean.

**New coverage:** `warmConfig`-during-in-flight busy survival, stale-snapshot bail (trade + paper), `updateTicketAndWait`-before-send ordering + save-failure abort, `loadTickets` PAPER-over-STAGED preservation, full-set `allRejected` under a narrowing timeframe filter.

---

## Re-review — 2026-10-05 (post-remediation round 2)

Scope: the remediation delta — new `GalleryCardActionsService` (card mutations, `busyCardKeys` in-flight guards, full-occurrence-set decisions, config loading); `OrderTicketStore.stageTicketAndWait` + shared `sendTicketToPaper`; `canTradeCard`/`canRejectCard` predicates; sibling delegation in `order.component.ts`/`order-ticket.component.ts`; dialog config via `MAT_DIALOG_DATA` + accepted-status auto-close; facade stripped to a ~221-line view-model seam. ~19 spec files updated/added.

### Verdict: FAIL

Spec axis passed outright — all nine acceptance criteria met with unit coverage and every prior finding remediated. Standards and Thermo-nuclear each surfaced one major integrity defect in the *new* code — same defect classes the remediation existed to kill. Fixes are small and localized; no redesign.

### Findings

**Critical** — none.

**Major:**

1. **`sendTicketToPaper` trusts the caller's snapshot — no source-state re-check** (`order-ticket.store.ts:454-479`). The canonical transaction patches SUBMITTING over whatever `store.tickets()[ticket.id]` currently holds. `order-ticket.component.ts:649` passes `i` captured *before* the confirm-dialog await — a ticket submitted/removed via another surface during that window gets locally flipped SUBMITTED→SUBMITTING, the callable re-runs (duplicate-cohort risk), then PAPER is persisted over a live RH order — which `allTickets` then hides. `submitTicket` already guards this (`store:250`); the paper path needs the same: re-read the ticket inside the method, bail/throw unless STAGED.
2. **`updateTicket` rollback can wedge a ticket in SUBMITTING** (`order-ticket.store.ts:166-188` from `454-479`). Both the success-patch and failure-revert inside `sendTicketToPaper` go through `updateTicket`, whose error rollback restores `prev` — the transient SUBMITTING snapshot. If that persist fails, the ticket is stuck in a never-persisted SUBMITTING locally: `loadTickets` preserves SUBMITTING over server-STAGED (`store:131-135`), and the card is un-sendable/un-submittable for the session. `sendTicketToPaper` should own its revert — restore the pre-send STAGED snapshot, not delegate to `updateTicket`'s generic rollback.
3. **Watched+rejected cards stay tradeable, and Restore is unreachable** (`gallery-cards.util.ts:290-303` vs `338-352`). `deriveCardStatus` checks MONITOR membership before the all-rejected check, so a fully-REJECTed watched card reports `watched` — `canTradeCard` passes, and the staged ticket's `decisionIds` cover the REJECTed occurrences; removing that ticket on the queue page clears the REJECT docs — silently un-rejecting (the exact defect F3 was raised for). The `status === 'rejected'` restore branch is also unreachable for watched+rejected cards. Note: the stated AC precedence is watched > rejected, so the fix isn't a naive reorder — either exclude REJECTed occurrences' ids from staged `decisionIds`, or gate `canTradeCard` on "not fully rejected" (a card-level flag computed at enrichment).

**Minor:** `markPaperFailure`'s doc claims a SUBMITTING revert that never happens on the no-quantity path, and writes STAGED over an already-STAGED doc (wasted write); `tradeCard`'s reopen path bypasses the busy check — double-click opens two dialogs on the same ticket (cosmetic); `removeStagedTickets` isn't run-scoped — reject deletes same-side STAGED tickets from other runs; `paperCard` sizes against `DEFAULT_DOLLAR_AMOUNT` when `_config` is cold (pre-existing dollar-amount ticket clicked before `warmConfig` lands); `loadTickets` wholesale replace can drop a just-persisted ticket mid-flight → dialog `!t` close → orphaned persisted doc; `PaperTradingStore.acceptAsPaper` is a fourth, caller-less paper path (dead code); dead `OrderTicketService`/`OrderExecutionService` injections in `order.component.ts`; `removeTicket` rollback re-adds `undefined` on failed delete of an absent id; symbol-casing asymmetry between `findCardTicket` (raw) and `removeStagedTickets` (toUpperCase); `busyCardKeys`/`_config` survive navigation — a hung send leaves the card key busy until callable timeout.

**Nits:** `rejectCard` lacks the busy guard (double-click toggles reject→restore); `isActionableRun` pass-through computed adds indirection; config-load block drifts vs `signal-review.facade.ts`; `Math.round` vs test-plan "floored" persists (shared util — left to avoid perturbing other surfaces); stale spec title in `gallery-view.component.spec.ts`; missing predicate-matrix and dialog FAILED-stays-open tests.

### Test results

- Full suite: **186 suites, 2771 tests — green**
- `ng build`: clean (zero warnings)

### Remediation path

Fix majors 1–3 (all small): source-state re-check inside `sendTicketToPaper`; `sendTicketToPaper` reverts its own pre-send snapshot; reject-aware trading gate for watched+rejected cards. Address minors as cheap. Re-run `/proj review 743 755`.

---

## Re-review — 2026-10-05 (post-pivot toolbar revision)

Scope: the labeled-toolbar revision — Trade/Reject/Paper/Chart replaced the ACR row; new `gallery-ticket-dialog/` component hosting `OrderTicketComponent`; `tradeCard`/`paperCard`/`rejectCard` in `gallery.facade.ts`; `quantity` sizing option in `signal-order-staging.util.ts`; `'rejected'` card status. ~1,600 lines of diff across 15 files + 4 new files.

### Verdict: FAIL

Six major findings across the axes, three of them converged on by multiple reviewers. Fixes are small and well-scoped; none require redesign.

### Findings

**Critical** — none.

**Major:**

1. **`paperCard` races the ticket persist** (`gallery.facade.ts:305-335`) — `stageCardTicket` → `ticketStore.stageTicket` is fire-and-forget (optimistic patch + unawaited `createTicket`); the paper callable does `getTicket(refId)` and throws `not-found` if the write hasn't landed. `order.component.ts:533-535` explicitly names this hazard — `updateTicketAndWait` exists for it. Fresh-stage → immediate `paperSignalOrder$` skips that guarantee. Fix: await the persist on the auto-stage path.
2. **No in-flight re-entry guard on `paperCard`/`tradeCard`** — both sibling surfaces hold one (`sendingToPaper` `order.component.ts:441`; `acceptingPaper` `order-ticket.component.ts:623,634`). Double-click Paper → ticket transiently SUBMITTING → `findStagedCardTicket` misses it → second ticket staged with a fresh refId → duplicate paper cohort. Trade double-click → double stage + two dialogs.
3. **Sunk cards keep Trade/Paper live** (`gallery-card.component.html:40-55`) — `actionsDisabled` only gates non-actionable runs. Trade on a `rejected` card stages a ticket carrying REJECT `decisionIds`; removing that ticket in the order queue clears those REJECT docs (`order.component.ts:386-413`) — silently un-rejecting. Trade on settled/failed stages duplicates. Sunk cards should expose only Restore.
4. **Reject/Restore/Trade operate on the timeframe-filtered occurrence subset** (`rejectCard` `facade.ts:287-298`) — `card.occurrences` is already trimmed to the active timeframe (`filterGalleryCards` `util.ts:160-168`). Under the default Daily filter, rejecting a merged D+W card writes REJECT only for daily occurrences — the card resurrects under Weekly/All. Restore symmetrically under-clears; staged-ticket `decisionIds` omit hidden occurrences.
5. **Third copy of the paper-send transaction** (`facade.ts:331-351` vs `order.component.ts:469-489` vs `order-ticket.component.ts:647-674`) — eligibility → qty → SUBMITTING → callable → PAPER/revert is now triplicated and already drifting. Hoist a `sendTicketToPaper$(ticket, qty)` into the store or a thin service.
6. **`gallery.facade.ts` crosses the 400-line guideline** (421 lines; ~165-line card-actions block) — extract card actions into a dedicated service or document the exception.

**Minor:** wasted `fetchPrices` in `paperCard` when `t.quantity` is already set; failed auto-stage paper send leaves an orphaned staged ticket (`created && failed` should discard); dialog couples to `GalleryFacade` for `config` — pass `tradingConfig` via `MAT_DIALOG_DATA`; dialog auto-close fires on any non-STAGED transition so an in-dialog submit failure loses the error; `Math.round` vs test-plan "floored" in `computePositionSize`; `removeStagedTickets` skips the `toUpperCase()` sibling convention; duplicated `?? 100` default and config-load block vs `signal-review.facade.ts`; stale sunk-status comments omit `'rejected'`; no dedicated spec for the quantity builder or reject-under-timeframe-filter (F4's coverage gap sits exactly on finding #4).

**Nits:** writable `config` signal should be `.asReadonly()`; `runIfActionable` guard style inconsistent; `buildId` identity wrapper; signal-review facade re-export shim.

### Test results

- Full suite: **184 suites, 2749 tests — green**
- `ng build`: clean (zero warnings)

### Remediation path

Fix majors 1–4 (all small, well-scoped); triage 5–6 (extract shared paper-send + card-action service resolves both); address minors as cheap. Re-run `/proj review 743 755`.

---

## Scope

Change set under review (uncommitted on top of shipped #783):

- `utils/gallery-cards.util.ts` — `GalleryActionContext`, `enrichGalleryCards`, `isSunkCard`, `sunkGalleryGroup`; reject trim in `filterGalleryCards`
- `utils/gallery-cards.util.spec.ts` — status-matrix, precedence, strict-match, sunk-ordering coverage
- `stores/gallery.facade.ts` — `actionContext` computed; `groups` partitions dimension groups + pinned Sunk group
- `stores/gallery.facade.spec.ts` — #755 describe: sunk partition, watched precedence, resting stays, reject trim
- `components/gallery-card/` — status chip (hidden for pending), ticket-status line, `.sunk` dimming, failed border
- Fixture-field updates in `gallery-group.component.spec.ts`, `gallery-view.component.spec.ts`
- IMPL/TEST doc updates

## Verdict: PASS

One remediation round: 1 major (ticket-status line rendered garbage for real staged tickets — all three axes converged on it) plus a cluster of minor/nit findings, all fixed and re-verified. Spec axis passed outright with all acceptance criteria met.

## Axes

### Standards

- **Major (fixed):** ticket-status line rendered `market  @ mkt` for real signal-staged tickets — `buildSignalOrderTickets` emits dollar-based market orders (`dollarAmount`, no `quantity`/`limitPrice`); the old template printed `t.quantity` blank. Fixed via a `ticketLine()` computed that renders `$200`-style notional for dollar tickets and `qty @ price` for limit tickets; spec fixture updated to a real staged-ticket shape.
- **Minor (fixed):** MONITOR membership check normalized `card.symbol.toUpperCase()` to match sibling list-lookup conventions.
- **Minor (fixed):** `filterGalleryCards`'s optional `actions` param silently disabled reject-trim for any caller that forgot it — now required (`{ runId: '', decisions: {} }` stub in non-decision tests).
- **Nits (fixed):** dead `isGroupExpanded` facade method removed (template binds `expandedGroups` map directly); dead `pending: ''` label entry retyped to `Record<Exclude<GalleryCardStatus,'pending'>,…>`; stale header comments in facade + card component; spec's re-declared status union → imports `GalleryCardStatus`; raw `t.status` in the ticket line replaced with title-cased `TICKET_STATUS_LABELS` consistent with the chip.
- **Noted, kept:** `gallery-cards.util.ts` at ~310 lines (over the 300 guideline — still cohesive); ticket fixture builders duplicated across three specs (matches local-fixture convention).

### Spec

All four acceptance criteria verified met:

1. Card renders symbol/name/direction + occurrence chips + status chip + ticket line — MET.
2. Status derivation precedence watched > failed > settled > resting > submitting > pending — MET; all 9 `OrderTicketStatus` values mapped.
3. REJECTed occurrences trim within-card; fully-rejected cards drop — MET (canonical decision-id keying, per-occurrence).
4. Sunk partition — MET; `resting` stays in dimension groups; pinned `Sunk` group ordered action-time desc, untimestamped last.

Low-severity findings remediated (see remediation round) or noted: `decisionIds: []` fallback, test-coverage gaps on the match paths.

### Thermo-nuclear

- **Major (fixed):** same ticket-line rendering defect.
- **Minor (fixed):** run-scoping via `startsWith(runId_)` replaced with exact-membership matching — a ticket now matches only when one of its `signalContext` decision ids canonicalizes to a canonical id **of an occurrence actually on the card** (`buildStOccurrenceDecisionId(runId, o.symbol, o.timeframe, o.signalType)`). Eliminates the prefix-collision edge (run ids embed underscores) and binds the ticket to card content, not just run membership. Per-occurrence canonicalization also fixes secondary `decisionIds[]` entries whose timeframe/signalType differ from the ticket's headline context.
- **Minor (fixed):** `decisionIds?.length` guard so a persisted empty array doesn't suppress the scalar `decisionId` fallback.
- **Nits (kept, documented):** `watched` chip swallows a co-existing `failed`/`settled` ticket state (IMPL-specified precedence — the ticket line still shows the ticket's own status); `'Sunk'` label is internal jargon for a user-facing group; all-sunk page edge renders a single collapsed panel (queued for UAT check).
- **Clean:** seam quality (`GalleryActionContext` → pure utils → facade computed), ordering chain `filter → enrich → partition`, `SUNK_GROUP_KEY` un-prefixed design, perf (bounded O(cards×tickets/symbol) in a memoized computed), no `as any`/`as never` in new spec code.

### Test coverage added in remediation

- `decisionIds[]` array match path (scalar mismatch + array hit)
- `decisionIds: []` → scalar `decisionId` fallback
- non-signal (manual) ticket and OPTION-instrument ticket exclusion
- same-run ticket for a decision *not* on the card → no match (regression for the old prefix logic)
- legacy hyphen-format `decisionId` canonicalization match
- realistic dollar-based staged ticket renders `market $200 · Staged`

## Test results

- Gallery suites: 5 suites, 78 tests — green
- Full suite: 182 suites, 2660 tests — green
- `ng build` — clean, no warnings

## Judgement calls

- **Exact-membership ticket matching** (vs IMPL's "prefixed by runId") — stronger invariant, reviewed and accepted; the IMPL's intent (strict run+side scoping) is preserved and tightened.
- **Ticket from a trimmed occurrence no longer statuses the card** — consequence of exact matching; a rejected/timeframe-filtered occurrence's ticket correctly falls off the card.
- **Watched-over-failed chip precedence** — kept per IMPL; ticket line preserves the underlying ticket status.
