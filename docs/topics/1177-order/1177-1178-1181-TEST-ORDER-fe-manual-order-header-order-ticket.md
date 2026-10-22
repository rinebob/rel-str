**Topic:** Manual Order Entry  
**Topic Slug:** manual-order  
**Thread:** Header Order Ticket  
**Thread Slug:** header-order-ticket  
**Issue:** #1181  
**Thread Parent:** #1178  
**Topic Parent:** #1177  
**Domain:** ORDER  
**Type:** TEST  
**Status:** Draft  
**Created:** 2026-10-21  
**Last Updated:** 2026-10-21  

# Test Plan: Manual Order Entry — Header Order Ticket

## E2E User Journeys

- Journey 1 — Header → stock buy: click **New Order** in the app header (from any page) → dialog opens → type `AAPL` + resolve → quote strip shows → Stock tab has a staged manual ticket → edit terms → submit → confirmation panel shows broker state → **View order** navigates to the portfolio dashboard.
- Journey 2 — Header → option BTO: open dialog → enter symbol → Option tab → pick expiration/strike/call or paste contract → resolved contract shows mark + premium estimate → submit → confirmation.
- Journey 3 — Option STO: same as J2 with the toggle at "Sell to open" → collateral estimate line renders → submit → confirmation (or "infinite risk" error lands on ticket for a naked call).
- Journey 4 — Cancel: open dialog → resolve symbol → close without submit → staged session ticket is discarded (gone from `OrderTicketStore`/`st-order-tickets`).
- Journey 5 — Reopen: stage a manual ticket for AAPL, close the dialog (discards it), stage again → then re-resolve AAPL mid-session → adopts the STAGED ticket instead of duplicating.

## Integration Tests

- `ManualOrderService` + `OrderTicketStore`: `stageEquityTicket` persists via `stageTicketAndWait`; adopt-path returns the existing STAGED manual ticket for the symbol; `discardStagedTicket` removes only STAGED tickets.
- `ManualOrderService` + `GalleryTicketDialogComponent`: dialog opens with manual data; `onStaged` callbacks populate the service's created-id set; `afterClosed` triggers discard of still-STAGED session ids.
- `GalleryTicketDialogComponent` (manual mode): symbol resolution drives `ticketId`, quote strip, and tab rendering; confirmation panel renders on done-status; View-order navigates to `PORTFOLIO_DASHBOARD` in manual mode and keeps `?ticket=` deep link in card mode.
- `OptionOrderTicketComponent` (manual mode): runs without `runId`/`signals`/`decisions`; stages via `buildManualOptionTicket`; `staged` emit fires `created:true|false` for the host's tracking.
- `OptionOrderTicketComponent` STO: toggle flips leg side on the staged ticket; collateral preview calls `review_option_order` with `chain_symbol`+`underlying_type`; preview failure is silent/non-blocking; fatfinger cap applies to BTO only.
- `HeaderComponent`/`CoreComponent`: `newOrder` output wired to `ManualOrderService.open()`; button renders only when authenticated.

## Unit Tests

- `manual-ticket-staging.util.ts`:
  - `buildManualEquityTicket` — `source: MANUAL`, `side: 'buy'`, no `signalContext`/`sourceRef`, market/gfd/regular_hours defaults, quantity carried through, id via `buildTicketId`.
  - `buildManualOptionTicket` — BTO (`side: 'buy'` ticket + leg) vs STO (`side: 'sell'` both levels), `positionEffect: 'open'`, `OPT-MAN-{BTO|STO}-` id discriminator, OCC-symbol normalization/rejection parity with the signal builder.
- `ManualOrderService` (mock store/services): config-missing snackbar bail; existing-STAGED adoption; discard-on-close set math (created + still-STAGED only).
- `GalleryTicketDialogComponent` manual branch: `displaySymbol`/quote computeds driven by `enteredSymbol`; confirmation effect unchanged for card mode.
- `OptionOrderTicketComponent` manual/STO computeds: `canSubmit` in manual mode; `fatfingerExceeded` inert on sell side.

## Test Seams

- **Highest seam:** component TestBed — render the dialog in manual mode with stubbed `OrderTicketStore`/`EquityPriceService`/`ManualOrderService` and assert template state + emits (same harness style as the existing `gallery-ticket-dialog.component.spec.ts` and `option-order-ticket.component.spec.ts` mocks).
- **Service seam:** `ManualOrderService` with jest-mocked store/config/price/dialog — assert staging calls, adoption, discard set.
- **Pure seam:** the two builders — table-driven, no Angular.
- Firebase injection tokens (`Firestore`, `Auth`, `Functions`) stubbed per repo spec conventions.

## Existing Test Coverage

- `gallery-ticket-dialog.component.spec.ts` — card-mode binding, confirmation transitions, tab content: card-mode cases must stay green untouched.
- `option-order-ticket.component.spec.ts` — signal-mode staging/adoption/guard matrix: must stay green; manual-mode cases are additive.
- `signal-order-staging.util.spec.ts` / `option-ticket-staging.util.spec.ts` — builder conventions the manual builders mirror.
- `header.component.spec.ts` / `core.component.spec.ts` — auth-conditional render + output wiring.

## Edge Cases

- Empty/invalid symbol → inline error, no stage, tabs hidden.
- Symbol resolve while a previous ticket is STAGED for a different symbol → both tickets coexist (`ticketsBySymbol` scoping).
- Double-resolve race (rapid Enter clicks) → single `stageTicketAndWait` (adopt-check inside, or busy-guard mirroring `withBusy`).
- Account missing at `open()` → snackbar, dialog never opens.
- Collateral preview call fails → nothing rendered, submit unaffected.
- `submitOptionOrder` naked-call 400 → ticket `error` renders in place (store behavior).
- Dialog closed mid-submit (SUBMITTING) → ticket is not STAGED, survives discard.

## Manual/UAT (per `/proj qa`)

- Live place: small BTO limit far below mark → rests; cancel from Portfolio open orders.
- Live place: STO far-OTM CSP put → rests; verify `direction: credit`/`opening_strategy: short_put` on the RH order; cancel.
- Confirm a naked call surfaces the broker error.
- Verify header button renders on every authenticated page and hides signed-out.
