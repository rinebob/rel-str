# Test Plan — FE: Single-leg option orders

**Topic:** Options Trading Support  
**Topic Slug:** options-trading-support  
**Thread:** Single-leg option orders  
**Thread Slug:** single-leg-option-orders  
**Issue:** #948  
**Thread Parent:** #943  
**Topic Parent:** #942  
**Domain:** OPTIONS  
**Type:** TEST  
**Status:** Draft  
**Created:** 2026-10-11  
**Last Updated:** 2026-10-11  

## E2E User Journeys

- Trade on a signal card → dialog opens with Stock / Option tabs; Stock
  tab shows the existing staged equity ticket unchanged.
- Option tab → expiration select populates → pick expiration → strikes
  populate → pick strike + call → contract summary + mark render → enter
  qty + limit price → confirm → submit → dialog closes; card shows
  'resting'.
- Paste a copied OCC contract id → selects resolve to the same contract
  → quote + summary identical to the selects path.
- Option-chain page → "copy contract" on a contract → clipboard holds
  the OCC id → paste into the dialog resolves.
- Submit fails (broker rejection) → error surfaces on the ticket in the
  dialog; dialog stays open; ticket reverts to STAGED for retry.
- Open Option tab, pick a contract, close dialog without submitting →
  both the equity and option STAGED tickets are discarded; card returns
  to pending.
- Submit option ticket, never touch Stock tab → equity STAGED ticket
  discarded on close; option order visible in portfolio open-orders.
- Account without option_level_2 → submit → RH permission error
  surfaces inline, ticket stays STAGED.
- Premium exceeding `optionMaxPremiumCashPercent` of available cash →
  submit blocked inline before review/place is called.

## Integration Tests

- `OptionOrderTicketComponent` + `OrderTicketStore` (stubbed service):
  contract resolution triggers `stageTicketAndWait` once; edits write
  `updateTicket`; submit calls `submitTicket` with the option ticket id.
- `GalleryTicketDialogComponent` + store: close-on-done effect fires for
  the option ticket's id as well as the equity ticket's; tab switching
  preserves both forms' state.
- `GalleryCardActionsService` + `findCardTickets`: a STAGED option ticket
  matches its card via decisionIds regardless of card side; discard on
  close removes equity + option STAGED tickets together; a submitted
  option ticket leaves the card 'resting'.
- `OrderTicketStore.submitTicket` routing: OPTION →
  `submitOptionOrder`; EQUITY/ETF → `submitEquityOrder`; option submit
  failure reverts to STAGED with error (shared revert machinery).
- `OrderExecutionService.submitOptionOrder` + mocked MCP observation
  service: review→place arg shapes (`option_id`, `position_effect`,
  `market_hours: 'regular_hours'`, `ref_id` from ticket); review error
  short-circuits place; dead/unconfirmed classification parity.
- `RobinhoodMcpClient.getOptionChains`/`getOptionInstruments` + mocked
  transport: arg shapes (`underlying_symbol`, `chain_symbol` +
  expiration/strike/type filters), list extraction, malformed payloads.
- Confirm dialog renders the option summary rows for an
  `OptionOrderTicket` (contract identity, BUY TO OPEN, premium total).

## Unit Tests

- Pure functions:
  - `option-contract.util`: `parseOptionPaste` — valid OCC id, extra
    whitespace/casing, garbage → null; `premiumNotional` math;
    `fatfingerBlock` boundary (exactly at % boundary, missing config →
    25 default).
  - `option-ticket-staging.util`: `buildOptionSignalTicket` — decisionIds
    match equity builder semantics (canonical ids, first→decisionId),
    rejected occurrences excluded, side/orderType/TIF/marketHours fixed
    values, unique id format.
  - `gallery-card-actions.util`: `findCardTickets` accepts OPTION via
    decisionIds and skips the side check only for OPTION tickets.
- Component: select enable/disable ordering (expiration → strike →
  call/put), paste error path, submit gating (unresolved contract,
  qty 0/non-integer, market order without price allowed, limit without
  price blocked), fatfinger block message.
- Confirm dialog option rendering branches.

## Test Seams

- `RobinhoodMcpObservationService.executeTool` — mock per tool name
  (review/place/chain/instruments/quotes) at the seam used by existing
  execution specs.
- `RobinhoodMcpClient` — stub `getOptionChains`/`getOptionInstruments`/
  `getOptionQuotes` at component level; keep client parser specs at the
  transport mock.
- `OrderTicketService` (Firestore) — `stageTicketAndWait`/`updateTicket`
  mocked or `of()`-resolved per existing store spec patterns.
- `PortfolioService.getSnapshot` — stub `cash` for fatfinger tests.
- `TradingConfigService.loadConfig` — config with/without
  `optionMaxPremiumCashPercent`.
- Firebase providers stubbed per AGENTS.md; async paths flushed with the
  macrotask boundary (`setTimeout(0)`).

## Edge Cases

- Two different contracts from one card → two distinct tickets (no
  symbol+side dedupe); second Trade click while a STAGED option ticket
  exists → reopens/continues, no duplicate stage.
- User resolves contract A, then changes strike → same ticket, `legs[0]`
  updated in place, refId preserved.
- Paste of an expired/delisted contract → `state: 'active'` filter
  returns nothing → inline unresolved error.
- Market order: price field hidden/disabled, TIF forced gfd.
- Strike select options with fractional strikes ('150.0000') — exact
  match filtering.
- Equity regression: Stock tab behavior unchanged end-to-end; equity
  `findCardTickets` results unaffected by option tickets on other cards.
- Rapid tab switching / double submit — store's SUBMITTING guard covers.
