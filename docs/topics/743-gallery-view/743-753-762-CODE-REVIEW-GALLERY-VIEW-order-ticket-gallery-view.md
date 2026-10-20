**Topic:** Gallery Order Ticket View  
**Topic Slug:** order-ticket-gallery-view  
**Thread:** Gallery View Page  
**Thread Slug:** gallery-view-page  
**Issue:** #753  
**Thread Parent:** #744  
**Topic Parent:** #743  
**Task:** #762  
**Domain:** GALLERY-VIEW  
**Type:** CODE-REVIEW  
**Status:** Complete  
**Created:** 2026-10-17  
**Last Updated:** 2026-10-17  

## Round 2 — re-review after in-review fixes (2026-10-17)

All three axes re-ran on the post-fix diff (~2365 lines). Every round-1 fix verified correct end-to-end.

**New round-2 findings (all fixed):**

1. **minor — confirmation masked a bound leg's failure.** With both equity+option tickets bound, a done leg's panel kept showing "Order submitted" while the other leg reverted to FAILED. Fixed: FAILED on either bound leg outranks done — the effect clears `confirmation` so the form (and its error) shows (`gallery-ticket-dialog.component.ts` effect).
2. **minor — `goBack()` targeted `signals/review`.** The order page's back button navigated to the surface the gallery supersedes — and the gallery is the only `?ticket=` producer. Retargeted to `AppRoutes.GALLERY` + tooltip updated (`order.component.ts:626`, `.html:4`, spec).
3. **nit — Paper button tooltip leaked the flag name** — reworded to user-facing copy.
4. **nit — stale comments/docs** — `unwatchCard` busy-window comment overclaimed (double-click window is microtask-scoped; write is idempotent anyway); `dataPending` comment overstated the list-catalog leg (one-shot after first emission); `CONTEXT.md` Gallery Card entry still said "Sunk"/`dev/gallery`-pending — all corrected.

**Spec-axis gap closed:** `orderTicketTerms` gained a 4-case unit spec (`signal-order-staging.util.spec.ts`) pinning option/equity-limit/quantity-market/dollar branches.

**Round-2 tests:** focused suites green (100 tests across the touched specs + new util spec); full suite re-run — 3,933 tests, same 2 foreign failures (`screenshot-capture-contracts`, `sidenav-menu`), none in scope.

**Accepted residuals (documented, not fixed):** `wantedTicketId` stays pending if the RH fetch never succeeds — inert, interim first-row select is graceful; a deep link to a permanently-filtered ticket (PAPER/FILLED-with-position/CANCELLED>24h) silently falls back to the first row; `unwatchCard`'s optimistic snack can precede an enqueueWrite failure toast (codebase-wide pattern).

**Verdict reaffirmed: PASS.**

## Summary

Route promotion + order-flow handoff. The gallery mounts canonically at `trading/gallery` (same lazy component, `authGuard`), `dev/gallery` retained; nav gains Trading → Gallery; the run dashboard's "Review Latest Signals" and per-run row actions navigate to the gallery with `setActiveRun` seeding. User-directed additions beyond the literal ticket: "Sunk"→"Actioned" section with per-status exits (Unwatch/Restore/Requeue), default grouping NONE + `dataPending` loading gate, ticket dialog stays open on done-status with a confirmation panel (View order / Done), card ticket-line deep links to `trading/live?ticket=<id>` honored by `OrderComponent`, manual Paper disabled behind `GALLERY_MANUAL_PAPER_ENABLED`, shared `requeueTicketPatch()` + `orderTicketTerms()`.

Three review axes ran in parallel (Standards, Spec, Thermo-nuclear). Verdict: **PASS** — all major findings fixed and re-verified before consolidation.

## Findings by severity

### Major (all fixed during review)

1. **`?ticket=` deep link raced the RH-load filter** (`order.component.ts` auto-select effect). `wantedTicketId` was consumed and cleared on the first non-empty `allTickets` emission, but `allTickets` hides non-STAGED/FAILED rows until `rhOrdersLoaded` — and the ticket-line's primary targets are resting/submitted tickets. Fixed: the pending id is held until it matches, released only once `rhOrdersLoaded` exposes the full queue. Regression spec added (resting target hidden → interim first-row select → selected on RH load).
2. **Stale confirmation on done→FAILED revert** (`gallery-ticket-dialog.component.ts`). `confirmation` was set-once and never cleared — a SUBMITTED→FAILED reconcile left "Order submitted" on screen hiding the error, the exact outcome the #755 review banned. Fixed: the effect clears `confirmation` when no bound ticket is done, returning to the form (covers requeue-to-STAGED too). Comment corrected — the panel is live-read, not captured. Spec added.
3. **Duplicated order-terms formatting** — `confirmationTerms` re-implemented `ticketLine`'s ternary verbatim. Extracted `orderTicketTerms()` into `signal-order-staging.util.ts`; both consumers share it.

### Minor (fixed)

4. `dataPending` omitted `symbolListsLoading()` — the PRIMARY list filter can transiently empty `visibleCards` during a catalog reload, flashing the empty state the gate exists to kill. Added the leg (`gallery.facade.ts:198`).
5. `unwatchCard` checked `_busyKeys` without entering the busy window — double-click could double-write. Now wrapped in `withBusy` (`gallery-card-actions.service.ts`).

### Minor / nit (accepted, documented)

6. Same-route `?ticket=` re-navigation (browser Back while already on `trading/live`) won't re-select — snapshot read once at construction. No in-app path exercises it; revisit if in-page ticket links appear.
7. `GALLERY_MANUAL_PAPER_ENABLED = false` leaves a permanently disabled button + live `paperCard` path — deliberate documented toggle per user direction; flip the flag to re-enable.
8. `order.component.ts` at ~723 lines — pre-existing size smell, not introduced here.
9. `confirmationTerms` renders `10 @ mkt` for quantity-market tickets — shared-formatter quirk retained for consistency with the card line.

## Spec axis — acceptance criteria

| # | Criterion | Verdict |
|---|---|---|
| 1 | `trading/gallery` lazy route serves the gallery; `dev/gallery` still works | **MET** — `AppRoutes.GALLERY`, lazy `loadComponent` + `authGuard` (`core-routes.ts`); `dev/gallery` retained and now pinned in `core-routes.spec.ts` |
| 2 | Run dashboard entry point → `trading/gallery` | **MET by user-directed variant** — no literal "View Signal Gallery" label; "Review Latest Signals" + row actions navigate with run seeding (spec-covered). Literal-vs-spirit deviation noted for the record |
| 3 | `signals/review` and `trading/live` unchanged | **MET** — routes and all existing links untouched; `trading/live` gains only the additive `?ticket=` param |

## Test results

- Focused suites: **11 suites / 337 tests green** (core-routes, nav-sections, dashboard, gallery-card, dialog, order, facade, ui-store, actions service+util, gallery-view).
- Full suite: **3,896 tests, 2 failures — both foreign/pre-existing**: `screenshot-capture-contracts.spec.ts` (in-flight #746 `PositionType` contract) and `sidenav-menu.component.spec.ts` (stale dev-menu expectation vs #1041 `dev/ds`). `order.component.spec.ts`'s 42 prior `NG0201: No provider found for Functions` failures were fixed by an `OrderExecutionService` boundary stub (AGENTS.md convention).
- `tsc --noEmit`: clean on touched files; two pre-existing foreign errors remain (`scripts/bulk-swing-sweep.ts`, `indicator-config-dialog.component.ts`).

## Verdict

**PASS** — proceeds to `7_QA`. Run `/proj qa 743 762`.
