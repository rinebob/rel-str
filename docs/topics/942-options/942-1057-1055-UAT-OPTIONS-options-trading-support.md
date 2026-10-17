**Topic:** Options Trading Support  
**Topic Slug:** options-trading-support  
**Thread:** Single-leg option orders  
**Thread Slug:** single-leg-option-orders  
**Issue:** #1057  
**Thread Parent:** #943  
**Topic Parent:** #942  
**Task:** #1055  
**Domain:** OPTIONS  
**Type:** UAT  
**Status:** Complete  
**Created:** 2026-10-18  
**Last Updated:** 2026-10-18  

# UAT — #1055 Option-chain deep link + gallery-card `Option chain ↗`

## Problem statement

You're scanning Signal Gallery and a card for, say, TSLA catches your eye — you want to see its option chain before deciding what to trade. Before this task there was no bridge: you had to leave the gallery, navigate to the Option Chain page, clear whatever symbol happened to be loaded, type TSLA, and hit Load. Now every gallery card carries an `Option chain ↗` link in its action row that opens that card's symbol's chain in a new browser tab — the gallery session (and any open order dialog) stays put. The chain page also accepts `/options/chain?symbol={SYM}` as a direct deep link from anywhere.

## Prerequisites

- Dev stack running the normal way: `npm run start` (spawns `ng serve` on `:4200` + the Robinhood Observation API on `:3456`)
- Logged in with a Robinhood-linked account so Signal Gallery has cards
- At least one gallery card for an optionable underlying (QQQ, AAPL, TSLA, …)

## Scenarios

### 1. Card → chain, the primary journey

1. Open the app → Signal Gallery (`/dev/gallery`).
2. Find a card — note its symbol.
3. On the card's action row (Trade / Reject / Paper / Chart …), click **`Option chain ↗`** — it sits at the far right, separated from the decision buttons.
4. **Expect:** a new browser tab opens at `/options/chain?symbol={that symbol}` and the chain loads that symbol — no typing, no clearing a leftover symbol.
5. **Expect:** the original gallery tab is untouched — card, filters, and any open order dialog are exactly where you left them.

### 2. It's a real link

- Right-click `Option chain ↗` → "Open link in new tab" works; middle-click works; the browser status bar previews the URL on hover.

### 3. Deep link works standalone

- Paste `/options/chain?symbol=TSLA` directly into the address bar → TSLA's chain loads.
- `/options/chain` (no param) → existing default/persisted symbol behavior, unchanged.
- `/options/chain?symbol=` (empty) → same default behavior.
- `/options/chain?symbol=ZZZZZ` → the same error surface you'd get typing a bad symbol into the header input — no silent fallback.

### 4. Independent of card state

- On a card whose Trade/Reject/Paper buttons are disabled (non-actionable run), `Option chain ↗` still works — it's navigation, not a decision action.

### 5. The full copy-paste loop (the reason this exists)

1. Card → `Option chain ↗` → chain tab loads the symbol.
2. Hover a contract cell → info icon → popup → **copy** the OCC id.
3. Back on the gallery tab → Trade → **Option** tab → paste the contract id → resolves.

### 6. Stay-on-page param handling (spec-covered)

- While on `/options/chain?symbol=AAPL`, type a different symbol + Load → later unrelated navigation does **not** silently revert your choice (spec-pinned via `distinctUntilChanged` on the param).
- Navigating to a different `?symbol=` while on the page reloads the chain for the new symbol.

## Automated evidence

- `npx jest option-chain gallery-view gallery-card gallery-ticket-dialog gallery-group` — **30 suites / 692 tests** green, incl. 6 deep-link specs (exactly-one load, absent/empty param, param change, no-reload on unchanged param, stale-param revert protection, param removal) and 2 card specs (href+`target="_blank"`, reachable while actions disabled).
- `npx tsc --noEmit -p tsconfig.app.json` — clean.
- Code review: `942-958-1055-CODE-REVIEW-OPTIONS-options.md` — **PASS**.

## Results

| # | Scenario | Result | Notes |
|---|---|---|---|
| 1 | Card `Option chain ↗` → new tab, chain loaded, gallery untouched | ✅ PASS | Confirmed live by user |
| 2 | Real anchor — middle-click / right-click new tab | ✅ PASS | Confirmed live by user |
| 3 | Direct deep link / no-param / empty / invalid | ✅ PASS | Confirmed live by user |
| 4 | Works while decision actions disabled | ✅ PASS | Confirmed live by user |
| 5 | Full loop: chain → copy OCC → paste into Option tab | ✅ PASS | Confirmed live by user |
| 6 | Manual symbol choice survives later emissions | ✅ spec | `option-chain.component.spec` — stale-param + param-removal specs |

**Outcome:** QA PASS — no findings.
