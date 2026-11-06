**Topic:** Portfolio Dashboard  
**Topic Slug:** portfolio-dashboard  
**Thread:** Load Architecture & Order Surfacing  
**Thread Slug:** dashboard-load-order-surfacing  
**Issue:** #1407  
**Thread Parent:** #1403  
**Topic Parent:** #219  
**Task:** #1408  
**Domain:** PORTFOLIO  
**Type:** CODE REVIEW  
**Status:** Complete  
**Created:** 2026-11-05  
**Last Updated:** 2026-11-05  

# Code Review — Task #1408: Store per-account gated load + prefetch waterfall

Reviewed diff: `git diff HEAD` scoped to the task's files —
`portfolio-dashboard.store.ts`, `portfolio-dashboard.component.ts`,
`portfolio-dashboard.component.html`, `portfolio-dashboard.helpers.ts`,
`portfolio-dashboard.store.spec.ts`, `portfolio-dashboard.store.selectors.spec.ts`,
`portfolio-dashboard.component.spec.ts`.

Three axes ran in parallel sub-agents (Standards, Spec, Thermo-nuclear).
Findings were remediated in-gate and re-verified; final verdict below
reflects the post-remediation state.

## Out-of-scope worktree contents

`components/open-orders-table.component.html/.scss` carry unrelated
DS-checkbox restyling from other in-flight work — excluded from review.
`savant-trader/` changes (user's #1363 refactor) likewise excluded; its
typecheck errors are not part of this diff.

## Findings

### Critical

None.

### Major — all remediated in-gate

1. **Dead `loadPhase1`/`loadPhase2` (~85 production lines)** — flagged by all
   three axes. After the waterfall rework they had zero production callers,
   duplicated `fetchCore`/`fetchOrders` logic, and kept ~200 spec lines alive
   with vacuous assertions ("sets globalLoading false" tested methods that no
   longer touch `globalLoading`). Cascading dead helpers
   `collectAllEquitySymbols`/`collectAllOptionInstrumentIds` existed only for
   `loadPhase2`.
   **Fix:** both methods, both helpers, and their describe blocks deleted;
   error-independence coverage ported to a new `per-section error mapping`
   describe exercising the real path (per-item failure, transport failure,
   orders-item failure, quote failure, per-account quote scoping).

2. **`selectAccount` didn't join in-flight orders fetches** — Spec +
   Thermo-nuclear. `ensureOrders` routed through `requestOrders`, which set
   `ordersAgain` and queued a redundant trailing `/batch` on every
   mid-prefetch tab select — a slow extra RH round-trip per click.
   **Fix:** `ordersInFlight` is now `Map<account, Promise>`; `ensureOrders`
   returns the shared promise (join), only `requestOrders` (reconcile)
   queues the trailing rerun. Spec added: select during orders prefetch →
   exactly one orders batch.

3. **Waterfall order violated the IMPL** — Spec. `prefetchWaterfall`
   iterated `accounts()` in array order, so when the agentic account isn't
   index 0, sibling accounts prefetched *before* the selected account's
   remaining sections.
   **Fix:** waterfall is selected-account-first. Spec added asserting batch
   order `['222','222','111','111']` for a non-zero selected index.

4. **Stale-load race across `refresh()`** — Thermo-nuclear. A fetch started
   before `loadAccounts` cleared `loadedGroups` could resolve after and
   re-mark the group loaded with pre-refresh data; the waterfall would then
   skip it.
   **Fix:** `loadEpoch` counter bumped by `loadAccounts`; `ensureCore`/
   `requestOrders` capture the epoch and only mark loaded when it still
   matches. Spec added: in-flight cross-refresh fetch doesn't mark — the
   waterfall refetches (2 core fetches observed).

5. **Orders/History tab activation never kicked an unloaded group** — Spec.
   The IMPL requires on-demand loading on tab activation; clicking Orders
   before the waterfall arrived showed an empty section with no fetch.
   **Fix:** new public `ensureAccountOrders(accountIndex)` (join or kick
   with spinners); component `selectSection(n)` calls it for tabs 2–3.
   Component spec added.

6. **Fully-failed fetches marked loaded forever** — Spec minor promoted.
   A transport failure marked the group loaded, making later
   `selectAccount` a permanent no-op (only manual `retrySection` recovered).
   **Fix:** `fetchCore`/`fetchOrders` return a success flag — total
   transport failure leaves the group unmarked so the next ensure retries.
   Spec added (retryable after `HTTP 401`).

### Minor — accepted, documented

- **Quotes now fetched per-account** (N× calls vs one global call before).
  Required for on-demand per-account loads; the global dedupe was only
  possible under the old all-accounts phase. Intentional.
- **`initialLoad`/`refresh` are one-line aliases** — kept as named entry
  points (initial paint vs deliberate reload intent).
- `refreshing` renamed to `loadInFlight` (it guards both entry points).
- A reconcile joining during a prefetch reuses the leader's `markLoading`
  flag (trailing rerun may re-assert spinners) — rare, flags already set.

### Nits

- Worktree also contains `onCancelOrder`/`onCancelSelected` full-`refresh()`
  calls — deferred to #1410 per task scoping, not this task's ACs.

## Test results

- Full repo suite: **299 suites / 5203 tests — all green**
  (includes foreign `savant-trader` specs — all pass; only `tsc` errors
  from the user's in-flight #1363 refactor exist, unrelated).
- Portfolio-dashboard feature: **33 suites / 585 tests — all green**
- New/ported specs cover: first-wave scoping, globalLoading release timing,
  waterfall coverage, selected-first ordering, core join, orders join (no
  double-fetch), reconcile trailing-rerun dedupe, epoch invalidation,
  per-section error mapping, transport-failure retryability, per-account
  quote scoping, tab-activation kick.
- `git diff --check` clean; `tsc --noEmit` clean for all touched files.

## Second pass (re-review of remediated diff)

The same three axes re-ran against the post-remediation state. Verdicts:
**Spec — PASS** (all six first-pass fixes verified, mechanisms exercised
against the real code), **Thermo-nuclear — APPROVE** (no blocking issues),
**Standards — clean** with findings below.

### Remediated in-gate (round 2)

7. **`retrySection('orders')` bypassed the orders registry** — Standards +
   Spec. The manual retry called `runOrdersBatch` directly: it could
   double-fetch against an in-flight prefetch and never marked the group
   loaded (so the waterfall refetched anyway). Now routes through
   `requestOrders(acct, true)` — same spinner semantics, plus dedupe and
   loaded-marking.

8. **Trailing reruns inherited the leader's `markLoading`** — Thermo-nuclear.
   A silent reconcile queued behind a spinner-marked prefetch produced a
   trailing pass that flashed section spinners, contradicting
   `reconcileOrders`' no-flags contract. `rerunMarkLoading` now carries each
   requester's spinner intent into its trailing pass.

9. **Tab indices as magic numbers** — `ordersTabs` const documents the
   Orders/History tabs; component spec now asserts the tab-3 kick too.

10. **Vacuous `loadAccounts` specs** — two tests asserted `globalLoading`
    on a method that never touches it. Trimmed to the meaningful
    (rethrow) assertion.

### Noted, not fixed — scope and tradeoffs

- `toggleOrderHistory`/`showOrderHistory` appear dead in production
  (History tab renders via `selectedSection`). **Pre-existing** dead code,
  not introduced by this diff — cleanup candidate for a later pass, not
  this task's scope.
- Epoch guard prevents *marking* stale groups but not *joining* a stale
  in-flight fetch — a waterfall may serve a seconds-old pre-refresh
  snapshot for one wave, then refetch on next ensure. Accepted freshness
  nuance.
- `ensureOrders` joining a silent reconcile yields no spinner — practically
  unreachable (a mutation requires the orders UI, which requires loaded
  orders).
- The 3× `dataSection`/`errorSection` settled-mapping duplication — kept;
  a helper saves ~15 lines but the existing explicit style matches the
  rest of the store.

### Test results (round 2)

- Full repo suite: **299 suites / 5203 tests — all green**
- Post-edit targeted run (store + component specs): **85 tests green**

## Verdict

**PASS** (confirmed on second pass — converged, no new blocking findings).
All in-diff findings across both passes remediated in-gate; remaining
items are documented tradeoffs or pre-existing issues outside scope.
