**Topic:** Portfolio Dashboard  
**Topic Slug:** portfolio-dashboard  
**Thread:** Load Architecture & Order Surfacing  
**Thread Slug:** dashboard-load-order-surfacing  
**Issue:** #1434  
**Thread Parent:** #1403  
**Topic Parent:** #219  
**Task:** #1409  
**Domain:** PORTFOLIO  
**Type:** UAT  
**Status:** Complete  
**Created:** 2026-11-06  
**Last Updated:** 2026-11-06  

# UAT — #1409: get_accounts session cache + bootstrap warm

QA issue: #1434 — QA: get_accounts session cache + bootstrap warm  
Review: `219-1407-1409-CODE-REVIEW-PORTFOLIO-portfolio-dashboard.md` (PASS, 2 rounds)

## Getting to the feature

- **Route (primary):** `/portfolio-dashboard` — entry point: top-nav
  **Portfolio** link. You land on the account tab bar with section tabs
  (Equities, Options, Orders, History, Account).
- **Route (secondary):** `/trading/live` — entry point: top-nav
  **Live** link, then the page's config button opens the Trading Config
  dialog (its account select is a `getAccounts` consumer).
- **Sign-out path:** header **Log out** button → `/login`, then sign in
  again — this exercises the pass-2 session-boundary invalidation.
- **Evidence surface:** DevTools Network tab, filter `get_accounts` (and
  `batch` for ordering vs the dashboard's first load batch). The tool
  call travels over the observation API (port 3456), not the app port.

## Automated evidence (already pinned, not re-run live)

- Single-flight: concurrent `getAccounts()` callers share one
  `executeTool('get_accounts')` call — client spec.
- Cache hit: second and later calls issue zero wire calls — client spec.
- Failure clears the slot — next call retries — client spec.
- `invalidateAccounts()` drops a resolved entry → next call refetches —
  client spec (pass-2 addition).
- Auth-gated warm: no call before `isAuthenticated`, one after;
  sign-out → invalidate → re-auth re-warms — core component spec.
- `trading-config.service` delegation keeps `agenticAllowed` filter —
  service spec (21 tests, unchanged mocks).

## Live scenarios

| # | Scenario | Steps | Expected | Result |
|---|---|---|---|---|
| S1 | Warm fires early post-auth | Hard-reload the app while signed in → Network filtered `get_accounts` | Exactly **one** `get_accounts` fires early (right after auth), *before* the dashboard's first `/batch` | **PASS** — user-verified live |
| S2 | Dashboard reuses the warm | Watch the dashboard's initial load complete | The dashboard issues **no** additional `get_accounts` — its account tab bar paints from the cached/warm promise | **PASS** — user-verified live |
| S3 | Re-navigation is free | Navigate away (e.g. **Live**) then back to **Portfolio** | **Zero** new `get_accounts` calls on every re-navigation | **PASS** — user-verified live |
| S4 | Trading-config dialog shares the cache | Open **Live** → config button → account select | Account list populates; **no** new `get_accounts` in Network | **PASS** — user-verified live |
| S5 | Sign-out boundary (pass-2) | **Log out** → sign in again → Portfolio | A **new** `get_accounts` fires post re-auth — the previous user's cache was invalidated | **PASS** — user-verified live |
| S6 | No functional regression | Dashboard initial load + account switch + section tabs | Positions/orders paint exactly as before; no new console errors | **PASS** — user-verified live |

## Negative / boundary coverage (spec-pinned, not re-run live)

- Rejected warm can't poison the session (catch clears slot, dashboard
  retries on its own call).
- A rejected entry shared by N concurrent callers rejects for all of
  them — no caller is left hanging.
- Effect re-fires (auth churn) are free while a resolved entry exists.

## Results log

**Run 1 — 2026-11-06 — all scenarios PASS** (user-verified live against
the dev server; "ok all uat passes"). No findings. Result: **PASS**.
