**Topic:** Manual Order Entry  
**Topic Slug:** manual-order  
**Thread:** Header Order Ticket  
**Thread Slug:** header-order-ticket  
**Issue:** #1219  
**Thread Parent:** #1178  
**Topic Parent:** #1177  
**Task:** #1189  
**Domain:** ORDER  
**Type:** UAT  
**Status:** Complete  
**Created:** 2026-10-22  
**Last Updated:** 2026-10-22  

# UAT — #1189 GalleryTicketDialog manual mode (Stock tab)

## Scope

Manual-mode entry to the existing order-ticket dialog (#1189): a
symbol-entry row stages (or adopts) a MANUAL equity ticket through
`ManualOrderService`, then binds the same Stock tab / confirmation /
submit pipeline as card mode. The Option tab mounts with no card seed —
an honest placeholder until #1190. The user's #1017 additions inside the
same files are covered: `initialSymbol` prefill + auto-resolve, and
source-agnostic STAGED adoption / live-order blocking in
`ManualOrderService`.

## Entry point (how to open the dialog)

There is **no UI button yet** — that's #1191. Until then the only entry
point is the TEMP dev hook `window.__manualOrder` (in `src/main.ts`,
revert before commit), which exposes `ManualOrderService`.

1. `ng serve` → open `http://localhost:4210` and sign in.
2. Open browser devtools → Console.
3. Type `__manualOrder.open()` → the dialog opens on the symbol-entry
   row. Use `__manualOrder.open('AAPL')` to open prefilled + auto-resolved.

## Prerequisites

- `ng serve` running on `http://localhost:4210` (dev build).
- Signed in as the normal user; a trading config with an accountNumber
  configured (same requirement as the gallery Trade path).
- **Prod Firebase** (`useEmulators: false` in `environment.ts`):
  resolving a symbol writes a real staged ticket doc; closing the dialog
  discards tickets this session created and still has STAGED. Do NOT
  click Place Order except in the submit scenario — a real broker order
  may result if the account is live.
- Order queue is on the Signal Order page (`/trading/live`); live orders
  on the portfolio dashboard.

## Scenarios

### S1 — Manual dialog opens on the entry row (no ticket, no tabs)

- **Confirms:** manual variant opens with symbol entry before tabs.
- **Steps:** devtools → `__manualOrder.open()`.
- **Expected:** dialog titled "New Order" (symbol placeholder); a text
  input ("Ticker — AAPL, BRK.B…") + Resolve button + hint "Enter a
  ticker to stage a stock or option order." No tab group, no ticket
  form. Dialog does NOT auto-close.
- **Result:** ✅ PASS

### S2 — Invalid symbol: inline error, nothing staged

- **Confirms:** charset validation happens before any fetch/stage; the
  input stays editable.
- **Steps:** type `!!!` → Enter (or Resolve).
- **Expected:** inline error line under the input naming the bad value;
  no Stock/Option tabs; no staged ticket appears in the queue
  (`/trading/live`). Input keeps its content and stays enabled.
- **Result:** ✅ PASS

### S3 — Valid symbol: stage + Stock tab + quote strip

- **Confirms:** MANUAL equity ticket staged via the seed; Stock tab
  bound; quote strip in the shared title row.
- **Steps:** clear input → type `AAPL` → Resolve.
- **Expected:** tabs appear (Stock + Option); Stock tab shows the order
  ticket form bound to the new ticket (buy, market, quantity sized from
  the config dollar amount); the dialog title row shows AAPL with a live
  quote strip; input + Resolve disable and the hint "Close the dialog to
  order a different symbol." appears. In `/trading/live` the queue shows
  the new staged ticket.
- **Result:** ✅ PASS

### S4 — Re-resolve is gated while a ticket is bound

- **Confirms:** no silent re-bind/orphaned STAGED ticket.
- **Steps:** continuing from S3 — try typing in the input / clicking
  Resolve.
- **Expected:** input and Resolve remain disabled; no second ticket is
  staged (queue holds exactly one STAGED AAPL manual ticket).
- **Result:** ✅ PASS

### S5 — Option tab mounts the manual placeholder

- **Confirms:** Option tab mounts without a card seed — placeholder, not
  the signal staging form; no MCP/chain calls are burned.
- **Steps:** continuing from S3 — click the Option tab.
- **Expected:** "Manual option orders aren't available yet — coming in a
  follow-up update." No expiration/strike selects, no error snackbar
  ("all occurrences rejected" must NOT appear).
- **Result:** ✅ PASS

### S6 — Adopt vs create (discard tracking)

- **Confirms:** a pre-existing STAGED ticket for the symbol is reopened
  (`created:false`) and survives dialog close; only session-created
  tickets are discarded.
- **Steps:** with S3's staged ticket present, close and reopen via
  `__manualOrder.open('AAPL')` (or type AAPL + Resolve).
- **Expected:** the dialog binds the SAME ticket id (check the queue —
  no second AAPL ticket was created). Close again — the adopted ticket
  remains in the queue (it predates this session).
- **Result:** ✅ PASS

### S7 — Seeded open: `initialSymbol` auto-resolve (#1017)

- **Confirms:** `open('SYM')` prefills + resolves straight through.
- **Steps:** `__manualOrder.open('MSFT')`.
- **Expected:** dialog opens already resolving/bound — input contains
  MSFT (disabled), tabs render, no manual Resolve click needed.
- **Result:** ✅ PASS

 ⏭ SKIP — no non-STAGED equity ticket existed to test against; covered by manual-order.service.spec.ts live-order block spec

### S9 — Close discards the session's staged ticket

- **Confirms:** discard-on-close for created tickets still STAGED.
- **Steps:** `__manualOrder.open('QQQ')` → wait for bind → close the
  dialog (X / backdrop / Escape).
- **Expected:** the QQQ staged ticket disappears from `/trading/live`.
- **Result:** ✅ PASS

 ⏭ SKIP — live-submit not exercised; confirmation panel + View-order routing are spec-covered

### S11 — Card-mode regression

- **Confirms:** card path unchanged.
- **Steps:** gallery card → Trade (or open a `?ticket=` deep link on
  `/trading/live`).
- **Expected:** the equity/option tab group renders exactly as before —
  no symbol-entry row; View order still routes to `/trading/live` with
  `?ticket={id}`.
- **Result:** ✅ PASS

## Automated evidence (executed)

- `npx jest gallery-ticket-dialog option-order-ticket manual-order --coverage=false`
  — **111/111 PASS** (34 dialog incl. initialSymbol auto-resolve +
  vanish-reset + bound-gate; 48 option incl. manual zero-MCP mount; 29
  service incl. any-source adoption + live-order block).
- Full suite: 255/257 suites green; the two flagged suites (option spec
  + option-chain integration) pass on clean rerun — mid-edit artifacts.
- `tsc --noEmit -p tsconfig.app.json` clean.

## Traceability

| Acceptance criterion (issue #1189) | Scenario |
|---|---|
| Manual variant opens; entry before tabs | S1 |
| Valid symbol → MANUAL ticket, Stock tab, quote strip | S3 |
| Invalid/unresolvable → inline error, nothing staged, editable | S2, S3 seed-null path |
| Tabs post-resolution; Option tab needs no card seed | S5 |
| `onStaged` created:true/false; adopted → false | S6 (+service spec) |
| Submit + confirmation unchanged | S10 (+dialog spec store-transition) |
| Manual View-order → portfolio dashboard; card `?ticket=` kept | S10, S11 |
| Re-resolve gated while bound; confirmation clears on vanish | S4 (+spec) |
| Specs green; card-mode specs stay green | Automated evidence |

## Results log

**2026-10-22 — QA PASS.** S1–S7, S9, S11 verified manually in the
running app via the `__manualOrder` dev hook (entry row, inline error,
stage+bind+quote strip, bound-gate, Option placeholder, adopt-on-reopen,
discard-on-close, seeded open, card-mode unchanged). S8/S10 skipped —
spec-covered, no live ticket / real-order risk. Console showed only
pre-existing AngularFire warnOutsideInjectionContext noise. Console
confirmed the expected call chain: resolveSymbol → stageEquityTicket →
fetchPrices → Firestore commit → ensureAccount.

## Findings / notes

- TEMP `__manualOrder` hook in `src/main.ts` — **revert before commit**.
- Deferred from review: `open()` silent-swallow during config await;
  store bare→`liv_` rekey race (F2); `runId===''` sentinel + ungated
  non-fetch option effects — #1190 territory.
