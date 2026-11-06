**Topic:** Options Backtest  
**Topic Slug:** backtest  
**Thread:** Backtest Analytics  
**Thread Slug:** backtest-analytics  
**Issue:** #1366  
**Thread Parent:** #1266  
**Topic Parent:** #1238  
**Task:** #1377  
**QA Issue:** #1425  
**Domain:** FE  
**Type:** UAT  
**Status:** Complete  
**Created:** 2026-11-05  
**Last Updated:** 2026-11-05  

# UAT — #1377: Analysis results page

Manual QA for the exit-event matrix page that replaced the #1376 route shell. Live `st-options-analysis-results` docs exist for the SPY/AMAT/QQQ contract lists from the earlier Analyze run.

## Prerequisites

- `npm start` dev server running — open `http://localhost:4200` and sign in
- Your completed Selection Replay run (the one with AMAT/QQQ/SPY cards) has analysis result docs — i.e. a card already shows **View Results**. If a card still shows **Analyze**, click it, wait ~1 min for the flip, then proceed.

## Getting to the feature (from app root)

1. `http://localhost:4200` → sign in
2. Left sidenav → **Options** → **Backtest** → you land on `/options/strategy/backtest`
3. The **Selection Replay** section has a run list on the **left**
4. Click your completed run's row → the detail panel on the **right** shows one card per symbol (AMAT, QQQ, SPY)
5. On the **SPY** card, click **View Results** (link in the card header, far right of the status chip)
6. Browser lands on `/options/strategy/backtest/analysis/{runId}_SPY` — this IS the page under test. **There is no sidenav entry — the card link is the only UI way in** (direct URL also works).

## What the page should look like

- **Header:** `Analysis Results` heading → the list doc id in monospace (`{runId}_SPY`) → `SPY · csp-45-20` → right-aligned `Analyzed {short PT date-time}` stamp
- **Failed-banner** — only if any exit's analysis doc failed (likely none)
- **"Exit-type aggregates"** — 6-row table, registry order:
  1. Target 90% premium
  2. Exit at $1.00
  3. Exit at $0.50
  4. Stop at 200% premium
  5. Exit at 21 DTE
  6. Hold to expiration
- **"Contract events"** — chip row (`All` + a chip per exit that has a doc), then the flattened per-contract event table

## Scenarios — run in order

### S1 — Header

- **Do:** arrive via View Results on the SPY card
- **Expect:** `Analysis Results` heading; monospace `{runId}_SPY`; `SPY · csp-45-20`; `Analyzed Nov 4, 4:00 PM`-style stamp (PT-formatted, right-aligned)

### S2 — Aggregate table

- **Do:** scan the 6 rows top-to-bottom against the order list above
- **Expect per column:** Hit rate — a % (e.g. `77.8%`); Avg days — decimal days; Avg premium — % captured; Exited/Expired/Errors — integer counts; Worst MAE — number
- **Expect:** exits whose analysis succeeded show real numbers; any exit with no doc renders `'—'` in every stat cell. **FAIL if you see `NaN`, `undefined`, or an empty cell**
- **Sanity:** Hold to expiration should have Exited = 0 and Expired = contract count (it never exits early)

### S3 — Failed-doc banner (spec-pinned unless a failure exists)

- **Expect IF a doc failed:** red banner naming the exit label + reason, e.g. `Analysis failed for Exit at 21 DTE: series fetch failed`; its matrix row styled red with '—' stats; sibling rows unaffected
- **If all 6 succeeded:** mark spec-pinned, move on

### S4 — Event rows / outcomes

- **Do:** scroll the Contract events table; find one of each outcome
- **Expect:** the Outcome column reads exactly one of —
  - `exit 2026-XX-XX @ 0.25` (exit date + price, primary color)
  - `expired ITM · 0.84% away` or `expired OTM · …` (muted)
  - `error: no series` (red) — and that row's **Days / MAE / MFE cells all show '—'**
- **Expect:** MAE and MFE cells on exit/expired rows show a number **with the excursion date in smaller text directly under it**
- **FAIL if** an error row shows numbers in Days/MAE/MFE (those are placeholders, not data)

### S5 — Filter chips

- **Do:** click the `Exit at 21 DTE` chip → table narrows; click `All` → full set returns
- **Expect:** with a chip active, every row's Exit-rule cell shows that strategy's label; chip highlight moves with the click
- **Also check:** chips exist only for exits that have docs — if any aggregate row is '—'/missing, it has no chip

### S6 — Sort order

- **Expect:** pick dates ascend top-to-bottom; where the same pick date repeats (same contract evaluated under different exits), rows order by contract ID

### S7 — Deep link

- **Do:** copy the URL → open a **new tab** → paste → Enter
- **Expect:** full render without visiting the dashboard first (proves the page is list-scoped, not run-scoped)

