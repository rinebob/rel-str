# Code Review — #588 FE Allocation page shell

**Status:** Final
**Task:** #588 — FE: Allocation page shell — account tabs, header, subtabs, route
**Blueprint:** #582 (FE), under Topic #576 / Thread #577
**Files:** `allocation-page.component.ts`, `allocation-page.component.spec.ts`,
`allocation.store.ts` (loadAccounts selection preservation), `core-routes.ts`,
`core/common/interfaces.ts` + `constants.ts`

## Verdict: PASS (3 axes × 3 rounds — ran until no new findings)

**Round 2 (re-review of round-1 fixes) — all verified; new findings:**

- **[MED] Refresh dead-ended on `listAccounts` failure** — `refresh()`
  no-ops with zero accounts → `onRefresh()` now retries `loadAccounts`
  when `accounts` is empty or `loadError` is set.
- **[LOW]** Refresh had no in-flight feedback → `[disabled]` +
  `Loading…` label; `accounts-loading` indicator for the initial list
  call (previously a blank page).
- **[LOW]** Preserve-selection logic untested → store spec covers reorder
  + dropped-account fallback to index 0.
- **[LOW]** `positions-error` vs `account-error` naming asymmetry → both
  subtabs use `account-error`; spec queries scoped to
  `.mat-mdc-tab-body-active` (visited tab bodies stay mounted and mirror
  the selected account).
- **[LOW]** `track instrumentId` duplicate-key hazard → `instrumentId +
  '_' + $index`.
- **[NIT]** `first` → `sel` rename; consistent `closest('[role="tab"]')`
  click dispatch; mock `selectAccount` re-scopes `bucketRows` too (spec
  asserts 'Income' bucket after switch).

**Round 3 (sanity pass on round-2 fixes):**

- **[HIGH — false positive]** `.mat-mdc-tab-body-active` ambiguity —
  verified empirically: 14/14 page specs green; MDC does not retain the
  inner group's active class inside an inactive outer body.
- **[LOW] `loadAccounts` unguarded** — double-click during `listAccounts`
  fired twice → `accountsLoading` guard added (mirrors `refreshing`).
- **[LOW] loadError + non-empty accounts clears error without refetch** —
  `loadAccounts` early-returns `loadAccount` when `asOf && snapshot` —
  reasonable-as-documented; Refresh→`loadAccounts` in that state still
  revalidates the account list + selection.

- **[LOW] Non-agentic write enforcement — verified NOT needed:** the PRD
  requires bucket CRUD + manual assignment on non-agentic accounts
  (it's their only attribution path); store write methods correctly do
  not gate on `agenticAllowed`.

## ACs

| AC | Verdict |
|---|---|
| Page reachable via route + nav | ✅ — lazy `loadComponent` + `authGuard`; nav adjacent to Portfolio Dashboard |
| Every account renders a tab; non-agentic flagged | ✅ — per-account `non-agentic-flag-{acct}` testid + tooltip/aria |
| Header reconciles value = allocated + cash | ✅ — `accountHeader` selector; ⚠ divergence flag on broker-vs-derived mismatch |
| Switching tabs re-scopes subtabs | ✅ — spec now asserts re-rendered account-B rows, not just delegation |

## Findings → resolution

- **[MED] `refresh()` unreachable + byAccount slices stale forever** (root
  store persists across revisits) → Refresh button in the page toolbar
  calls `store.refresh()`; `loadAccount`'s asOf/snapshot guard unchanged.
- **[MED] `loadAccounts` reset `selectedAccountIndex` to 0 on every
  revisit** → now preserves the previous selection resolved by
  `accountNumber`, falling back to index 0 when the account vanished.
- **[MED] Positions subtab lacked loading/error affordance** → same
  `loading`/`error` branches as Buckets (`positions-loading`,
  `positions-error` testids).
- **[MED] Spec proved delegation, not re-scoping** → mock `selectAccount`
  now swaps per-account row/header fixtures; the spec asserts account B's
  header + TSLA rows render after the click.
- **[LOW] As-of label rendered but untested** → `data-testid="as-of"` +
  spec (PRD data-freshness requirement).
- **[LOW] a11y on ⚠ / non-agentic spans** → `tabindex="0"` + `role`/`aria-label`.
- **[LOW] testids not account-scoped** → `non-agentic-flag-{acct}`; spec
  asserts flag exists only on ACCT_B.
- **[NIT]** `NoopAnimationsModule` → `provideNoopAnimations()`; unused `of`
  import removed; dead `selectedAccount` mock field removed.

## Deferred / documented

- Inline template/styles vs the feature's `templateUrl`/`styleUrl`
  precedent — deliberate: #589–#591 replace the placeholder tables with
  real components; revisit then if the file stays large.
- `allocated` (gross) vs signed derived-cash basis mismatch under shorts —
  matches PRD "completeness check" semantics; noted in the review record.
- Non-agentic *enforcement* inside interactive subtabs is a #589–591
  responsibility — the shell only flags it.
- 'Unassigned' pseudo-row + Cash pinned last asserted; eager tab-body
  instantiation noted (acceptable at account counts RH allows).

## Test results

- `allocation-page.component.spec.ts`: **14/14**
- `src/app/features/portfolio-dashboard`: 17/17 suites, 279/279
- Full suite: 148/149 suites green; the one failure (10 tests) is
  `swing-analysis-page.component.spec.ts` — unrelated in-flight user
  refactor deleting `batch-sweep`/`swing-batch` (separate task).

## QA handoff

→ `/proj qa 576 588` — has a real UI surface this time: dev-server visual
pass (tabs, header, non-agentic flag, divergence ⚠, refresh) plus the
spec-traced scenarios.
