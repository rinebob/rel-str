# Implementation Plan — FE: Single-leg option orders

**Topic:** Options Trading Support  
**Topic Slug:** options-trading-support  
**Thread:** Single-leg option orders  
**Thread Slug:** single-leg-option-orders  
**Issue:** #948  
**Thread Parent:** #943  
**Topic Parent:** #942  
**Domain:** OPTIONS  
**Type:** IMPL  
**Status:** Draft  
**Created:** 2026-10-11  
**Last Updated:** 2026-10-11  

Single-area plan: **FE only**. The Robinhood MCP backend pass-through
(`/api/rh/tools/{tool}`) already exposes `get_option_chains`,
`get_option_instruments`, `get_option_quotes`, `review_option_order`,
`place_option_order`, `cancel_option_order`. `TradingConfig` is an
FE-owned Firestore doc — the new field is a type-level addition, no
migration.

## Boundary

Everything lands under `src/app/features/savant-trader/` plus:

- `src/app/core/robinhood-mcp/robinhood-mcp-client.service.ts` — two new
  typed methods (same `ToolSpec` pattern as `getOptionPositions`).
- `src/app/features/savant-trader/pages/option-chain/` — a "copy
  contract" affordance on the chain page.

## Files

```
features/savant-trader/
  services/order-ticket.types.ts          — OptionLeg + OptionOrderTicket rework; TradingConfig field
  services/order-execution.service.ts     — submitOptionOrder
  services/order-execution.service.spec.ts
  core/robinhood-mcp/robinhood-mcp-client.service.ts  — getOptionChains, getOptionInstruments
  core/robinhood-mcp/types/robinhood-mcp.types.ts     — OptionChain, OptionInstrument types
  stores/order-ticket.store.ts            — submitTicket routes OPTION
  stores/order-ticket.store.spec.ts
  utils/gallery-card-actions.util.ts      — findCardTickets accepts OPTION
  utils/gallery-card-actions.util.spec.ts
  stores/gallery-card-actions.service.ts  — discard all STAGED tickets on dialog close
  components/gallery-ticket-dialog/       — mat-tab-group + two-ticket close tracking
  components/order-confirm-dialog/        — option contract summary rendering
  utils/option-ticket-staging.util.ts     — NEW: buildOptionSignalTicket (mirrors signal-order-staging.util)
  utils/option-ticket-staging.util.spec.ts
  utils/option-contract.util.ts           — NEW: paste parse + OCC→RH resolution args, premium math
  utils/option-contract.util.spec.ts
  components/option-order-ticket/         — NEW: option tab component (ts/html/scss/spec)
  pages/option-chain/option-chain.component.* — NEW: copy-contract affordance
```

## Ticket model (`order-ticket.types.ts`)

Additive rework — option tickets have never been persisted, no migration:

```ts
export interface OptionLeg {
  side: 'buy' | 'sell';                 // renamed from `type` — matches RH leg field
  symbol: string;                       // OCC contract symbol — display/grouping only
  optionId: string;                     // RH instrument UUID — ordering identity
  positionEffect: 'open' | 'close';
  ratioQuantity?: number;               // reserved multi-leg; always 1 / omitted in v1
}

export interface OptionOrderTicket extends BaseOrderTicket {
  instrumentType: InstrumentType.OPTION;
  /** Underlying ticker — NOT the OCC symbol. Required so the existing
   *  `ticketsBySymbol` grouping ('symbol' in ticket) puts the ticket
   *  under the card's symbol unchanged. */
  symbol: string;
  legs: OptionLeg[];                    // exactly 1 in v1
  quantity: string;                     // contracts, positive integer string
  price?: string;                       // limit price per contract
  stopPrice?: string;                   // reserved
}
```

Base fields reused as-is: `timeInForce` ('gfd'|'gtc' — same union),
`marketHours` (fixed `'regular_hours'` at build/form level), `orderType`
('limit'|'market' subset in v1), `side: 'buy'`, `signalContext`,
`bucketId`, `refId`, `source`/`sourceRef`.

