**Topic:** Paper Trading Infra  
**Topic Slug:** paper-trading-infra  
**Type:** UAT  
**Status:** Draft — user-executed gate for the whole feature  
**Created:** 2026-10-01  
**Last Updated:** 2026-10-01  

# UAT — Paper Trading end-to-end

**Companion doc:** `553-AS-BUILT-PAPER-TRADING-paper-trading-infra.md` — each
section below maps to it. The per-task UATs in this directory stay as
engineering evidence; this doc is the *user* gate.

**Scope note:** this is the deferred manual pass — backend settlement/mark
behavior gets observed here through its UI and Firestore effects, per the
"test the backend when we test the frontend" decision on #729.

## Prerequisites

- App running against **prod** (this exercises the live paper ledger — it is
  a simulation, nothing here touches real orders).
- Signed in as your own user (paper account is per-user).
- Firestore console access for the two or three checks the UI can't show.
- **Time-gated rows** are marked ⏳ — the scheduled passes only run on their
  cadence (mark pass ~30 min during market hours, fills at noon PT, stats +
  settlement nightly). Do those checks the next day; same-day results for
  them are "not yet," not "fail."

## A. Signal → paper (entry paths)

| # | Scenario | Steps | Expected |
|---|---|---|---|
| 1 | Single accept | `/trading/live` → stage a ticket with signal context → edit quantity → **Accept as Paper** → confirm | Ticket gets a teal **PAPER** badge and stays in the list. No real order is placed. |
| 2 | Equity leg fills immediately | Check the just-accepted trade on `/trading/paper` | Equity trade is `OPEN`, priced at the live quote, quantity matches what you edited on the ticket |
| 3 | Expression trades queued | Same cohort | 2 additional trades `PENDING` (LONG signal → CSP + LC; SHORT → SC + LP) |
| 4 | Batch send | Check several staged tickets → **Send N to paper** | Button shows eligible count only, disables while sending; each ticket gets the PAPER badge |
| 5 | Idempotency | Re-accept the same signal (if the UI allows a retry) | No duplicate cohort — the callable dedups on `refId` |
| 6 | Paper tickets are provenance | Bulk "remove selected" over the queue | Paper tickets are skipped, not deleted |

## B. Expression fills ⏳

| # | Scenario | Steps | Expected |
|---|---|---|---|
| 7 | Noon-PT fill pass | After the next noon-PT fill pass, check the PENDING expression trades | Each is `OPEN` with a real contract selected within its delta/DTE band (CSP ~0.30Δ put, LC ~0.50Δ call, etc.) |
| 8 | Fill economics | Inspect a filled expression trade | Entry fill at a plausible mid-market price; account cash moved the right direction (credit for shorts, debit for longs) |

## C. Dashboard (`/trading/paper`)

| # | Scenario | Steps | Expected |
|---|---|---|---|
| 9 | Header stats | Open the dashboard | Cash / Equity / Realized / Unrealized / Capital Required / Open count all render; negatives show red |
| 10 | Header math | Cross-check | Open count = number of `OPEN` trades in the table; Realized equals sum of closed trades' P&L (spot-check) |
| 11 | Group-by pivots | Cycle Group by: instance / cohort / variant / expression / symbol | Table repivots correctly; groups look sane |
| 12 | Equity curve scope | Click the chart icon on a group | Curve re-points at that group's stats scope |
| 13 | Cohort drill-down | Group by cohort → expand your cohort from A | Trades grouped by expression; each shows legs, last mark, governing variant outcome |
| 14 | Equity curve populated ⏳ | After at least one nightly stats pass | Curve renders points (not empty); cumulative P&L shape matches the realized story |

## D. Marks & exits ⏳

| # | Scenario | Steps | Expected |
|---|---|---|---|
| 15 | Marks refresh | Watch an open option trade across a couple of mark-pass ticks (during market hours) | `lastMark` / unrealized P&L move with the option price |
| 16 | Governing trailing stop | On a trade whose mark moved favorably then reversed ≥8% | Trade `CLOSED` at the mark; realized P&L booked; variant run shows EXITED with the exit date/price |
| 17 | Stop doesn't fire early | A trade that hasn't reversed 8% stays open | Still `OPEN`; the water mark tracked correctly in the run's working state |

## E. Settlement ⏳ (the #720/#724 behavior)

| # | Scenario | Steps | Expected |
|---|---|---|---|
| 18 | No zombies | Dashboard, any strategy or signal option trade past expiration | None sit `OPEN` past expiry — expired = `EXPIRED` |
| 19 | OTM expiry | An OTM option position that expired | `EXPIRED`; full premium kept (short) / full debit lost (long); close dated to the last trading day on/before expiration |
| 20 | Weekend/holiday expiry | A position whose expiration fell on a non-trading day | Settled at the *last trading day's* close; `closeDate`/marks dated to that trading day, not the run date |
| 21 | Engine ITM honesty (#728) | If an engine trade ever expires ITM before #728 lands | It stays `OPEN` with a logged error — must NOT silently settle `EXPIRED_WORTHLESS`. (Expected failure mode, not a pass/fail trap: the trade waits for the checker.) |
| 22 | Signal ITM expiry | A signal-source option that expired ITM | `CLOSED` at net intrinsic — realized P&L reflects intrinsic value, not worthless |

## F. Strategy instance lifecycle

| # | Scenario | Steps | Expected |
|---|---|---|---|
| 23 | Create instance | Strategy Builder (`/options/strategy/build`) → configure + pick governing variant → save | Instance saves; dashboard "Group by instance" will show it once trades exist |
| 24 | Position opens ⏳ | Next market day at the instance's `openTimePT` | A new `OPEN` engine trade appears with the selected contract |
| 25 | Governing variant honored | Inspect the launched trade's variant run | Carries the `trailing-{pct}` you configured (or `trailing-8` default if you left it unset) |
| 26 | Pause behavior | Set the instance `PAUSED` | No *new* positions open; existing ones still mark/evaluate/settle |

## G. Known-limitation spot checks (confirm they're true, not bugs)

| # | Scenario | Steps | Expected |
|---|---|---|---|
| 27 | No close/cancel UI | Look for a close or cancel control on the dashboard | Absent — by design today (`closePaperTrade`/`cancelPaperTrade` callables exist, unwired) |
| 28 | Negative cash allowed | If you've sold more than bought | Cash can go negative and stays visible — not hidden, not an error |
| 29 | Empty state | A user/account with no paper trades | "No paper trades yet…" message renders |

## Results

| # | Result | Notes / evidence |
|---|---|---|
| 1–29 | *pending* | *fill in during execution* |

## Verdict

*pending*

**Filed during this UAT:** (triage findings land here as `BUG:` issues under
Topic #553 via `/proj triage`)
