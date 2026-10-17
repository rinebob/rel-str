**Topic:** Options Trading Support  
**Topic Slug:** options-trading-support  
**Thread:** Single-leg option orders  
**Thread Slug:** single-leg-option-orders  
**Issue:** #1053  
**Thread Parent:** #943  
**Topic Parent:** #942  
**Task:** #965  
**Domain:** OPTIONS  
**Type:** UAT  
**Status:** Complete  
**Created:** 2026-10-16  
**Last Updated:** 2026-10-16  

# UAT — #965 Chain-page copy-contract button + dialog layout pass

## The problem this solves

You're scanning the Option Chain and spot a contract you want to trade — say the QQQ Oct 16 2026 $600 call. To open a ticket for it you have to get that contract into the Signal Gallery's order dialog. Before this change the only way was re-selecting expiration → strike → call/put by hand in the ticket and hoping you picked the same contract you were looking at. Now you hover the chain cell, open its detail popup, hit copy, and paste the OCC id straight into the Option tab's contract field — the ticket resolves the exact contract you were looking at.

The same QA pass covers a layout rework of that order dialog: the underlying's identity and live quote moved into the title row, the option ticket's top block now narrates the contract as you build it (exp · sym · strike · type → OCC id → Robinhood instrument id → live quote line), and the dialog was widened and de-padded so the ticket fits without scrolling.

## Prerequisites

- `npm start` — runs `scripts/start-dev.mjs`, which spawns **both** the Angular dev server (`ng serve`, app at `localhost:4200`) and the Robinhood MCP Observation API (`localhost:3456`). One command; nothing else to launch.
- Logged in with a Robinhood-linked account — the chain page and order dialog both hit the observation API.
- An optionable underlying with liquid contracts (QQQ and AAPL are the usual test beds).
- For the gallery half: at least one signal card in the Signal Gallery (needs a recent signal run — the usual dev data has some).

## Start instructions

- Option Chain page: `/options/chain` — pick a symbol, the chain grid loads.
- Signal Gallery: `/dev/gallery` (nav: "Gallery (Dev)") — cards with signals; **Trade** on a card opens the order dialog with Stock | Option tabs.
- Chain cell interaction: hover any populated cell → an info icon appears in the cell corner → hover the icon → contract detail popup opens.

## Test scenarios

### 1. Pointer path — copy button reachable and functional

- **Start:** option chain loaded; no popup open.
- **Steps:** hover a contract cell → hover its info icon → popup opens → move the pointer into the popup (icon → popup travel) → click the copy button next to the contract id → paste into a text field.
- **Expected:** popup stays open during pointer travel; copy button flashes a check icon for ~1.5 s; the pasted string is the raw OCC id (e.g. `QQQ261016C00600000`).
- **Evidence:** grid spec "icon-leave → popup survives while hovered, closes after leaving"; popup spec asserts `writeText` called with the exact OCC id and the check icon appears; user-confirmed live 2026-10-16 ("works like a charm").
- **Result:** PASS

### 2. Paste round-trip into the Option ticket

- **Start:** copied OCC id from scenario 1.
- **Steps:** `/dev/gallery` → Trade on a card → Option tab → paste into the contract field.
- **Expected:** the field resolves the contract via `parseOptionPaste` — the top block fills in: contract line, OCC id, RH instrument id, quote line.
- **Evidence:** spec round-trips the captured `writeText` argument through the real `parseOptionPaste`; user-confirmed live 2026-10-16.
- **Result:** PASS

### 3. Popup closes normally on leave; no leaks on rapid hopping

- **Start:** popup open.
- **Steps:** move the pointer off the popup entirely → wait ~300 ms → popup closes. Then sweep the pointer quickly across several cells' icons.
- **Expected:** the popup closes after the grace window once nothing inside it (or its icon path) is active; rapid hopping never leaves a stuck popup or stacked overlays.
- **Evidence:** grid spec for grace-close; destroy-scope spec for pending-timer cleanup; `clearHoverOnModel` cancels anchor on rebuild.
- **Result:** PASS — user-confirmed live 2026-10-16 (rapid hopping smooth, no stuck/stacked popups)

### 4. Keyboard path — Enter arms focus, Escape closes

- **Start:** a cell's icon armed (click the cell once).
- **Steps:** Tab to the armed icon → popup opens on focus → Enter → focus lands on the popup's copy button → Enter copies → Escape → popup closes and focus returns to the icon. Space on the icon behaves like Enter.
- **Expected:** focus never drops to `<body>`; the popup survives the icon's real `focusout` (relatedTarget = copy button cancels the close); Escape refocuses the armed icon without reopening.
- **Evidence:** grid specs use real `icon.focus()` so `document.activeElement` and genuine `focusout`/`relatedTarget` drive the guards — Enter→copy-button focus, focus-inside suppresses close from BOTH popup-leave and icon-leave paths, Escape closes + refocuses; `suppressFocusOpen` prevents the refocus reopening the popup.
- **Result:** PASS — user-confirmed live 2026-10-16 (Tab → Enter → copy → Escape → refocus works end-to-end)

### 5. Copy failure surfaces a snackbar

- **Start:** popup open (clipboard denial simulated — the spec mocks a rejecting `writeText`).
- **Steps:** click copy with `writeText` rejecting.
- **Expected:** snackbar "Could not copy contract id"; check icon does NOT appear; `copied` state stays false.
- **Evidence:** popup spec (rejected `writeText` → `MatSnackBar.open`, no check icon).
- **Result:** PASS (spec)

### 6. Cell A→B hop resets copy feedback

