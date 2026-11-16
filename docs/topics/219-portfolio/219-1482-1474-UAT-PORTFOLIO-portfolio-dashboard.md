**Topic:** Portfolio Dashboard  
**Topic Slug:** portfolio  
**Thread:** Load Architecture & Order Surfacing  
**Thread Slug:** load-architecture-order-surfacing  
**Issue:** #1482  
**Thread Parent:** #1403  
**Topic Parent:** #219  
**Task:** #1474  
**Domain:** PORTFOLIO  
**Type:** UAT  
**Status:** Complete  
**Created:** 2026-11-13  
**Last Updated:** 2026-11-13  

# UAT — Position feeds walk pages to exhaustion (#1474)

## Scope

Every position fetch truncated to page 1 — same latent class fixed for
orders in #1411/#1462. `get_equity_positions`/`get_option_positions`
accept `cursor` on the documented contract, so a large account would
silently lose positions past page 1. All three consumers now ride the
orders machinery: client page specs + `walkPages` (typed methods +
`getEquityPositionsRaw`), the store's generalized `runPagedBatch` (with
`get_portfolio` riding the round-0 batch), and
`PortfolioService.getSnapshot`.

**Honest scope note:** the account under test fits one page — the walk
is *latent*. A single-page response carries no `data.next`, so the
executed wire path is identical to before; the multi-page behavior is
spec-pinned, not live-verifiable here. Manual acceptance therefore
verifies the narrow set of things specs cannot: **real-app DI wiring**
(`PortfolioService` now injects `RobinhoodMcpClient` — a mock-covered
TestBed can't catch a missing provider) and **no visible-path
regression** on the refactored batch machinery.

**Acceptance criteria:**

1. All positions (not just page 1) populate every consumer — latent;
   spec-pinned, manually unverifiable on this account.
2. Verbatim cursor round-trip; mid-walk failure errors only that
   section; transport failure errors all core sections and stays
   retryable — spec-pinned.
3. `get_portfolio` still rides the first batch — spec-pinned (tool-order
   assertion); observable in the network panel as one `/batch` per
   section group.
4. `PortfolioService.getSnapshot` keeps null-on-failure + parallel
   fetch — spec-pinned; the happy path is manually visible (S2).
5. No user-visible regression on `/portfolio` or `/trading/live` — the
   manual legs below.

## Prerequisites

- Dev server running: `npm start` (this run came up on
  `http://localhost:4210`; the start script picks a free port — check
  its `Local:` output line).
- An authenticated Robinhood MCP session + the observation API on
  `http://127.0.0.1:3456` (`npm start` launches it).
- **Known upstream defect:** `get_option_positions`'s wire-shape
  mismatch (#1481) means option positions extract `[]` on the live
  wire — an empty Options tab is EXPECTED, not a #1474 regression.

## Getting to the feature

- **Route:** `/portfolio` — the Portfolio Dashboard.
- **Entry point:** Sidenav → **Portfolio Dashboard** nav item.
- **Second surface:** `/trading/live` (Sidenav → **Trading** →
  **Live**) — the workspace account snapshot fed by
  `PortfolioService.getSnapshot`.

## Automated acceptance (re-run for this gate)

| Check | Command | Result |
|---|---|---|
| Positions page-walk + core batch (44 specs) | `npx jest src/app/features/portfolio-dashboard/portfolio-dashboard.store.spec.ts --coverage=false` | **PASS** — 44/44 (2026-11-13) |
| Client walk + page specs (119 specs) | `npx jest src/app/core/robinhood-mcp/robinhood-mcp-client.service.spec.ts --coverage=false` | **PASS** — 119/119 (2026-11-13) |
| Service snapshot contract (3 specs) | `npx jest src/app/features/savant-trader/services/portfolio.service.spec.ts --coverage=false` | **PASS** — 3/3 (2026-11-13) |
| Signal-order workspace regression | `npx jest src/app/features/savant-trader/pages/signal-order/order.component.spec.ts --coverage=false` | **PASS** (2026-11-13) |
| Full suite | `npx jest --coverage=false` | **PASS** — 308/308 suites, 5,526 specs (2026-11-13) |
| Typecheck | `npx tsc -p tsconfig.app.json` + `tsconfig.spec.json` | **PASS** — clean (2026-11-13) |

## Test scenarios

### S1 — Dashboard loads through the refactored batch path

1. Open `/portfolio`; switch between accounts once.
   - **Expect:** sections populate as usual; network panel shows ONE
     `/batch` call per section group per round — not N serial calls
     (confirms `get_portfolio` still rides the round-0 batch).
   - **Expect:** console clean — no errors, no `{tool} hit the
     25-page cap` warns (that warn = stuck cursor; investigate).
   - **Result:** PASS — user-confirmed 2026-11-13.

### S2 — Real-app DI wiring: workspace snapshot loads

1. Open `/trading/live`.
   - **Expect:** the account snapshot populates — positions list,
     exposure, units; no `[PortfolioService] Account snapshot failed`
     errors. (This is the leg that proves `RobinhoodMcpClient` resolves
     in the app's real injector — the one thing TestBed mocks can't
     cover.)
   - **Result:** PASS — user-confirmed 2026-11-13.

## Regression smoke

- [x] Summary strip / positions table populate — covered by S1 PASS
- [ ] Update Stop on a protected position completes normally — waived
      (not required to close this gate; unchanged code path)
- [ ] Allocation page positions tab loads — waived (typed methods
      unchanged signature; spec-covered via mocked typed calls)

## Traceability

| Acceptance criterion | Scenario |
|---|---|
| AC1 — all positions reach every consumer | spec-pinned (latent); S1/S2 happy paths |
| AC2 — cursor/failure/retry semantics | spec-pinned (store + client describes) |
| AC3 — portfolio rides round-0 batch | spec-pinned + S1 network check |
| AC4 — snapshot contract preserved | spec-pinned + S2 |
| AC5 — no visible regression | S1, S2, smoke |

## Findings

- **#1481 — "Task: get_option_positions wire-shape mismatch"**
  (`4_BACKLOG`) — found by the #1474 review (Spec axis), verified
  against live captures: the parse hunts `results`/`option_positions`;
  the real wire is `data.positions[]`. Option positions silently never
  render anywhere. Pre-existing, unrelated to this diff's behavior.

## Results log

- 2026-11-13 — UAT doc created + corrected (trimmed to the
  info-carrying legs after scope review — the walk is latent on a
  single-page account, so most "does the dashboard work" scenarios
  were ceremony). Automated legs: full suite 308/308, 5,526 green;
  touched suites 167/167; tsc app+spec clean. Dev server `:4210` +
  observation API `:3456`. Manual scenarios pending user acceptance.
- 2026-11-13 — **QA PASS.** S1 + S2 user-confirmed (`/portfolio` and
  `/trading/live` load normally). Smoke items waived as spec-covered.
  #1482 → RESOLVED.
