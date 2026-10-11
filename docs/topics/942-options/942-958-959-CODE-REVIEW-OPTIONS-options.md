**Topic:** Options Trading Support  
**Topic Slug:** options-trading-support  
**Thread:** Single-leg option orders  
**Thread Slug:** single-leg-option-orders  
**Issue:** #958  
**Thread Parent:** #943  
**Topic Parent:** #942  
**Task:** #959  
**Domain:** OPTIONS  
**Type:** CODE-REVIEW  
**Status:** Complete  
**Created:** 2026-11-10  
**Last Updated:** 2026-11-10  

# CODE-REVIEW — #959 Option ticket model + TradingConfig field

## Verdict: PASS

One major finding flagged independently by the Spec and Thermo-nuclear axes
— remediated in-review and covered by a new spec. No outstanding critical or
major findings; minors/nits fixed in place or deferred to their owning tasks.

## Scope under review

| File | Change |
|---|---|
| `services/order-ticket.types.ts` | `OptionLeg` rework (`type`→`side`, +`optionId`, +`positionEffect`, +`ratioQuantity?`); `OptionOrderTicket` +`symbol` (underlying); `TradingConfig` +`optionMaxPremiumCashPercent?` |
| `services/trading-config.service.ts` | load/save passthrough for the new field |
| `stores/order-ticket.store.ts` | `ticketsBySymbol` uses `ticket.symbol` directly; attribution-seeding guard made explicit (in-review fix) |
| `stores/order-ticket.store.spec.ts` | `mockOptionTicket` + 4 new tests (hydration, legs merge, grouping, no option seeding) |
| `components/order-queue/order-queue.component.spec.ts` | 3 fixtures updated to new leg shape |
| `components/gallery-ticket-dialog/…ts`, `utils/gallery-card-actions.util.ts` | stale comments corrected (in-review fix) |

Pre-existing uncommitted work in the same files (PLACEMENT_DEAD refId-minting
block + its tests) was excluded from scope.

## Standards

No hard violations. `OptionLeg` matches the live `place_option_order` schema
exactly (required `option_id`/`side`/`position_effect`, optional
`ratio_quantity`) — verified against `docs/topics/657-rh-mcp/captures/01-live-tools-list.json`.
New tests assert observable behavior at the store seam; no type-erasure (the
`as Partial<OptionOrderTicket>` cast is the file's established convention for
`Partial<Omit<union>>` non-distribution, commented).

## Spec — all acceptance criteria MET

- OptionLeg/OptionOrderTicket rework + `'symbol' in` narrowing coverage — MET.
- `optionMaxPremiumCashPercent` optional, default-25 documented — MET.
- Hydration/`updateTicket` round-trip specs — MET.
- No migration needed — MET (no OPTION ticket has ever been persisted; submit
  is blocked upstream).
- `trading-config.service.ts` passthrough — in-scope (a field nothing reads
  or writes is dead), not creep.

## Thermo-nuclear

Clean tests; one real latent trap (major, below). `ratioQuantity?` justified —
matches the RH leg contract. `symbol` namespace split (ticket = underlying,
leg = OCC) is documented at both levels; a `displaySymbolFor(ticket)` helper
is a candidate once the option ticket component exists (#963).

## Findings remediated in-review

- **major** — `order-ticket.store.ts` fill-seeding loop used `'symbol' in
  ticket` as an implicit option-excluder; the new `symbol` field armed it —
  a FILLED option ticket would seed attribution keyed by the underlying
  ticker. Replaced with an explicit `instrumentType !== OPTION` continue +
  new spec proving option tickets never seed attribution.
- **minor/nit** — stale comments ("option tickets carry no symbol",
  "carry no signalContext", leg symbol "display/grouping") corrected;
  invalid OCC fixture string `AAPL 260918C150` → `AAPL  260918C00150000`;
  mismatched-namespace grouping fixture commented.

## Findings deferred (owner tasks)

- `removeStagedTicketForSymbol` sweep now includes option tickets — intended
  per PRD provenance parity; confirm during #964.
- `symbolFor`/`priceFor`/`hasProtection` OCC-vs-underlying masking in
  order-queue — benign while options aren't submittable; revisit in #964.
- `optionMaxPremiumCashPercent` default lives in a comment; consumer (#963)
  must apply `?? 25` — per convention.

## Test results

Touched suites: 105/105 green (`order-ticket.store.spec`, `order-queue`).
`tsc -p tsconfig.app.json` clean. Full suite: 3440 pass / 43 fail — all
failures in `order.component.spec.ts` (missing `Functions` provider) and
`screenshot-capture-contracts.spec.ts` (stale `PositionType` assertion),
both traced to unrelated uncommitted screenshot work in the worktree —
pre-existing, not caused by this diff.

## Round 2 — convergence pass on the fixed diff

All round-1 remediations verified (explicit `instrumentType` guard +
no-seed spec, comment corrections, OCC fixture format, namespace-mismatch
fixture comment).

| Finding | Disposition |
|---|---|
| LOW — two remaining `'symbol' in t` dead-probe sites (`order.component.ts:382,534`) — same latent class: always-true narrowing on the retiring page | **Fixed** — simplified to `t.symbol` |

No other new defects surfaced: the attribution guard's `instrumentType`
check precedes `ticket.symbol` so narrowing is provable; the no-seed spec
asserts both FILLED transition and zero `seedFromTicket$` calls;
`removeStagedTicketForSymbol` sweep semantics and the `symbolFor` display
helper remain deferred to #964 as recorded.

**Stopped at 2 rounds** — one LOW, fixed. Post-fix: 45/45 store spec,
tsc clean.
