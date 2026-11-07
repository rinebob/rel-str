# Code Review — Task #1441: BUG: Allocation page chrome parity — account order differs + balances unmasked

**Topic:** #576 Portfolio Allocation  
**Task:** #1441 — BUG: Allocation page chrome parity — account order differs from portfolio page + balances unmasked by default  
**Reviewer:** Devin + three-axis review (Standards / Spec / Thermo-nuclear sub-agents)  
**Date:** 2026-11-06  
**Verdict:** PASS — clean on first pass; three cosmetic nits applied in-gate, no majors.

## Scope reviewed

- `portfolio-dashboard.helpers.ts` — new shared exports:
  `PRIMARY_AGENTIC_ACCOUNT_NUMBER` (moved from the store),
  `sortAccountsPrimaryFirst()`, `PD_SHOW_AMOUNTS_KEY`
- `portfolio-dashboard.store.ts` — inline sort replaced by the shared helper
- `portfolio-dashboard.component.ts` — localStorage literal → shared key const
- `allocation.store.ts` — `loadAccounts` applies the shared sort
- `allocation-page.component.ts` — `showAmounts`/`toggleAmounts`/`masked()`
  trio, masked header values + cash-diverged tooltip, `.pd-privacy` eye
  button in `.bar-actions`; dead `fmt` alias removed
- `allocation.store.spec.ts` — +1 ordering spec
- `allocation-page.component.spec.ts` — +4 masking specs, afterEach
  localStorage reset, opt-in setup in 2 existing specs

**Out of scope:** the `ConfirmDialogComponent` import-path change in
`portfolio-dashboard.component.ts` belongs to another session's work
(shared confirm-dialog consolidation) and is excluded from this review.

## Axis results

### Standards — PASS (with nits, all applied)

- Shared constants exist once; no `677616245` literal outside specs;
  helpers.ts (now ~130 lines) is a reasonable home and its header
  comment was updated to describe the new role.
- `.pd-privacy` markup is a faithful copy of the dashboard's — same
  class, aria wiring, icon swap; `.icon-btn` styled globally.
- Spec conventions hold (zoneless, jest.fn, async flush, hardcoded
  key/literal as change-detectors per established pattern).
- Nits applied in-gate: stale helpers docstring rewritten; stray blank
  lines in the page import block removed; unused
  `data-testid="amounts-privacy-toggle"` dropped (spec uses `.pd-privacy`,
  matching the dashboard).
- Noted, not applied: `masked()` vs `maskedCurrency()` naming asymmetry
  (different formatters — defensible); specs hardcode `'pd-show-amounts'`
  deliberately as a contract pin.

### Spec — MET

- Order: both stores sort via one helper over the same upstream
  (`getAccounts`) — drift-proof parity; index-resolution verified
  (sort → prevSelected lookup → agenticIdx fallback → 0, all on the
  sorted array).
- Masking: header-only scope matches the dashboard exactly (tables
  untouched); masked cash-diverged tooltip is a correct extension —
  an unmasked tooltip would leak the hidden values.
- Shared localStorage key is a deliberate design choice (one opt-in
  covers both pages) — flagged in the UAT for confirmation.

### Thermo-nuclear — MEETS BAR (with nits, all applied)

- Trio duplication at 2 consumers is the right call: `masked` can't
  fully dedupe (different formatters per page), no single-writer
  invariant exists (repo precedent: component-local storage prefs vs
  injectable services only when side-effect invariants apply), and the
  pages are sibling routes — never co-mounted, so a shared signal buys
  nothing. Revisit only if a third surface adopts the pref.
- Sort seam at each store's load boundary is correct — sorting in the
  MCP client or data service would force presentation policy on a raw
  API/other consumers.
- Eye-button markup duplication at 2 sites is cheaper than extraction.
- Nit applied in-gate: dead `data-testid` removed.
- Forward notes (out of scope, flagged):
  `trading-config-dialog.component.ts` pickers list accounts in raw API
  order; `portfolio-gallery-header.component.ts` renders dollar totals
  unmasked — both are potential third consumers if the parity rule is
  meant app-wide.

## Verification

- `npx jest` full suite: **301 suites / 5277 tests green**
- `npx jest` on touched areas: portfolio-dashboard folder 596/596
- `tsc --noEmit`: clean on touched files (pre-existing implicit-any
  errors in `portfolio-dashboard.store.spec.ts` unchanged, not introduced
  by this diff)
- Live (dev server, user-confirmed): account pill order identical on
  `/portfolio` and `/portfolio/allocation`; header values masked `•••`
  by default, eye toggle reveals + persists across both pages

## Findings

None open. Forward-looking observations above are recorded for future
scope decisions only.
