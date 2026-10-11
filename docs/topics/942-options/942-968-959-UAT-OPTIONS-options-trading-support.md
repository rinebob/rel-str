**Topic:** Options Trading Support  
**Topic Slug:** options-trading-support  
**Thread:** Single-leg option orders  
**Thread Slug:** single-leg-option-orders  
**Issue:** #968  
**Thread Parent:** #943  
**Topic Parent:** #942  
**Task:** #959  
**Domain:** OPTIONS  
**Type:** UAT  
**Status:** Complete  
**Created:** 2026-11-10  
**Last Updated:** 2026-11-10  

# UAT — #959 Option ticket model + TradingConfig field

Types/persistence task — the option ticket model became orderable-shaped and
the fatfinger config field exists. There is **no user-facing surface**; every
acceptance item is verifiable from the command line or via specs. Manual
UI/UX acceptance lives on #963 (option ticket component) and #964 (dialog
tabs).

## Prerequisites

- Repo checkout with `node_modules` installed (`npm install`).
- No credentials, emulators, or network access needed — all checks run
  against Jest mocks and the TypeScript compiler.

## Scenarios

### 1. Option ticket type model compiles and is structurally correct

- **Feature:** `OptionLeg` carries `side`, `optionId`, `positionEffect`,
  `ratioQuantity?`, OCC `symbol` (display only); `OptionOrderTicket` carries
  `symbol` (underlying).
- **Steps:** `npx tsc -p tsconfig.app.json --noEmit`
- **Expected:** exit 0, no errors.
- **Result:** PASS — clean typecheck (2026-11-10).

### 2. Hydration round-trips the new leg fields

- **Feature:** a persisted `OptionOrderTicket` doc hydrates into the store
  with `legs[0].optionId` / `positionEffect` / `side` intact.
- **Steps:** `npx jest src/app/features/savant-trader/stores/order-ticket.store.spec.ts --coverage=false`
- **Expected:** test "hydrates an option ticket preserving leg
  optionId/positionEffect/side" passes; suite is 45/45.
- **Result:** PASS — 45/45 (2026-11-10).

### 3. `updateTicket` merges updated option legs

- **Feature:** editing a staged option ticket's legs persists via the merge
  path (`Partial<Omit<OrderTicket,'instrumentType'>>` + variant cast).
- **Steps:** same spec file — test "round-trips updated option legs through
  the merge".
- **Expected:** local ticket's legs replaced; `ticketService.updateTicket`
  called with the new legs.
- **Result:** PASS (2026-11-10).

### 4. `ticketsBySymbol` groups option tickets under the underlying

- **Feature:** a signal-linked option ticket lands in the card's symbol
  bucket, not under the OCC contract string.
- **Steps:** same spec file — test "groups an option ticket under its
  underlying symbol, not the OCC leg symbol" (fixture deliberately pairs
  underlying `AAPL` with a `QQQ` contract leg).
- **Expected:** `ticketsBySymbol()['AAPL']` contains the option ticket;
  no group key equals the OCC symbol.
- **Result:** PASS (2026-11-10).

### 5. `optionMaxPremiumCashPercent` round-trips through TradingConfigService

- **Feature:** the fatfinger guardrail field is configurable — `loadConfig`
  maps it from the doc, `saveConfig` writes it when set and omits it when
  unset.
- **Steps:** `npx jest src/app/features/savant-trader/services/trading-config.service.spec.ts --coverage=false`
- **Expected:** "maps optionMaxPremiumCashPercent from the stored doc",
  "returns undefined … when the doc predates the field", "writes
  optionMaxPremiumCashPercent to the config doc", "omits
  optionMaxPremiumCashPercent when unset" all pass; suite 14/14.
- **Result:** PASS — 14/14 (2026-11-10).

### 6. A FILLED option ticket never seeds position attribution

- **Feature:** the fill-seeding loop uses an explicit `instrumentType`
  guard — an option ticket's `symbol` (underlying) can't seed attribution
  on the wrong instrument identity.
- **Steps:** `order-ticket.store.spec.ts` — test "a filled OPTION ticket
  with bucketId does not seed — the position key is the underlying, not a
  contract".
- **Expected:** ticket reaches FILLED; `seedFromTicket$` is not called.
- **Result:** PASS (2026-11-10).

### 7. No `'symbol' in t` probes remain

- **Feature:** every prior `in`-probe site (the pattern that armed the
  round-1 major) now narrows by `instrumentType` or reads `t.symbol`
  directly.
- **Steps:** `grep -rn "'symbol' in\|\"symbol\" in" src/app --include=*.ts`
- **Expected:** no matches in `savant-trader` ticket-handling code.
- **Result:** PASS — zero matches (2026-11-10).

## Traceability

| Acceptance criterion | Scenario |
|---|---|
| OptionLeg/OptionOrderTicket rework, union narrowing covers options | 1, 4, 7 |
| `optionMaxPremiumCashPercent` optional, default-25 documented | 1, 5 |
| Hydration/`updateTicket` round-trips new fields | 2, 3 |
| No persisted-data migration needed | 1 (no OPTION doc can exist — submit is blocked upstream) |
| FILLED option ticket never seeds attribution (review fix) | 6 |

## Regression / smoke

- `order-queue.component.spec.ts` — 60/60 green; option rows still render
  contract count + OCC leg symbol.
- `gallery-cards.util.spec.ts`, `paper-ticket.util.spec.ts` — green;
  option tickets remain excluded from equity aggregates and paper flow
  (unchanged behavior).
- Full suite note: 43 pre-existing failures in `order.component.spec.ts`
  (missing `Functions` provider) and `screenshot-capture-contracts.spec.ts`
  (stale `PositionType` assertion) — unrelated uncommitted screenshot work,
  not caused by this task. Must be resolved independently before ship.

## Refinement pass

Not applicable — no user-facing surface in this task.
