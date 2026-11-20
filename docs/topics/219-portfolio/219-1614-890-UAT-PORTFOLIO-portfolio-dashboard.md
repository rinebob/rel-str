**Topic:** Portfolio Dashboard  
**Topic Slug:** portfolio  
**Thread:** Update Stop Loss  
**Thread Slug:** update-stop-loss  
**Issue:** #1614  
**Thread Parent:** #829  
**Topic Parent:** #219  
**Task:** #890  
**Domain:** PORTFOLIO  
**Type:** UAT  
**Status:** Complete  
**Created:** 2026-11-18  
**Last Updated:** 2026-11-19  

# UAT — #890 Audit Stops (peak-exposure batch tighten)

## Scope

The preview-gated **stop audit** on the Portfolio Dashboard Equities
tab: a max-giveback input → an audit preview listing every updatable
stop's peak since entry, current stop, exposure %, disposition, and
proposed floor → sequential per-order tighten-only updates through the
`updateEquityStopOrder` primitive → per-order summary with retry.
Covered: `computeStopUpdateCandidates` exposure/disposition logic,
`UpdateAllStopsService` sequencing/abort/retry, the
`UpdateAllStopsDialogComponent` three-step flow, and the Equities-tab
**Audit Stops** toolbar button. Not covered: per-row Update Stop
(#888, already live), stop-limits (intentionally ineligible —
`isUpdatableStopOrder` excludes them), and per-position giveback
persistence (a deferred thread — the giveback is entered per run).

**Audit semantics:** a stop's exposure is `(peak − stop) / peak`, where
peak is the position's highest day-bar high since entry
(`PositionPeak.lifetime`). Exposure beyond the giveback ⇒ the stop is
"exposed" and proposed at `peak × (1 − giveback)`. "Exposed" and
"needs tightening" are the same test — the batch can never loosen a
stop. Positions with no derivable peak audit as "no peak" and are
skipped.

## Prerequisites

- Signed-in user with **agentic allowed** (same gate as Add Stop /
  Update Stop) and a Robinhood account holding at least one equity
  position protected by a resting **stop-market** sell order.
