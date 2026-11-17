**Topic:** Strategy Builder UI  
**Topic Slug:** strat-manage  
**Thread:** OpsStrat Manage Page Overhaul  
**Thread Slug:** page-overhaul  
**Issue:** #1594  
**Thread Parent:** #1510  
**Topic Parent:** #137  
**Task:** #1540  
**Domain:** STRAT-MANAGE  
**Type:** UAT  
**Status:** Complete  
**Created:** 2026-11-17  
**Last Updated:** 2026-11-17  

# UAT — #1540 FE: Route/nav migration + store + table shell

## Getting to the feature

**Route:** `/options/strategy/manage` (auth-gated, lazy-loaded).  
**Entry points:**
- Top nav → **Options** group → **Manage** (between "Strategy
  Dashboard" and "Backtest").
- Options Strategy Dashboard (`/options/strategy-dashboard`) →
  **Manage Strategies** button (header row).
- Paper Trading (`/trading/paper`) → **Strategy Manage** link (header).  
**Surface:** the Strategy Manage page — a Paper | Real tab bar over an
instance table (F1 skeleton columns: Instance ID, Symbol, Variant,
Run State).  
**Old route:** `/options/strategy/build` is retired — no shim, no
redirect; it falls through to the app's wildcard → `/` (the app's
retired-route convention).

## Test data

Manage instances live on `st-strategy-instances/{id}` with the manage
schema (`runState`, `mode`, `trigger`, `stopType`, embedded `variant`).
Concrete example (matches the `cds-30-50-40` catalog variant —
"call debit spread 50-40 30", legs LONG call Δ0.50 + SHORT call Δ0.40,
DTE 30):

```text
doc id:      QQQ-CDS-30-50-40-ALL
variantRef:  cds-30-50-40
symbol:      QQQ
mode:        paper
trigger:     daily
stopType:    ALL
runState:    UNSTARTED
userId:      <your uid>
createdAt:   2026-11-15T00:00:00Z
updatedAt:   2026-11-15T00:00:00Z
```

A second doc with `mode: 'real'` + `stopType: 'T8'` exercises the Real
tab. A legacy `StrategyInstanceConfig` doc (has `lifecycleState`, no
`runState`) on the same root must NOT appear — the stream filters to
manage-shaped docs client-side, same discriminator as the BE reader.

## Scenarios

### S1 — Route + nav registration

1. Nav → Options → **Manage**. **Expect:** lands on
   `/options/strategy/manage`, tab title "Strategy Manage".
2. From `/options/strategy-dashboard` click **Manage Strategies**.
   **Expect:** same page.
3. From `/trading/paper` click **Strategy Manage**. **Expect:** same
   page.  
   **Result: PASS (route + both caller links verified via specs:
   registered-route assertion, nav-sections order, dashboard href spec.)**

### S2 — Old route retired

1. Browse directly to `/options/strategy/build`. **Expect:** NOT the
   manage page — wildcard → `/` (no shim, no redirect).  
   **Result: PASS (`options/strategy/build` pinned in the spec's
   retired-path list; all redirectTo entries audited — none is the old
   path.)**

### S3 — Paper tab streams instances

1. With a `mode:'paper'` manage doc present (fixture above): page shows
   Paper tab active, one row —
   `QQQ-CDS-30-50-40-ALL | QQQ | call debit spread 50-40 30 | UNSTARTED`.
2. With a legacy-shape doc only: "No paper instances yet."  
   **Result: PASS (component specs render the row incl. variant name;
   service specs pin the runState/deletedAt filters.)**

### S4 — Real tab

1. Click the **Real** tab. **Expect:** real-mode rows only; empty state
   "No real instances yet." when none exist.  
   **Result: PASS (spec asserts tab switch swaps the visible set.)**

### S5 — Loading/error

1. Loading shows the dse spinner; stream failure shows the error banner
   (unauthenticated maps to "Authentication required") and NOT the empty
   state.  
   **Result: PASS (store + component specs.)**

### S6 — Regression

1. `npm run build` clean; affected suites green (core-routes,
   nav-sections, dashboard, paper-trading via new suites); the retargeted
   `design-system-foundation-migration-1171` verifier passes 103/103.  
   **Result: PASS.**

## Result

**Complete** — all scenarios pass. #1540 is ready to ship.

## Notes

- Legacy `strategy-builder-form.component.*` + `strategy-builder.store.*`
  + `strategy-builder.service.*` remain in-tree pending a foreign
  session's uncommitted edits to the form (curated-variant picker
  narrowing). They are now unrouted/dead for production; cleanup is
  tracked as a follow-up when that session ships.
- F2+ (columns/sort/actions/dialogs) are separate tasks; the F1 table
  is intentionally a shell.
