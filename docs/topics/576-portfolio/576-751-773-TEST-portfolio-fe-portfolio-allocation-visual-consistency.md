**Topic:** Portfolio Allocation  
**Topic Slug:** `portfolio-allocation`  
**Thread:** Portfolio Visual Consistency  
**Thread Slug:** `visual-consistency`  
**Issue:** #773  
**Thread Parent:** #751  
**Topic Parent:** #576  
**Domain:** PORTFOLIO  
**Type:** TEST: FE  
**Status:** Draft  
**Created:** 2026-10-03  
**Last Updated:** 2026-10-03  

---

## Strategy

Presentation-level migration — most coverage is **structural regression**: the markup restructure (account tabs → header-bar toggle, tab-group removal) is what breaks specs, and updated specs pin the new structure. Style conformance is largely non-unit-testable; the meaningful assertions are DOM structure, control presence/behavior, and token usage where inspectable (class presence, no inline literals).

## E2E journeys (manual — dev server)

- `/portfolio`: header bar renders (icon, title, account toggle, refresh); select each account via toggle — content swaps instantly with no slide; summary bar, tables, history toggle all render in the centered column.
- `/portfolio-allocation`: account toggle in header; account-header strip shows value/allocated/cash/unassigned/as-of; Buckets|Positions single tab row, instant switch; expando rows animate and show totals; retired section expands.
- Dark theme: toggle app theme — no broken/unreadable surfaces in migrated components.
- Dialogs: open bucket create/edit, assign, detail, close-position, stop-loss — compact token chrome.

## Integration boundaries

- `mat-button-toggle-group` ↔ selected-account state: `portfolio-dashboard.component` `onTabChange`/`selectedAccountIndex` and `allocation-page` `selectedAccountIndex`/`onAccountTab` — rewired to toggle `value`/`change`, same store methods.
- Non-agentic flag: renders in toggle label per account; tooltip/ARIA preserved.
- Tab removal: `mat-tab-group` gone from both page templates; `MatTabsModule` import drops from dashboard (retained on allocation for Buckets|Positions).

## Unit test targets

- **dashboard component:** header bar present; toggle renders `accountName` only (no account number); selecting a toggle updates `selectedAccountIndex`; non-agentic chip in label; no `mat-tab`/`mat-tab-group` in DOM.
- **allocation page:** toggle + header bar; account-header strip still renders per-account data; Buckets|Positions tab-group remains with `animationDuration=0`; refresh lives in header actions; non-agentic flag present.
- **tables:** unchanged behavioral specs stay green; totals row + expando specs unaffected (structure preserved).
- **spec updates:** `account-tabs` / `acct-tab-*` test IDs become `acct-toggle-*` equivalents; `pd-tabs` class assertions removed.

## Test seams

- Account list fixtures already exist in both specs — reuse to drive toggle rendering and multi-account switching.
- `agenticAllowed=false` fixture drives the flag-in-label assertion.

## Edge cases

- Single account → toggle renders one button, still selectable state.
- Account names longer than expected (new RH account) → toggle stays compact (wraps or truncates per chosen styling — decided at impl, spec asserts no layout break via rendering without error).
- All accounts non-agentic → every toggle label carries the flag.
- Empty accounts list → existing empty-state, restyled via `state-block()`.
- Rapid toggling while loading → same guard as tab switch today (loading state respected).
