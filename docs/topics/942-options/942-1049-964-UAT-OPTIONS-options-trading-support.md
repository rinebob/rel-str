**Topic:** Options Trading Support  
**Topic Slug:** options-trading-support  
**Thread:** Single-leg option orders  
**Thread Slug:** single-leg-option-orders  
**Issue:** #1049  
**Thread Parent:** #943  
**Topic Parent:** #942  
**Task:** #964  
**Domain:** OPTIONS  
**Type:** UAT  
**Status:** Complete  
**Created:** 2026-10-16  
**Last Updated:** 2026-10-16  

# UAT — #964 Gallery dialog tabs + card statusing + discard

## Scope

Host the `OptionOrderTicketComponent` inside the signal-gallery trade dialog alongside the existing stock/ETF ticket; wire option tickets into card statusing, reopen, and discard-on-close.

- `mat-tab-group` in `GalleryTicketDialogComponent` — Stock tab unchanged, Option tab lazy (`matTabContent`) and preserved across tab switches
- `findCardTickets` admits OPTION tickets via `decisionIds`; side check skipped for OPTION (long put on a SHORT card is still `side:'buy'`); live tickets outrank STAGED for card status
- tradeCard/paperCard reopen checks equity-scoped — a STAGED option ticket can never be adopted as the stock reopen
- Close-without-submit discards exactly the STAGED tickets created during that dialog session (equity + option); adopted pre-existing tickets survive
- Option ticket fixes delivered under this task: `getOptionInstruments` wire contract (dropped `state`/`tradability` pins, `data.next` pagination, client-side tradability filter), `getOptionQuotes` live-shape parse (`mark_price`/`close.price`), quote mark auto-fill preserving user-typed prices, quantity default 1, dialog title `Open order ticket`

## Prerequisites

- Dev stack running: `npm start` (Angular dev server, Robinhood API proxied through `:4200`) — or the hosted preview already running in this session
- A Robinhood-linked account with an active **signal run** so Signal Gallery cards exist (cards with occurrences/decisions — required for option-ticket card association)
- Account `option_level_2` (or higher) for live option order placement; paper path requires none
- Automated evidence: `npx jest` focused suites (see Evidence section)

## Start instructions

1. `npm start` → open the app → **Signal Gallery** view.
2. On a signal card with signals, click **Trade**.
3. The dialog `Open order ticket` opens with **Stock** and **Option** tabs.

## Test scenarios

### 1. Tab layout and stock parity

- **Start:** gallery card, no tickets.
- **Steps:** click Trade → observe dialog title and tabs; inspect the Stock tab.
- **Expected:** title reads exactly `Open order ticket` (not "Buy"/"Sell"); tabs are `Stock | Option`; Stock tab renders the equity ticket identical to pre-change behavior.
- **Evidence:** dialog spec (tab render, title); user-confirmed in session 2026-10-16.
- **Result:** PASS

### 2. Lazy option mount

- **Start:** dialog open on Stock tab; browser devtools network panel filtered to MCP calls (or a `getOptionChains` spy).
- **Steps:** stay on Stock tab → observe no option-chain request; click Option tab → chain request fires once.
- **Expected:** zero option requests until first activation; exactly one chain fetch on activation.
- **Evidence:** dialog spec "lazy option mount" (no client calls before activation).
- **Result:** PASS (spec); user-confirmed 2026-10-16

### 3. Expiration → strike → contract flow

- **Start:** Option tab active.
- **Steps:** pick an expiration → strike select enables and populates → pick a strike → pick call or put.
- **Expected:** strikes populate for the expiration (previously zeroed by the `state`/`tradability` pins — regression); contract summary renders with OCC id + mark.
- **Evidence:** user-confirmed live 2026-10-16 (expirations + strikes load); client specs for pin removal, `expiration_dates` CSV, `data.next` pagination (10-page cap).
- **Result:** PASS

### 4. Quote auto-fill and user-typed price

- **Start:** resolved contract (scenario 3), limit order type.
- **Steps:** observe the limit price field auto-fills with the quote mark; clear it and type a custom price; change the strike; type a price again then change expiration.
- **Expected:** auto-filled price tracks contract changes; a user-typed price is never overwritten; if a new contract has no quote, an auto-filled price clears but a typed price persists.
- **Evidence:** option-ticket specs (auto-fill lifecycle, `priceAutoFilled` tracking, stale-quote suppression); live `mark_price` verified via probe (AAPL ~193.35, market-dependent).
- **Result:** PASS (spec); live mark observed

### 5. Quantity default and submit gating

- **Start:** resolved contract with auto-filled limit price.
- **Steps:** do not touch quantity → observe Submit; click the quantity up-arrow once.
- **Expected:** Submit enables immediately once contract + price guards pass; quantity field shows active 1; first up-click goes to 2 (not merely activating a hidden default).
- **Evidence:** user-confirmed live 2026-10-16; spec "default quantity enables submit without qty interaction"; staged model `quantity: '1'` matching equity.
- **Result:** PASS

### 6. Submit closes the dialog; card resting