`TradingConfig` gains:

```ts
/** Fatfinger cap for option orders — max fraction of available cash a
 *  single option order's premium (qty × price × 100) may consume.
 *  Default 25 when absent. */
optionMaxPremiumCashPercent?: number;
```

## MCP client additions (`robinhood-mcp-client.service.ts`)

Two typed methods following the existing `ToolSpec` + `run` pattern:

- `getOptionChains(symbol)` → `get_option_chains { underlying_symbol }` →
  parse list → `OptionChain[] { chainId, symbol, expirationDates[], settleOnOpen? }`.
  Response field names are unverified — read them from a live call or the
  captured catalog response shape during implementation; parse
  defensively (`extractList` variants like existing specs).
- `getOptionInstruments(filters)` → `get_option_instruments
  { chain_symbol, expiration_dates?, strike_price?, type?, state: 'active' }` →
  `OptionInstrument[] { instrumentId, chainSymbol, type, strikePrice,
  expirationDate, occSymbol? }`. Cursor pagination exists on the tool;
  v1 fetches the first page per expiration (strikes at one expiration are
  far under a page) — flag if a page boundary ever matters.

`getOptionQuotes(instrumentIds)` already exists — reuse for mark/ask.

## Contract resolution (`utils/option-contract.util.ts`)

Pure helpers, fully unit-tested:

- `chainsToExpirations(chains)` — union/sort expiration dates.
- `selectsToInstrumentArgs(symbol, expiration, strike, type)` →
  `get_option_instruments` args.
- `parseOptionPaste(text)` → `{ symbol, expiration, strike, type }` —
  parse an OCC contract id via the existing `parseOccContractId`
  (`@options-contract/contracts`, already used by
  `OptionsContractService.parseOccId`), tolerating pasted whitespace/
  formatting. Returns `null` on unparseable input — the UI shows an
  inline error, no throw.
- `premiumNotional(qty, price)` → `qty × price × 100`.
- `fatfingerBlock(premium, availableCash, percent)` → boolean.

Resolution inside the component: selects produce (expiration, strike,
type) → `getOptionInstruments` → take the single active tradable result
→ `instrumentId`. Paste produces the same triplet via `parseOptionPaste`
→ same call. Both paths converge on `getOptionQuotes` for mark.

## Staging util (`utils/option-ticket-staging.util.ts`)

`buildOptionSignalTicket(...)` — pure builder mirroring
`buildSignalOrderTickets`:

- `signalContext`/`decisionIds` built identically from the card's
  non-rejected occurrences (canonical `buildStOccurrenceDecisionId`
  per occurrence; first id → `decisionId`, all → `decisionIds`).
- `source: SIGNAL_PIPELINE`, `sourceRef: { type: 'occurrence_decision', id }`.
- `status: STAGED`, `side: 'buy'`, `orderType: 'limit'`,
  `timeInForce: 'gfd'`, `marketHours: 'regular_hours'`.
- `symbol` = card underlying; `legs: [{ side: 'buy', symbol: occSymbol,
  optionId, positionEffect: 'open' }]`; `quantity: ''` (user fills).
- `refId` minted once at stage; `id` via `buildTicketId`-style unique id
  suffixed for the instrument (`{SYMBOL}-OPT-...`) to keep ids
  human-readable and distinct from the equity ticket's.

## Store + action service (`order-ticket.store.ts`, `gallery-card-actions.service.ts`, `gallery-card-actions.util.ts`)

- `submitTicket`: remove the OPTION snackbar block; route
  `instrumentType === OPTION` → `orderExecution.submitOptionOrder`
  (same SUBMITTING → SUBMITTED/STAGED-revert machinery — the equity
  revert/PLacement-classification logic is instrument-agnostic and
  should be factored so both paths share it).
- `ticketsBySymbol`: unchanged — `OptionOrderTicket.symbol` (underlying)
  groups correctly via the existing `'symbol' in ticket` branch.
