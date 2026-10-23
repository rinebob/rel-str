**Topic:** Manual Order Entry  
**Topic Slug:** manual-order  
**Thread:** Header Order Ticket  
**Thread Slug:** header-order-ticket  
**Issue:** #1226  
**Thread Parent:** #1178  
**Topic Parent:** #1177  
**Task:** #1190  
**Domain:** ORDER  
**Type:** UAT  
**Status:** Complete  
**Created:** 2026-10-23  
**Last Updated:** 2026-10-23  

# UAT — #1190 OptionOrderTicket manual mode + BTO/STO

## Scope

The Option tab of the manual order dialog becomes real: contract
resolution (expiration → strike → call/put, or pasted OCC id) without
any signal provenance, MANUAL ticket staging (`OPT-MAN-{BTO|STO}-{occ}`),
a Buy-to-open / Sell-to-open toggle, advisory STO collateral from
`review_option_order`, and the unchanged confirm → submit pipeline.
Also covered: the adopt/block guard keyed on {contract, side}
(source-agnostic — a signal-sourced ticket adopts/blocks identically),
the blocked-side flip, and the contract-retarget guard from the
round-3 review fix.

## Entry point

`npm start` → `http://localhost:4210` → sign in → **`/trading/live`** →
the **New Manual Order** button (top of the page) → enter a liquid
ticker (`QQQ`, `AAPL`) → **Resolve** → click the **Option** tab.
(The global header button is #1191 — not yet present.)

## Prerequisites

- Dev server running; signed in; trading config with `accountNumber`
  (same as the card-driven option path).
- **Prod Firebase + live RH account:** contract resolution writes real
  staged ticket docs; dialog close discards session-created STAGED
  tickets. Do NOT press Place except in the submit scenario — a real
  broker order may result.
- Firestore console open on `st-order-tickets` is the easiest way to
  inspect staged docs (source, side, legs, no signalContext).

## Scenarios

### S1 — Option tab renders the real form + BTO/STO toggle

- **Confirms:** manual mode mounts the option form (the #1189
  placeholder is gone); the side toggle is manual-only.
- **Steps:** manual dialog → resolve `QQQ` → Option tab.
- **Expected:** expiration select, strike select, Call/Put pills, OCC
  paste row — same pickers as card mode — plus a **Buy to open / Sell
  to open** pill row at the top (BTO active). No placeholder text.
- **Result:** **PASS** (user, 2026-10-23) — real form + BTO/STO pills render.

### S2 — Contract resolution stages a MANUAL BTO ticket

- **Confirms:** chain → instrument → quote resolution runs with no
  runId/signals/decisions; staging mints the manual identity.
- **Steps:** Option tab → pick an expiration → a strike → Call.
- **Expected:** contract line shows OCC id + RH id + Mark/Bid/Ask/Prev;
  `st-order-tickets` gains `OPT-MAN-BTO-QQQ261016C…` with
  `source: MANUAL`, `side: 'buy'`, `legs[0].side: 'buy'`,
  `legs[0].positionEffect: 'open'`, and NO `signalContext`/`sourceRef`/
  `decisionIds` fields.
- **Result:** **PASS** (user) — contract resolves; MANUAL BTO ticket stages.

### S3 — OCC paste path

- **Confirms:** a pasted OCC contract id resolves the same contract.
- **Steps:** paste `QQQ261016C00500000` (or a current valid OCC id)
  into the paste row → resolve.
- **Expected:** the same contract line + a second ticket is NOT
  created — the existing same contract+side STAGED ticket is adopted
  (queue count unchanged).
- **Result:** Not run — spec-covered (OCC paste → same resolution path).

### S4 — Flip to Sell to open → STO ticket + collateral preview

- **Confirms:** opposite side is a distinct ticket identity; the
  advisory collateral call fires.
- **Steps:** with a resolved contract bound — click **Sell to open**.
- **Expected:** a new `OPT-MAN-STO-…` doc (`side: 'sell'` on ticket +
  leg); premium row relabels to **Est. credit**; a collateral line
  appears under it — for a put (CSP): "Locks ~$X cash"; for a call
  with shortfall: "Requires ~N {SYM} shares held"; a naked call with
  `cash.infinite` shows the unlimited-risk warning. If the line is
  absent, check the network tab for `review_option_order` and record
  the response shape.
- **Result:** **PASS** (user) — STO ticket stages; Est. credit + collateral line.

### S5 — Flip back to BTO adopts the original ticket

- **Confirms:** flip-back is adoption, not a third doc.
- **Steps:** click **Buy to open** again.
- **Expected:** the form re-binds the original `OPT-MAN-BTO-…` ticket;
  `st-order-tickets` still has exactly two manual option docs (BTO +
  STO), not three.
- **Result:** **PASS** (user) — flip-back adopts, no third doc.

### S6 — Reopen adopts the same-side STAGED ticket

- **Confirms:** source-agnostic adoption — the probe does not care who
  minted the pending order.
- **Steps:** close the dialog (S2's BTO ticket survives only if it was
  adopted — a created one discards; instead: stage a BTO, close, then
  stage AGAIN → the first was discarded so a fresh one is created;
  then close is the discard check). Simpler variant: with a STAGED
  BTO in the queue, reopen the dialog, resolve the same contract+side.
- **Expected:** the form binds the existing ticket id; the queue shows
  no duplicate.
- **Result:** Not run — spec-covered (adopt path exercised by S5 + specs).

### S7 — Live same-side ticket does NOT block (parallel orders allowed)

- **Confirms:** QA-driven semantics — a live order does not prevent a
  manual order on the same contract+side (adding to a position /
  running a parallel order is legitimate user intent).
- **Steps:** submit a manual BTO (or use an existing resting option
  order on a contract) → reopen the dialog → resolve the SAME
  contract → Buy to open.
- **Expected:** a NEW `OPT-MAN-BTO-…` doc stages alongside the live
  one (different minute-keyed id); no error; Place is enabled. Each
  ticket tracks its own broker order.
- **Result:** Not run — spec-covered (parallel-stage specs, manual lane isBlocking:false).

### S8 — Contract retarget never re-legs the bound ticket (round-3 fix)

- **Confirms:** a bound ticket retargeted to a different contract is a
  different ticket identity — it unbinds and runs the adopt/stage probe
  rather than rewriting the bound ticket's legs.
- **Steps:** stage BTO on contract A (bound) → change the strike select
  to contract B (with or without a live same-side order).
- **Expected:** the contract-A ticket keeps its original legs (its
  Firestore doc unchanged; it stays STAGED, orphaned for session
  discard); the form binds a contract-B ticket — a fresh stage, or the
  adopted STAGED twin if one exists. No error; Place enabled.
- **Result:** Not run — spec-covered (retarget unbind + probe specs).

### S9 — FILLED twin does not block (scale-in allowed)

- **Confirms:** a FILLED same contract+side ticket is a position-on —
  re-staging is the deliberate scale-in case, not a conflict.
- **Steps:** arrange a FILLED manual option ticket on contract+side
  (fill an STO order, or hand-edit a doc to `status: 'filled'`) →
  resolve the same contract+side.
- **Expected:** a fresh ticket stages and binds; no error. (Same-minute
  id collisions with a non-STAGED doc still guard with "try again in a
  moment" — doc-clobber protection, not an order gate.)
- **Result:** Not run — spec-covered (FILLED does not block; twin-collision guard spec).

### S10 — Fatfinger cap gates BTO only; STO labels credit

- **Confirms:** the debit cap is inert on sell; the premium row is
  honest about direction.
- **Steps:** on a resolved contract, set a limit price whose qty×price×100
  exceeds `optionMaxPremiumCashPercent` of cash → check Place on BTO,
  then flip to STO and check again.
- **Expected:** BTO shows the fatfinger block; STO does not and shows
  "Est. credit".
- **Result:** Not run — spec-covered (fatfinger BTO-only specs).

### S11 — Submit → confirm shows SELL TO OPEN → place

- **Confirms:** the unchanged submit pipeline; the confirm dialog
  renders the sell leg correctly.
- **Steps:** on an STO ticket — set qty/limit → **Review order** →
  confirm dialog.
- **Expected:** the dialog renders a "SELL TO OPEN" leg; Place runs
  review-then-place with the ticket `ref_id`. SAFEST EXECUTION: use a
  far-OTM limit far below market so a place would rest unfilled — or
  stop before Place and mark spec-covered.
- **Result:** Not run — spec-covered (unchanged confirm pipeline; SELL TO OPEN render spec).

### S12 — Broker rejection surfaces on the ticket (optional, real call)

- **Confirms:** naked-call rejection is an ordinary submit failure.
- **Steps:** STO call on a symbol with no held shares → Review → Place.
- **Expected:** RH 400 (infinite risk) lands as the ticket's error —
  inline in the dialog, ticket goes terminal FAILED; no crash.
- **Result:** Not run — real broker rejection; spec-covered failure path.

### S13 — Close discards session-created staged tickets

- **Confirms:** cleanup semantics unchanged for option tickets.
- **Steps:** stage a BTO + an STO in one session → close the dialog.
- **Expected:** both still-STAGED docs disappear from
  `st-order-tickets`; any adopted or submitted ticket survives.
- **Result:** Not run — spec-covered (session-discard specs).

### S14 — Signal-mode regression

- **Confirms:** the card path is unchanged by the lane refactor.
- **Steps:** gallery card → Trade → Option tab → resolve + submit-path
  check only (no place).
- **Expected:** no BTO/STO pills; the card's ticket stages exactly as
  before with signalContext/decisionIds.
- **Result:** Not run — spec-covered (signal-lane specs unchanged, 208 focused green).

## Automated evidence (to be executed)

- `npx tsc --noEmit -p tsconfig.app.json` — clean.
- `npx jest option-order-ticket gallery-ticket-dialog order-execution
  manual-order --coverage=false` — focused suites.
- `npx jest --coverage=false` — full suite.

## Traceability

| Acceptance criterion (PRD §option / QA #1226) | Scenario |
|---|---|
| Chain/instrument/quote resolution without provenance | S2, S3 |
| MANUAL ticket, OPT-MAN-{BTO|STO} id, no signalContext | S2 |
| BTO/STO toggle; positionEffect user-selectable | S1, S4 |
| STO collateral surfaced before submit | S4 |
| Same-side STAGED adopts (source-agnostic); live/FILLED does NOT block — parallel orders allowed | S3, S6, S7, S9 |
| Retarget never re-legs the bound ticket; unbind + probe runs | S8 |
| Fatfinger on BTO only; Est. credit on STO | S10 |
| Submit/confirm/place unchanged; SELL TO OPEN renders | S11 |
| Broker rejection lands on ticket | S12 |
| Discard-on-close for session tickets | S13 |
| Signal-mode unchanged | S14 |

## Results log

2026-10-23 — user ran S1–S5 in-app (New Manual Order → QQQ → Option tab):
all PASS. Remaining scenarios accepted as spec-covered rather than
executed (user's call — focused suites 134/134 green post-QA-semantics
change; full suite 259/259, 4,449 tests). No manual-order defects found
in the executed slice.

## Findings / notes

- The collateral preview is advisory and silent-fails by design — an
  absent line is not itself a failure; check `review_option_order` in
  the network tab for the true response shape before judging.
- **UAT UX finding (user):** the bound-ticket gate disables the symbol
  input entirely — "Close the dialog to order a different symbol" —
  when only SUBMITTING+/confirmed states truly need it. A STAGED bound
  ticket could be unbound on re-resolve (session-created → discard,
  adopted → survives in queue) to allow in-place symbol switching.
  Refinement candidate; tracked on the QA issue.
