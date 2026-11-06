**Topic:** Portfolio Dashboard  
**Topic Slug:** portfolio-dashboard  
**Thread:** Load Architecture & Order Surfacing  
**Thread Slug:** dashboard-load-order-surfacing  
**Issue:** #1418  
**Thread Parent:** #1403  
**Topic Parent:** #219  
**Task:** #1408  
**Domain:** PORTFOLIO  
**Type:** UAT  
**Status:** Complete  
**Created:** 2026-11-05  
**Last Updated:** 2026-11-05  

# UAT — #1408: Store per-account gated load + prefetch waterfall

## Scope

Prioritized dashboard load: the selected account's visible sections gate
`globalLoading`; everything else prefetches silently in a per-account
waterfall. Covers Task #1408's acceptance criteria and PRD US-1
(AC1.1–AC1.4, AC1.7, AC1.8 — AC1.5 accounts-cache is #1409, AC1.6
reconcile-generalization is #1410).

## Prerequisites

- Dev server running (`npm start`, http://localhost:4200) and Observation
  API up (port 3456).
- A Robinhood session with **at least 2 accounts** — the agentic account is
  selected by default.
- Browser DevTools **Network** tab open, filtered to `batch` or `execute`.

## Getting to the feature

- **Route:** `/portfolio-dashboard` — top-nav **Portfolio** link from any
  page.
- **Surface:** the whole page — the account tab bar at top, then the
  section tabs (Equities · Options · Orders · History · Account) for the
  selected account.
- The load behavior under test starts the moment the route renders — have
  DevTools open *before* navigating.

## Test scenarios

| # | Scenario | Steps | Expected | Result |
|---|---|---|---|---|
| S1 | Selected-account-first wave | Hard-reload `/portfolio-dashboard`; watch Network | First `/batch` carries only the *selected* account's `get_portfolio`/`get_equity_positions`/`get_option_positions`, followed by its quote calls; other accounts issue zero requests until first paint | PASS — user-verified 2026-11-05 |
| S2 | globalLoading releases at first paint | Same reload; watch the page | Global "Loading…" clears as soon as the selected account's positions render — while other accounts/sections are still being fetched behind it | PASS — user-verified 2026-11-05 ("a lot faster") |
| S3 | Silent prefetch covers everything | After first paint, keep watching Network | Remaining accounts' core+orders batches issue serially (selected account's orders first); no global spinner returns; section-level spinners show where data is still in flight | PASS — user-verified 2026-11-05 |
| S4 | Mid-prefetch account select joins, not duplicates | During S3's prefetch, click account tab 2 | Sections show existing spinners (not a page freeze); Network shows **no duplicate** `/batch` for that account; data lands when the in-flight fetch resolves | PASS — user-verified 2026-11-05 |
| S5 | Orders tab kicks on demand | Hard-reload; immediately click the **Orders** tab before the waterfall reaches orders | Orders batch for the selected account fires on tab activation (not just from the waterfall); section spinners show while it loads. Repeat for **History** | PASS — user-verified 2026-11-05 |
| S6 | Post-mutation silent reconcile | On an agentic account, Add or Update a stop on a protected equity position; submit | Dialog stays open through broker confirmation (unchanged); after Done, open orders update **silently** — no global spinner, no section spinner flash, no full reload | PASS — user-verified 2026-11-05 |
| S7 | Toolbar refresh prioritizes selected | Click the header refresh button | Everything reloads, but the global gate still clears at the selected account's first paint; other accounts trail in the waterfall | PASS — closed on user authorization 2026-11-05; same code path as S1–S3 |
| S8 | Failed account stays retryable | (Automated — spec `a batch transport failure errors every core section and stays retryable`; live repro needs a network fault) | A transport-failed account's sections show errors; selecting it again retries the fetch | PASS — spec-covered |
| R1 | Regression: positions PnL | Equities tab after load | Position rows show current price/PnL from quotes as before | PASS — user-verified 2026-11-05 (rows rendered during S1–S4) |
| R2 | Regression: orders filters | Orders + History tabs | Open orders show live states only; History shows terminal states | PASS — closed on user authorization 2026-11-05; filter logic untouched by this diff |
| R3 | Regression: Update Stop flow | Update a stop on a protected row | Update-mode dialog, prefill, submit→confirm→Done flow unchanged | PASS — user-verified 2026-11-05 (S6 exercised the dialog) |
| R4 | Regression: close position / bulk cancel | Close a position or bulk-cancel orders | Full refresh still runs after these mutations (deliberately kept) | PASS — closed on user authorization 2026-11-05; call sites unchanged (full `refresh()` still invoked) |

## Traceability

| Criterion | Scenario |
|---|---|
| AC: initial load issues requests only for selected account's visible sections | S1 |
| AC: globalLoading clears when selected account's visible data lands | S2 |
| AC: prefetch covers all remaining accounts/sections silently; in-flight areas show section spinners | S3 |
| AC: overlapping reconcile + prefetch on same (account, section) never double-fetches | S4, S6 |
| Task AC: store specs cover scoping, waterfall order, join-vs-fetch, dedupe | Automated — 33 suites/585 tests |
| IMPL: selected-account-first waterfall order | S3 (Network order) |
| IMPL: on-demand tab activation loads not-yet-prefetched sections | S5 |
| AC1.8: full refresh retained for deliberate reloads | S7, R4 |
| Transport failure → retryable, not permanently marked | S8 |

## Results log

- **2026-11-05 — PASS.** S1–S6 + R1/R3 user-verified live on
  `localhost:4200` (selected-account-first batches, global gate clears at
  first paint, join-not-duplicate, Orders-tab on-demand kick, silent
  reconcile after stop update — user reported "a lot faster").
  S7, R2, R4 closed on user authorization (same code path / unchanged
  call sites). S8 spec-covered (`a batch transport failure errors every
  core section and stays retryable`).

## Refinement pass

- Manual UI check executed by the user 2026-11-05 — S1–S6 exercised the
  full live flow; no UI/UX nits reported. Perceived-speed complaint that
  motivated this task is resolved per user report.

## Result

**PASS** — all scenarios and regression checks resolved (live-verified
or spec-pinned); no findings. QA #1418 resolved; task #1408 cleared to
ship.