- `findCardTickets`: drop the `instrumentType === OPTION` early-return so
  an option ticket statuses its card (resting/settled/failed). The
  `side !== card.side` check still applies — an option ticket is
  `side: 'buy'`; a SHORT signal card would not match. Decision: the
  card-side check should compare on signal direction, not ticket side —
  for v1, allow option tickets to status whichever card's decisionIds
  match (the decisionIds test is the real linkage; the side test exists
  for equity's symbol+side dedupe). Implement by skipping the side check
  for OPTION tickets.
- `tradeCard`/dialog close: discard **all** still-STAGED tickets for the
  card (equity + option), not just the one id — extends
  `discardStagedTicket` semantics via `findCardTickets`.

## Execution (`order-execution.service.ts`)

`submitOptionOrder(ticket: OptionOrderTicket): Promise<ExecutionResult>`
mirroring `submitEquityOrder`:

- Preflight `review_option_order` → `place_option_order` with
  `ref_id = ticket.refId`.
- Args builder: `{ account_number, legs: [{ option_id, side,
  position_effect }] , type, quantity, price?, time_in_force,
  market_hours: 'regular_hours' }`. `price` present only for
  limit/stop_limit; `direction` omitted (single-leg derived); no
  `ratio_quantity` (default 1) or send it explicitly = 1.
- Result parse: read `id`/`state` from the place response via the same
  defensive parse as equity (`parseBrokerOrder` tolerant path +
  `cumulative_quantity` fallback). Option order responses may nest legs —
  the parse only needs order id + state.
- Same classification: `extractToolError` → `classifyError`,
  `PLACEMENT_UNCONFIRMED` / `PLACEMENT_DEAD` codes, dead/live state sets.
- Factor the shared submit machinery (review→place→classify→result) so
  equity and option paths differ only in tool names + arg builders —
  do not copy-paste the 100-line method.
- `cancelOptionOrder` already exists.

## Gallery ticket dialog (`components/gallery-ticket-dialog/`)

- Template: `mat-tab-group` inside `mat-dialog-content`.
  - Stock tab: existing `<app-order-ticket>` unchanged.
  - Option tab: `<app-option-order-ticket>` inside
    `ng-template matTabContent` (lazy — no chain calls until activated).
- `GalleryTicketDialogData` gains an `optionSeed` — the precomputed
  staging inputs the action service already has (`symbol`, `runId`,
  non-rejected `occurrences`, `accountNumber`) — so the option tab never
  re-derives card context.
- The option component emits `(staged)=ticketId` once it persists; the
  dialog keeps `optionTicketId` signal and the close-on-done effect
  watches **both** the equity ticket and the option ticket (close when
  either reaches a DIALOG_DONE status).
- The equity `symbol`/`price` computed stays scoped to the equity ticket;
  dialog title should reflect the active tab (e.g. `AAPL Order Ticket`).

## Option order ticket component (`components/option-order-ticket/`)

Inputs: `seed: OptionTicketSeed`, `tradingConfig`. Output:
`(staged): string` (ticket id), `(submitted)` optional for future use.

Form (Material, matching `order-ticket` styling):

- **Contract row**: expiration `mat-select` ← `getOptionChains`; strike
  `mat-select` ← `getOptionInstruments(expiration)`; call/put
  `mat-button-toggle-group`.
- **Paste field**: `mat-input` + Import button — `parseOptionPaste` →
  resolve → populate the selects to match (or show inline error).
- **Resolved contract summary**: OCC symbol, mark (from
  `getOptionQuotes`), estimated premium `qty × mark-or-limit × 100`.
- **Order row**: quantity (integer ≥1), order type (limit|market),
  limit price (required when limit), TIF (gfd|gtc — forced `gfd` on
  market), bucket select (reuse the same bucket-picker pattern from
  `order-ticket.component` — `allocStore.byAccount()` options).
- **Submit**: gated on contract resolved + valid qty/price + fatfinger
  pass → opens `OrderConfirmDialogComponent` → on confirm,
  `stagingStore.submitTicket(optionTicketId)`.
- **Lifecycle**: on first contract resolution → `buildOptionSignalTicket`
  → `ticketStore.stageTicketAndWait` → emit `staged`. Subsequent form
  edits → `updateTicket` merges (legs replaced when contract changes,
  refId preserved). The component binds `ticketStore.tickets()[id]` so
  status/error surfaces in place.
- **Available cash**: `PortfolioService.getSnapshot(accountNumber,
  defaultDollarAmount)` once on tab activation → `cash` — the fatfinger
  check `premium ≤ cash × (optionMaxPremiumCashPercent ?? 25) / 100`
  blocks submit with an inline message (same severity:'block' pattern as
  `evaluateOrderGuardrails`).
- **Errors**: chain/instrument load failures show an inline state with
  retry; account lacking `option_level_2`/`agentic_allowed` surfaces the
  RH error verbatim on submit (v1 does not pre-gate on option_level —
  `get_accounts` doesn't expose it today; surfacing the broker error is
  honest and cheap).
- Loading flags per stage (chain → instruments → quote); selects disable
  while upstream loads.

## Confirm dialog (`order-confirm-dialog/`)

Extend the option branch (it currently shows only `legs[0].symbol`):
underlying + OCC symbol, expiration · strike · call/put, BUY TO OPEN,
qty contracts, order type, limit price per contract, total premium
(qty × price × 100). Read-only rows matching the existing layout.

## Chain-page copy affordance (`pages/option-chain/`)

On the chain cell popup (or the selected-contract surface once #571
lands), add a small "Copy contract" action writing the OCC contract id
to `navigator.clipboard`. Payload = raw OCC id string — the Option tab
parses it. One-liner UI; the popup already displays the full contract.

## Sequence / phases

Suggested task split (to-tickets will cut phases):

1. **Types + client + utils** — ticket model, `getOptionChains`/
   `getOptionInstruments`, `option-contract.util`, staging util,
   TradingConfig field. Pure + spec'd; no UI.
2. **Execution** — `submitOptionOrder`, `submitTicket` routing,
   confirm-dialog option summary.
3. **Option ticket component** — form, selects, paste, resolution,
   lazy staging, fatfinger, bucket, submit.
4. **Dialog + actions + chain page** — tab group, two-ticket close,
   discard-all-STAGED, `findCardTickets` OPTION acceptance, copy-contract
   button.

## Prior art / regression

- `order-ticket.component.spec`, `order-execution.service.spec`,
  `order-ticket.store.spec`, `signal-order-staging.util.spec`,
  `robinhood-mcp-client.service.spec` establish style (jest-preset-
  angular, `jest.fn()`, stub Firebase providers, macrotask flush).
- `option-positions-table.component` / `portfolio-dashboard.store.spec`
  show option read-path expectations.
- Stock tab must be regression-identical: same staged ticket, same form,
  same submit → confirm flow. Dialog tests cover tab switching without
  form-state loss.
- `findCardTickets` change: option tickets must not break equity card
  statusing (side-check skip is OPTION-only).
- Paper path untouched: `isPaperEligibleTicket` stays equity-only.

## Open seams / deferred

- **Option-order reconciliation** — ticket→FILLED lives on the retiring
  signal-order page and is equity-only. In v1 a submitted option ticket
  leaves the card at 'resting'; live order state is managed via the
  portfolio dashboard. Landing spot for option reconciliation is a
  later decision.
- **`AccountInfo` lacks `option_level`** — v1 surfaces broker errors
  rather than pre-gating; extending `get_accounts` parsing is a later
  refinement if the broker error proves opaque.
- **Option chain pagination** — instruments at one expiration are
  assumed to fit a page; add cursor handling only if a symbol proves
  otherwise.
- Sell-to-open, multi-leg, exercise, stops, paper, presets — deferred
  per PRD.