- **Start:** popup open on cell A; copy clicked (check icon showing).
- **Steps:** hop to cell B's icon within the grace window so the same popup instance re-binds.
- **Expected:** the check icon clears immediately — cell B never shows cell A's `copied` state; the in-flight continuation from A's write does not flag B.
- **Evidence:** popup spec for the `copied`-reset effect + `copyId` cell-mismatch bail.
- **Result:** PASS (spec)

### 7. Dialog header — title, identity, quote strip

- **Start:** `/dev/gallery`, a card for a symbol with a profile (e.g. QQQ · Invesco QQQ Trust).
- **Steps:** click Trade → observe the title row.
- **Expected:** title reads `Order ticket`; the same row right-aligns `{SYM} · {company name}` with a quote strip underneath — last price, change (abs + %, colored), prev close, bid, ask. Missing bid/ask renders cleanly.
- **Evidence:** dialog specs (subtitle identity, quote fields, missing bid/ask); user-confirmed live 2026-10-16 ("we'll go with that").
- **Result:** PASS

### 8. Option ticket contract block builds live

- **Start:** dialog open, Option tab active.
- **Steps:** pick expiration → strike → call/put; watch the top block as the instrument resolves and the quote lands.
- **Expected:** line 1 builds live `{exp} {sym} {strike} {CALL|PUT}` with `—` placeholders until picked; line 2 `OCC …` once the triplet is complete; line 3 `RH {instrumentId}` after resolution; line 4 `Mark / Bid / Ask / Prev` when the quote lands. The old `symbol / Option — buy to open / STAGED` header is gone; no duplicated underlying line in the body.
- **Evidence:** option-ticket specs (placeholder rendering, OCC-before-resolve, RH id + quote line, quote-failure drops the line while keeping the RH id); user-confirmed live 2026-10-16.
- **Result:** PASS

### 9. Limit-price auto-fill preserved; typed price never clobbered

- **Start:** resolved contract with a quote (mark auto-fills the limit price).
- **Steps:** observe the auto-fill; clear and type a custom price; change the strike.
- **Expected:** auto-filled price tracks contract changes; a user-typed price is never overwritten.
- **Evidence:** option-ticket specs (`priceAutoFilled` lifecycle); carried from #964's verified behavior.
- **Result:** PASS (spec + prior live confirmation)

### 10. Dialog fits without scrolling at the new dimensions

- **Start:** dialog open on Option tab with a resolved contract (the tallest state).
- **Steps:** observe the dialog at a normal desktop viewport; shrink the window toward small viewports.
- **Expected:** no content scrollbar at the widened size on a normal viewport; at small viewports the content scrolls inside the dialog as designed.
- **Evidence:** dialog spec for the widened config; user-confirmed live 2026-10-16 ("much better").
- **Result:** PASS

## Negative / boundary

- Clipboard API absent/denied → snackbar path (scenario 5 spec).
- Focus inside the popup suppresses teardown from every leave path — icon-leave AND popup-leave route through the `schedulePopupHide` `containsFocus` choke point (round-2 review fix, spec-pinned).
- Escape refocus targets a live icon only — if the icon was unarmed the refocus safely no-ops; `suppressFocusOpen` is `try/finally`-scoped and can't leak.
- Timers are `DestroyRef`-scoped on both sides (grid hide timer, popup copied timer); destroy-with-pending-timer spec proves no leak.
- The overlay panel class and the guard selectors share constants — a rename can't silently break the guard.

## Traceability

| Acceptance criterion (#965 + folded-in layout work) | Scenario |
|---|---|
| Copy control reachable from the contract detail surface | 1, 4 |
| Clipboard payload is the raw OCC id; paste resolves via `parseOptionPaste` | 1, 2 |
| Popup survives icon→popup pointer travel; closes after grace on leave | 1, 3 |
| Keyboard: Enter focuses copy button; focus inside prevents teardown; Escape closes + refocuses | 4 |
| Copy failure surfaces a snackbar; check icon only on success | 5 |
| Dialog header: `Order ticket` + `{SYM} · {company}` + quote strip | 7 |
| Option ticket: live contract line → OCC → RH id → quote line; old header gone | 8 |
| Mark auto-fill; typed price never overwritten | 9 |
| Dialog fits without scrolling at the widened size | 10 |

## Regression / smoke

- Cell hover/click behavior otherwise unchanged: icon arming, intra-cell suppression, popup content rows — covered by the existing grid/popup suites.
- `DelegatedCellHover` untouched — the pct-change pane's popup consumer unaffected (unchanged signature, no popup to bridge to).
- Stock tab price binding unchanged — `EquityPriceService.prices` map preserved alongside the new `quotes` map (service spec).
- Portfolio option marks still parse `mark_price` — MCP spec expectations updated for `bidPrice`/`askPrice`.

## Evidence log

- `npx jest option-chain` — **20 suites, 482/482** (includes both review rounds' coverage: real-focus keyboard path, hoisted focus guard, copied-reset, destroy-scope, Escape/Space bindings).
- Focused dialog/option-ticket/equity-price/mcp-client runs — 144/144 (dialog header specs, contract-block specs, quote parsing).
- `npx tsc --noEmit -p tsconfig.app.json` — clean.
- Live session 2026-10-16 (user): chain popup copy button → paste into Option tab resolves ("works like a charm"); dialog header + layout ("much better", "we'll go with that"); rapid icon-hopping and full keyboard traversal confirmed 2026-10-16 ("lgtm").
- Code review (2 rounds): `942-958-965-CODE-REVIEW-OPTIONS-options.md` — PASS.