- Known-good anchors (from the #1411 audit, 2026-11-10): resting stops
  on **SCHB** ($27.66), **RS** ($412.22), **MSFT** ($514.42). Any one of
  these — or any other resting stop — satisfies the prerequisite.
- The dev server is already running; test against it at
  `http://localhost:4200`.
- S4 issues **real broker calls**: confirming actually cancels and
  re-places the exposed stops at the proposed floor. Review every
  proposed price before confirming.

## Getting to the feature

Route `/portfolio` → sign in → **Equities** tab → pick the account
holding the stops → the **Audit Stops** button sits in the toolbar row
directly above the equity positions table (right-aligned, outline
button).

## Automated evidence

- `portfolio-pnl.util.spec.ts` — 73 pass (10 audit specs: exposure,
  within-policy, exact-boundary, cent-precision, lifetime-vs-
  sinceLastFill anchoring, ladder, eligibility gate, no-peak, underived
  lifetime, no stop price)
- `update-all-stops.service.spec.ts` — 15 pass (sequence order, ticket
  shape incl. order-quantity + GTC + regular_hours + `stop_loss_update`,
  abort → not-run, full phase-retry matrix incl. place-phase re-place
  and PLACEMENT_DEAD fresh refId, zero-share → skipped, exception
  safety, stale-row + concurrency guards)
- `update-all-stops-dialog.component.spec.ts` — 12 pass (input
  validation, audit preview rows incl. within-giveback row, confirm →
  service ctx, live results, retry gating, close semantics, real-
  service integration)
- `portfolio-dashboard.component.spec.ts` — 59 pass (button gating,
  dialog data incl. peaks, reconcile-on-close)
- Full `src/app/features/portfolio-dashboard` — **37 suites / 724
  tests green**; `tsc --noEmit -p tsconfig.app.json` clean.

## Scenarios

### S1 — Button visibility and gating

| Step | Expected |
|---|---|
| Equities tab, account with a resting stop-market protective stop | **Audit Stops** button enabled, tooltip "Audit every updatable stop against its position peak (preview first)" |
| Account with positions but **no** resting stops | Button disabled, tooltip "No updatable protective stops on this account" |
| Non-agentic account | Button not rendered at all |

### S2 — Max-giveback input validation

| Input | Expected |
|---|---|
| Dialog opens | Default `8` in the "Max giveback from peak" field; helper text explains the audit (peak since entry, tighten-only) |
| Clear the field | **Audit** button disabled; error "Enter a giveback between 0 and 90%." |
| `0`, `-5`, `91`, `abc` | Audit disabled; error shown |
| `8`, `0.5` | Audit enabled |

### S3 — Audit preview correctness (the core check)

Enter `8` → **Audit**. For every row verify:

| Check | Expected |
|---|---|
| Row count | One row per resting updatable stop (SCHB, RS, MSFT if all held + protected) |
| Peak column | Shows "peak $X.XX" — the position's highest high since entry |
| Exposure | "N.N% off peak" — hand-check one: `(peak − stop) / peak`. E.g. a stop at $27.66 against a $30.08 peak ⇒ 8.0% |
| Disposition | Exposure > 8% ⇒ "exposed — tighten" (amber) + proposed price = `peak × 0.92`; exposure ≤ 8% ⇒ "within giveback" + "—" for proposed |
| Header | "8% giveback — N of M stops are exposed." |
| Confirm button | "Tighten N Stops", disabled when N = 0 |

Sanity-check a **compliant** row: e.g. MSFT stop $514.42 — if its peak
since entry is under ~$559, exposure is under 8% and the row shows
"within giveback" with no proposed price.

If any position has no derivable peak (transferred shares, no entry
fill in history), its row shows "no peak" and is skipped — not counted
in N. If a stop's proposed floor sits **at/above the current mark**
(the position already retraced past the giveback), the row shows
"above market" and is skipped — a sell-stop there would trigger
immediately on placement, so it's left for a manual decision. If the
**Audit** button shows "Position peaks are still deriving" it is
disabled until peak derivation completes — wait a few seconds and
reopen the dialog.

If every row is compliant or skipped, the preview footer reads
"Nothing to tighten — X within giveback, Y skipped" (not a blanket
"within the giveback" claim).

### S4 — Sequential execution and summary

⚠ **Real broker calls.** From an S3 preview with ≥1 exposed row:

| Step | Expected |
|---|---|
| Click **Tighten N Stops** | Progress line "Updating {SYMBOL}…" — orders process one at a time, not in parallel |
| Each exposed row | Lands "tightened" with its proposed price |
| Compliant / no-peak rows | Show their skip disposition — untouched, no cancel placed |
| Finish | "Update run complete — N tightened · M failed · K not attempted." → **Done** |
| Back on dashboard | Stop column shows new prices; orders reconcile in background (no full reload) |
| Broker side | Exposed stops replaced at `peak × (1 − giveback)`, GTC, regular_hours, same per-order quantity |

### S5 — Order-quantity preservation (conditional)

Only if a symbol carries **two** stops (currently 1/symbol on the
anchors): each replacement carries **its own order's** whole-share
quantity, not the full position — verify no over-quantity ticket.

### S6 — Abort, UNPROTECTED, and retry (conditional / observational)

Spec-covered; not forceable without risking a real unprotected
position. If a live failure occurs: the run aborts, later rows show
"not run", the failed row shows "failed" (or "failed — UNPROTECTED" if
the cancel landed), and a per-row **Retry** appears only where the
service contract allows.

### S7 — Regression: per-row Update Stop and Add Stop unchanged

- Per-row **Update Stop** on a protected position still opens the
  update-mode dialog (peak context header present).
- **Add Stop** on an unprotected position still opens add mode.

### S8 — Peaks-pending gate

Open the Audit Stops dialog immediately after a hard reload (before
`positionPeaks` resolves), or throttle the network so derivation is
still in flight.

| Step | Expected |
|---|---|
| Open dialog mid-derive | Input step shows "Position peaks are still deriving — try again in a moment." |
| Audit button | Disabled while pending; enabled once derivation completes — close + reopen to pick up resolved peaks |
| Rationale | Prevents a premature audit reporting every row "no peak" under a misleading banner |

Note: `positionPeaks.data` always contains an entry per held symbol once
derivation completes (`{lifetime: null}` for underivable symbols), so the
gate cannot deadlock — pending is only ever transient.

## Manual UI/UX refinement pass

- Audit copy reads correctly: "giveback", "exposed", "within giveback"
  — no leftover "trail below current price" language.
- Preview table is scannable: peak / stop → proposed / exposure /
  disposition columns align at the anchors' price ranges
  ($27–$515).
- Dialog remains usable while a run is in flight (Cancel disabled,
  Done gated).

## Findings

None yet. (Review Round 2 remediated 12 minors in-gate — see the
CODE-REVIEW doc's Round 2 section; the UI behaviors it added are the
new S3/S8 checks above.)

## Traceability

| #890 acceptance criterion | Where proven |
|---|---|
| One action audits every protected position's stop against its peak since entry | S3 |
| Global max-giveback input, validated | S2 |
| Preview shows peak, stop, exposure, disposition, proposed floor | S3 |
| Only exposed stops updated; compliant/no-peak skipped | S3, S4 |
| Floor at/above mark skipped — no immediate-trigger placement | S3, util spec (skip-above-market) |
| Peaks still deriving → Audit gated, not a vacuous no-peak audit | S8 |
| Tighten-only — never loosens | S3 (boundary), util specs |
| Sequential, abort-safe, per-order retry | S4, S6 |
| Replacement order semantics preserved (own qty, GTC, regular_hours) | S4, S5 |
| Positions-table per-row Update / Add Stop unchanged | S7 |

## Regression / smoke

- S7 covers adjacent stop surfaces.
- Dashboard load, tab switching, and orders reconcile all unaffected
  (button + dialog are additive; reconcile reuses the existing
  `'orders'`-only path).

## Verdict

**PASS** — tester-reported live UAT pass on all executed scenarios
(2026-11-19); no findings filed. Automated evidence green.

## Results log

| Date | Tester | Result | Notes |
|---|---|---|---|
| 2026-11-19 | automated | PASS | `npx jest src/app/features/portfolio-dashboard` — 37 suites / 734 tests green; `npx jest --coverage=false` — 324 suites / 6116 tests; `tsc --noEmit -p tsconfig.app.json` clean; `ng build` clean. New behavior specs pin: skip-above-market, negative-giveback clamp, non-finite peak, peaksPending gate (dialog + dashboard), retry progress symbol, reset(), no-ticket canRetry, sequential in-flight=1. |
| 2026-11-18/19 | bob (interactive) | partial PASS | Confirmed live: dialog opens from Audit Stops button and renders input step; 620px width fix verified; phantom scrollbar removed; Equities table scroll hierarchy verified with `?pad=20` (header pinned, body scrolls, no horizontal scrollbar, toolbar fixed). NOT yet eyeballed post-remediation: audit preview rows, giveback validation, run/summary flow, still-deriving gate, above-market label, counts summary. |
| 2026-11-19 | bob (live UAT) | PASS | Tester reported UAT passes across the live scenarios — button gating (S1), giveback validation (S2), preview correctness incl. dispositions (S3), sequential run → counts summary → Done → silent orders reconcile with updated Stop column (S4), per-row Update/Add Stop regression (S7). Conditional rows: S5 not exercised (no same-symbol stop ladders held); S6 not forceable without risking a real unprotected position — spec coverage stands; S8 transient gate not forceable on this run. No findings filed. |