### S8 — List switching (stale-stream guard)

- **Do:** on the SPY results page, edit the address bar — change `_SPY` to `_AMAT` (or `_QQQ`) → Enter
- **Expect:** header flips to `{runId}_AMAT` / `AMAT · csp-45-20`; tables repopulate for AMAT. **FAIL if any SPY rows linger**

### S9 — Loading / empty states (spec-pinned)

- Loading note `Loading analysis results…` flashes before docs arrive (throttle-fast locally — may be invisible)
- A list with zero result docs shows `No analysis results for this list yet — run Analyze from the run detail…`

### S10 — Stale badge (spec-pinned)

- A doc written under an older `EXIT_REGISTRY_VERSION` gets a `stale` chip next to the strategy name in both tables. Registry is v1 today — **no stale docs can exist**; first live exposure is the next registry bump

### R1–R3 — Regression

- **R1:** back on the dashboard, the card's Analyze → Analyzing… → View Results cycle still works (re-click Analyze is idempotent — reruns overwrite docs)
- **R2:** expand a card's rows → contract table + row-inspect dialog unchanged
- **R3:** click a different replay run → cards show fresh state, no leftover View Results

## Refinement pass

- Tables scroll within their caps (aggregates ~420px, events ~560px); column headers stay pinned
- Chips legible in both states; Tab → Enter activates
- Long contract IDs truncate with ellipsis — hover shows the full ID
- Outcome column colors distinguish exit / expired / error at a glance

## Automated evidence

- Backtest suites: **166/166** (13 suites), `tsc --noEmit` clean — converter (incl. fail-safe + invalid-status guards), store (stream lifecycle, stale-stream isolation, aggregates, stale flags, orphan gating, filter), component (render matrix, chips, banner, absent-param, param rebind, error placeholders, stale chips)
- Full suite: **5197/5202** — the 5 failures are uncommitted foreign work (#1363/#1419 contract-list chunks), not this diff
- Review: `1238-1366-1377-CODE-REVIEW-BACKTEST-options-backtest.md` — PASS, 2 rounds

## Results log

**2026-11-05 — PASS, all scenarios.** User ran the live checklist on the real SPY/AMAT/QQQ result docs: "this view is really good. this is what i've been waiting to see… All the uat scenarios pass with the above comments."

| Scenario | Result | Evidence/notes |
|---|---|---|
| S1 header | PASS | user-verified live |
| S2 aggregate matrix | PASS | user-verified live |
| S3 failed-doc banner | PASS | spec-pinned — all exits succeeded |
| S4 outcome rendering | PASS | user-verified live; error-row '—' confirmed |
| S5 filter chips | PASS | user-verified live |
| S6 sort order | PASS | user-verified live |
| S7 deep link | PASS | user-verified live |
| S8 list switching | PASS | user-verified live |
| S9 loading/empty | PASS | spec-pinned |
| S10 stale badge | PASS | spec-pinned — registry v1, nothing stale |
| R1–R3 regression | PASS | user-verified live |
| Refinement | PASS | user-verified live |

## Findings → follow-up task

QA surfaced 9 findings — recorded as a single follow-up task (BE contract/worker semantics + FE enhancements). Verified against `functions/src/options-analysis/records.ts` during triage:

| # | Finding | Class |
|---|---|---|
| 1 | Future-expiry contracts recorded as `error` ("series ends X before expiry Y") — they're open positions; the series can't reach an expiry that hasn't happened | **BUG (worker)** → add `open` outcome |
| 2 | Hold-to-expiry hit rate = 0 — `hitRatePct` uses `exitedCount`; expiry never "exits". Hit for `expiry` should be `expiredCount` share (~100%) | **BUG (aggregate semantics)** |
| 3 | Every expired row reads OTM — plausible for 20Δ CSPs but "all of them" warrants a data probe on `underlyingClose`/strike wiring (`expiredFields` verified correct in code) | **VERIFY (worker/data)** |
| 4 | Event table needs a total position count (positions opened) | Enhancement (FE) |
| 5 | Run params need prominence — symbol/template params, not just the doc id | Enhancement (FE; template registry lookup; startDate needs run doc or denorm) |
| 6 | Event rows need price change + % change (exitPrice/intrinsicAtExpiry − entryMark) | Enhancement (FE) |
| 7 | MAE column: add MAE as % of premium (`mae.value/entryMark`) | Enhancement (FE) |
| 8 | Aggregate table needs wins/losses per exit — semantics are template-side-dependent (CSP: expired OTM or exit < entry = win) | Enhancement (needs definition; likely worker aggregate) |
| 9 | Stop-200 rows show `expired OTM` — user expected only stopped-out rows. Matrix semantics are correct (every contract × every rule); underlying want = outcome filter | Enhancement (FE outcome filter) |
