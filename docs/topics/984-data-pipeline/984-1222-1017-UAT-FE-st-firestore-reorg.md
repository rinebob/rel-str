**Topic:** ST Firestore Reorg  
**Topic Slug:** st-firestore-reorg  
**Thread:** Data Plane Consolidation  
**Thread Slug:** data-plane-consolidation  
**Issue:** #1222  
**Thread Parent:** #985  
**Topic Parent:** #984  
**Task:** #1017  
**Domain:** FE  
**Type:** UAT  
**Status:** Complete  
**Created:** 2026-10-23  
**Last Updated:** 2026-10-23  

# UAT — #1017 FE occurrence-decisions write removal in gallery flow

## Results log

| Scenario | Result | Evidence |
|---|---|---|
| S1 Persistence layer gone (automated) | PASS | zero live refs to `OccurrenceDecisionStore`/`occurrence-decision.service`/`ST_OCCURRENCE_DECISIONS`/`ReviewDecision.` in `src/`; `occurrence-decision.service.ts` + `occurrence-decision.store.ts` deleted |
| S2 Non-reintroduction pin | PASS | `st-path-cutover-1014.spec.ts` 4/4 — asserts `'ST_OCCURRENCE_DECISIONS' in Collection === false` |
| S3 Test suite (automated) | PASS | `tsc --noEmit` clean; `git diff --check` clean; feature suite 127/127 suites, 2,529 tests |
| S4 Removed surfaces (automated) | PASS | `pages/signal-action-report/` + `components/status-summary-chips/` deleted; zero `SIGNAL_ACTION_REPORT` refs outside specs (nav-sections.spec pins absence) |
| S5 Rules deny-by-default (automated) | NOTED | no `savant-trader/data/occurrence-decisions` match block; global `match /{document=**} { allow read, write: if false }` — takes effect at next `firebase deploy --only firestore`; no client writer exists today |
| S6 Gallery Reject → session sink (user) | PASS | All card buttons disabled mid-session — pre-existing dead-stream bug (#1227): runs-listener `catchError → of([])` wiped `runs` AND completed the stream permanently → `viewedRun` null → `isActionableRun` false. Fixed in-session: unbounded `retry` resubscribes a fresh listener after 10s and `runs` is never wiped — a hiccup now shows a "Live run updates interrupted — retrying" snackbar and self-heals; buttons stay usable on last-known data. |
| S7 Gallery Restore (user) | PASS | user-verified
| S8 Reject removes staged tickets (user) | PASS | user-verified (CIBR orphans also manually cleared)
| S9 Gallery Trade → dialog → submit (user) | PASS | user-verified
| S10 Signal Review Trade button (user) | PASS | user-verified
| S11 Signal Review reopen/block (user) | PASS | Found via Chart Review direct entry: ticket store never hydrated → adopt probe saw an empty map → repeated Trade minted duplicate STAGED stock tickets (`liv_CIBR-BUY-...1451` + `...1454`). Fixed: `chart-review.ngOnInit` now calls `ticketStore.loadTickets()`. tsc clean; verify Trade reopens `...1454` instead of minting a third. |
| S12 Signal Review manual fallback (user) | PASS | user-verified
| S13 Chart Review Trade (user) | PASS | Direct-entry run-context hole found (page never set `activeRunId` → Trade dead). Fixed in-session — `StStore.loadData` + latest-completed-run auto-select added, same pattern as the facades. User-verified: Trade enabled and working on direct entry to `/signals/charts`. |
| S14 Cancel discards created; adopted survive (user) | PASS | user-verified
| S15 Header Order pill (user) | PASS | user-verified
| S16 Option tab staging (user) | PASS | user-verified
| S17 Run-scoped reject (user) | PASS | user-verified
| S18 Mixed-direction partition (user) | PASS | user-verified
| S19 No console Firestore errors (user) | PASS | user-verified
| S20 Refinement pass (user) | PASS | user-verified

## Scope

- Durable `savant-trader/data/occurrence-decisions` layer removed
  end-to-end (service, store, Collection member, rules ACL, types).
- ACR workflow removed: Accept/Consider/Watch/Reject buttons, status
  chips, triage-report page/route/nav, screening statuses, stale-
  decision row fields.
- Gallery Reject → session-local sink (run-scoped, zero writes).
- Accept → Trade: stages a persisted order ticket and opens
  `GalleryTicketDialogComponent` on both review pages; manual fallback
  when the symbol has no run signals.
- Ticket `decisionId(s)` retained as join keys — a ticket's decision
  ids are how the app knows which card/signals a ticket belongs to:
  dedupe on re-stage, card status, and which ticket Reject removes.
  They are deterministic strings stamped on the ticket doc itself —
  no separate documents are ever written.
- Code-review rounds also fixed: Trade can't open two dialogs; a live
  order for the symbol blocks new staging (old filled orders don't);
  tickets load on direct Signal Review entry; a cancel while a submit
  is in flight still cleans up the staged ticket; option tickets can't
  persist after their dialog is closed.

## Prerequisites

- Repo at `prod` with the uncommitted #1017 + concurrent WIP worktree.
- Dev server: `npm start` → http://localhost:4210 (confirmed up
  2026-10-23).
- Normal Firebase/RH session; a current run with signals loaded so the
  gallery and review pages have cards.

## Start instructions

- Gallery: http://localhost:4210/trading/gallery
- Signal Review: http://localhost:4210/signals/review
- Chart Review: http://localhost:4210/signals/charts
- Order queue: http://localhost:4210/trading/live
- DevTools console open — watch for Firestore permission errors and
  `occurrence-decisions` requests (there must be none).

## Scenarios

### S1 — Persistence layer gone (automated, executed)

- `grep -rn "OccurrenceDecisionStore|occurrence-decision.service|ST_OCCURRENCE_DECISIONS|ReviewDecision." src/` →
  zero hits outside `#1017` comments/spec pins and the kept
  `buildStOccurrenceDecisionId` join-key builder. **PASS**
- `occurrence-decision.service.ts`, `occurrence-decision.store.ts` —
  deleted. **PASS**

### S2 — Non-reintroduction pin (automated, executed)

- `npx jest st-path-cutover-1014` → 4/4 pass; the spec asserts
  `ST_OCCURRENCE_DECISIONS` is absent from `Collection`. **PASS**

### S3 — Test suite (automated, executed)

- `npx tsc --noEmit -p tsconfig.app.json` → clean (exit 0).
- `npx jest src/app/features/savant-trader` → 127/127 suites, 2,529
  tests, all pass.
- `git diff --check` → clean.

### S4 — Removed surfaces (automated, executed)

- `pages/signal-action-report/` and `components/status-summary-chips/`
  directories absent.
- `SIGNAL_ACTION_REPORT` enum/route/nav — zero live refs;
  `nav-sections.spec.ts` pins `'signal-action-report'` absent from nav.

### S5 — Rules deny-by-default (automated, executed — noted)

- `firestore.rules` has no `savant-trader/data/occurrence-decisions`
  match block; the global `match /{document=**} { allow read, write:
  if false }` covers it. Takes effect at the next `firebase deploy
  --only firestore` — no FE writer exists regardless (all deleted).
  The `rh-agent-occurrence-decisions` block at :266 is a different
  collection — correctly retained.

### S6 — Gallery Reject → session sink (user)

1. Gallery, pending card with no live order. Click **Reject**.
2. Expected: card moves to the Actioned section under a "rejected"
   bucket with a timestamp — instantly, no spinner.
3. DevTools Network/Application: zero Firestore writes to
   `occurrence-decisions` (ticket deletes for staged tickets are fine —
   see S8).
4. Reload the page → the card is back in pending (session-ephemeral).

### S7 — Gallery Restore (user)

1. On the session-rejected card from S6 (before reload), click
   **Restore**.
2. Expected: card returns to pending immediately.

### S8 — Reject removes staged tickets (user)

1. On a pending card, click **Trade** → dialog opens (the STAGED
   ticket is persisted immediately — Trade writes it, not submit).
2. **Reload the page** — the dialog dies, the STAGED ticket survives
   in the order queue (`/trading/live`), the card is back to pending.
   (A clean close discards a click-created ticket instead — that's
   S14.)
3. Click **Reject** on that card.
4. Expected: the STAGED equity ticket disappears from the order queue;
   if an option ticket was staged, it is removed too.

### S9 — Gallery Trade → dialog → submit (user)

1. Pending card → **Trade**.
2. Expected: order dialog opens bound to a STAGED ticket sized on the
   card (shares, account, side correct); Place Order is enabled when an
   account is configured.
3. Optionally submit one paper order on a test card — ticket advances
   SUBMITTING → terminal/paper state without errors.

### S10 — Signal Review Trade button (user)

1. `/signals/review` — every symbol row shows a **Trade** label button
   (no ✓/eye/watch/reject icon cluster).
2. Click Trade on a LONG-signal row.
3. Expected: dialog opens on a newly staged signal-provenance ticket
   (buy side, `sourceRef` occurrence ids present via join keys).

### S11 — Signal Review reopen/block (user)

1. First leave a STAGED ticket on a symbol: **Trade** → dialog opens →
   reload the page (the ticket persists; a clean close would discard
   it). Then click **Trade** on that symbol's row again.
2. Expected: dialog REOPENS the existing STAGED ticket — no duplicate
   in the order queue.
3. On a symbol with a live (submitted) equity order: **Trade** →
   snackbar "a live order already exists for this symbol", no dialog.
4. A FILLED/CANCELLED ticket must NOT block — Trade stages fresh.

### S12 — Signal Review manual fallback (user)

1. Find a symbol in the review list with NO signals in the current run
   (or use Chart Review browse — see S13).
2. Click **Trade**.
3. Expected: the manual order dialog opens with the symbol pre-filled
   in the entry row (not a signal-provenance ticket).

### S13 — Chart Review Trade (user)

1. `/signals/charts` — header shows a **Trade** button (the ACR
   cluster is gone).
2. Click it on a selected symbol → same `tradeSymbol` behavior as S10
   (dialog on staged ticket, or manual fallback when no run signals).

### S14 — Cancel discards created; adopted survive (user)

1. **Trade** → dialog opens → click the backdrop/X (cancel).
2. Expected: the just-staged ticket is gone from the order queue.
3. Reopen an existing STAGED ticket (S11) → cancel → ticket SURVIVES
   (it wasn't created by that dialog session).
4. Close the dialog while a submit is in flight and let the submit
   fail → the reverted STAGED ticket is cleaned up (pendingDiscards
   drain; no stranded STAGED row).

### S15 — Header Order pill (user)

1. Signal Review header pill labeled **Order** shows the count of
   non-terminal tickets.
2. Expected: count matches the order queue (staged + live), changes as
   tickets stage/submit/terminate; no "accepted" semantics.

### S16 — Option tab staging (user)

1. On a card/row with signals, open the dialog's **Option** tab and
   resolve a contract (expiry → strike → type).
2. Expected: an option ticket stages with full run-occurrence
   provenance; no reject-filter dead-ends; adopt dedupe prevents a
   second ticket for the same contract.

### S17 — Run-scoped reject (user)

1. Reject a card under run A.
2. Switch the viewed run to B (run selector) → the same symbol:side
   card is NOT sunk.
3. Switch back to A → still rejected.

### S18 — Mixed-direction partition (user)

1. Find a symbol with both LONG and SHORT signals in the run (or craft
   via the direction filter).
2. Click **Trade**.
3. Expected: ONE direction's ticket is staged (filter direction, or the
   reopened ticket's side); a snackbar reports the skipped side.

### S19 — No console errors (user)

1. While executing S6–S18, watch DevTools console/network.
2. Expected: zero Firestore permission errors; zero requests to
   `occurrence-decisions`; no dead-button affordances producing
   console noise.

### S20 — Refinement pass (user)

- Walk Gallery, Signal Review, Chart Review at desktop width:
  - Trade buttons look like the other row actions (label, disabled
    states correct while busy/live).
  - Rejected bucket in Actioned has clear copy ("rejected" + timestamp).
  - Dialog opens centered at 640px, tabs switch cleanly, cancel
    affordance obvious.
  - No leftover ACR vocabulary anywhere in the UI (Accept/Consider/
    Watch/Reject labels, status chips, "Review 0" pill).
- Report anything visually off; screenshot if possible.

## Traceability

| QA criterion (#1222) | Scenario |
|---|---|
| No live readers/writers; service+store+constant+rules gone; pin spec | S1, S2, S5 |
| Reject → Actioned session-only, zero writes, restores on reload | S6 |
| Restore returns card to pending | S7 |
| Reject removes staged tickets | S8 |
| Gallery Trade stages + dialog + submit | S9 |
| Signal Review Trade button; stages + dialog | S10 |
| Reopen STAGED; block on live | S11 |
| Manual fallback when no run signals | S12, S13 |
| Chart Review Trade same path | S13 |
| Cancel discards created; adopted survive | S14 |
| Header Order pill counts non-terminal | S15 |
| Triage report/chips/route/nav gone | S4 + visual (S20) |
| Option ticket staging unaffected | S16 |
| Run-scoped rejects (review finding) | S17 |
| Merged #1189 WIP coexistence | S12–S14 (manual dialog paths) |
| Test suite / tsc / diff | S3 |

## Regression / smoke checklist

- [ ] Order queue page renders staged+live tickets; requeue on a
  FAILED ticket still works.
- [ ] Manual "New Order" header button opens the manual dialog
  (coexisting #1189 work).
- [ ] `/trading/live` deprecated page still loads (kept for
  repurpose); its New Manual Order button opens the real dialog.
- [ ] No route resolves at the old signal-action-report URL.
- [ ] Firestore console: no new `occurrence-decisions` docs created
  while exercising all flows.