- **Start:** submit-enabled option ticket.
- **Steps:** Submit → confirm dialog → place.
- **Expected:** dialog closes when the ticket reaches a done status (`SUBMITTED`); the order is visible at Robinhood; the card shows the live option ticket status (resting) — option tickets status the card via `decisionIds` even when contract type differs from card side.
- **Evidence:** user-confirmed live 2026-10-16 (limit order visible at RH; dialog closed on acceptance — `SUBMITTED` is in `DIALOG_DONE_STATUSES` by design); util specs for live-option card statusing + SHORT-card put.
- **Result:** PASS

### 7. Close-without-submit discards session-created tickets

- **Start:** dialog open; contract resolved on Option tab (STAGED option ticket exists); a STAGED equity ticket may also exist from the Stock tab.
- **Steps:** close the dialog without submitting (cancel/overlay) → inspect the card.
- **Expected:** every STAGED ticket created during that dialog session (equity + option) is discarded; card returns to pending; a pre-existing STAGED ticket adopted by the session is NOT discarded.
- **Evidence:** gallery-view specs (created-id `Set` tracking, discard of created-only, adopt-survives); option-ticket spec for stale-stage emit (the critical fix — a committed-but-deselected stage still emits so the host can discard it).
- **Result:** PASS (spec); user-confirmed 2026-10-16

### 8. Reopen scoping — option ticket never masquerades as equity

- **Start:** a card with only a STAGED OPTION ticket (no equity ticket).
- **Steps:** click Trade → Stock tab; click Paper on the same card.
- **Expected:** Trade stages a fresh EQUITY ticket (does not reopen the option ticket in the Stock tab); Paper stages + sends a fresh equity ticket and never attempts to paper-send the option ticket.
- **Evidence:** service specs "trade stages a fresh equity ticket when only a STAGED OPTION ticket exists", "paper ignores a STAGED OPTION ticket".
- **Result:** PASS (spec)

### 9. Reject removes staged option tickets

- **Start:** card with STAGED equity + STAGED option tickets.
- **Steps:** reject the card.
- **Expected:** both STAGED tickets are removed (REJECT decisions durable); live tickets untouched.
- **Evidence:** service spec "reject removes the card's STAGED option ticket alongside the equity one".
- **Result:** PASS (spec)

### 10. Error surfaces keep the dialog open

- **Start:** staged option ticket whose submit fails (broker rejection / permission error), or a manually FAILED ticket.
- **Steps:** submit and observe.
- **Expected:** dialog stays open on `STAGED`/`SUBMITTING`/`FAILED` (done-status watcher only closes on done states); the error surfaces on the ticket for retry.
- **Evidence:** dialog specs (stays open for STAGED/SUBMITTING, closes on done incl. removal of the bound ticket).
- **Result:** PASS (spec)

### 11. Card status line

- **Start:** card with a live option ticket (e.g. RESTING, 2 contracts @ 1.25).
- **Steps:** observe the card ticket line.
- **Expected:** option-aware line e.g. `opt 2 @ 1.25 · Resting`; equity line format unchanged.
- **Evidence:** gallery-card `ticketLine` option branch; util spec.
- **Result:** PASS (spec); user-confirmed 2026-10-16

## Negative / boundary

- Instrument list: malformed payloads and instruments without ids filtered client-side (client specs); expiration select until strike picked (disabled-state spec).
- Quote failure: contract remains orderable, mark null, auto-fill clears (option-ticket spec).
- Stale async landings guarded: superseded quote/chain resolutions dropped (seq guards, specs).
- Concurrent resolutions cannot double-stage; lock-waiting frames emit-or-adopt correctly (specs).

## Traceability

| Acceptance criterion (Task #964 / TEST doc) | Scenario |
|---|---|
| Trade opens dialog with two tabs; Stock identical; switching loses no state | 1, 2, refinement pass |
| Dialog closes when either ticket reaches a done status | 6, 10 |
| Submitted option ticket leaves card 'resting'; equity statusing unchanged | 6, 11 |
| Close-without-submit discards both tabs' STAGED tickets; card → pending | 7 |
| Expiration→strike→type contract selection with populated strikes | 3 |
| Mark quote shown in price field | 4 |
| Qty default 1 active; stepper 1→2 | 5 |
| Option ticket never adopted as stock reopen | 8 |
| Reject removes staged option tickets | 9 |

## Regression / smoke

- Equity ticket flow unchanged: stock submit, paper send, reopen, reject — service/util/component specs green (46 util + 31 service + dialog/view).
- Portfolio dashboard option marks now parse `mark_price` — spot-check option rows if any exist.
- Full suite unchanged vs baseline (42 pre-existing `order.component` failures).

## Evidence log

- `npx jest` focused 6-suite run — **230/230** (dialog, option ticket, staging util, card utils, actions service, gallery view); client **74/74**; `tsc -p tsconfig.app.json` clean.
- Live session 2026-10-16 (user): Option tab → expiration + strike select → limit price auto-filled → submit → order visible at Robinhood → dialog closed on acceptance.
- Live probes 2026-10-16: `expiration_dates` CSV filters; `state`/`tradability` pins zero results (removed); `data.next` pagination; `get_option_quotes` returns `quote.mark_price` + `close.price`.
