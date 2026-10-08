# Code Review — #591 FE Bucket detail dialog

**Status:** Complete — PASS (4 rounds; rounds 2–4 verified fixes, round 4 = no new findings)  
**Topic:** Portfolio Allocation (#576)  
**Blueprint:** #582 (FE)  
**Task:** #591  
**Date:** 2026-09-28  

## Scope

- `src/app/features/portfolio-dashboard/allocation-bucket-detail-dialog.component.ts` (+spec) — NEW
- `src/app/features/portfolio-dashboard/allocation-buckets-table.component.ts` (+spec) — name-link → detail dialog
- `src/app/features/portfolio-dashboard/allocation.store.ts` — `bucketDetail(accountNumber, bucketId)` re-scoped per-account; `fills` added
- `src/app/features/portfolio-dashboard/allocation.types.ts` — `BucketDetail.fills`, shared `fmtDollars`
- `allocation-page.component.ts`, `allocation-positions-table.component.ts` — `fmt` → shared `fmtDollars`

## Round 1 (3-axis)

### Standards

- **MAJOR (fixed)** — `mat-form-field` used without `MatFormFieldModule`
  import (NG8001 risk; sibling dialog imports it explicitly). Fixed.
- **Minor (fixed)** — `as never`/`as BucketDetail` fixture casts in the
  new spec replaced with real typed fixtures (`AccountAllocation`,
  `BucketDetail` incl. `fills`).
- **Minor (fixed)** — `fmt` duplicated 4× across allocation surfaces →
  extracted `fmtDollars` to `allocation.types.ts`; all four call sites
  delegate.
- **Nit (fixed)** — `::ng-deep` replaced by `subscriptSizing="dynamic"`.

### Spec

- All five task ACs MET with test coverage: dialog opens per bucket,
  carousel iterates, in-place view-switch, selector-driven live updates,
  chart stub only.
- **Medium (fixed)** — PRD US19/AC: detail lists attributed "positions
  AND orders". `BucketDetail` gained `fills` (owned-instrument fills);
  each carousel card lists the position's recent fills. Covered by spec.
- Note: stats strip sits in `mat-dialog-content` rather than literally
  the header — all PRD metadata present; cosmetic deviation accepted.

### Thermo-nuclear

- **MAJOR (fixed)** — carousel `idx`/`shownIdx` split: after a live
  position shrink, prev needed dead clicks to unwind the stale index.
  Both buttons now navigate on the clamped `shownIdx`. New spec covers
  shrink-while-viewing-last.
- **Minor (fixed)** — dialog resolved via `selectedAccountIndex` rather
  than a captured account number (inconsistent with sibling write
  dialogs; silent content swap on account switch). Dialog data now
  carries `accountNumber`; `bucketDetail(accountNumber, bucketId)`
  derives from that account's slice — also removed dependence on
  selected-account computeds (`bucketRows`/`positionsRows`).
- **Minor (noted)** — the dead `stats unavailable` template branch
  encodes an invariant types don't enforce; left as defensive guard.
- Verified: signal-tracking through `bucketDetail` inside `computed`
  is correct (dynamic dependency tracking, all signal reads).
- Nits left: `pnlOf` formula triplication, `MatDialogRef` untyped result.

## Round 2 — verification + new lows

- **Medium (fixed)** — bucket switcher read `selectedAllocation()` while
  detail read the captured account (cross-account options after a tab
  switch). Now reads `byAccount()[accountNumber]`.
- **Low/Medium (fixed)** — `fills` ownership derived from open positions;
  now derives from attributions — flat-but-attributed instruments'
  history included (consistent with `computeBucketStats`).
- **Low (fixed)** — `shownFills` took `slice(-5)` of unsorted broker
  order — now sorts `Date.parse` desc, takes 5.
- **Low (fixed)** — `filledAt.slice(0,10)` assumed ISO; `fillDate()`
  guards non-parseable timestamps.

## Round 3 — residual lows

- **Low (fixed)** — `fmtDollars(NaN)` rendered "NaN" (corrupt Firestore
  doubles acknowledged by the overTarget guard); now `Number.isFinite`.
- **Low (fixed)** — stale `idx` silently jumped the carousel forward when
  positions regrew; constructor `effect()` clamps raw idx on shrink.
- **Low (fixed)** — all-closed buckets showed "No positions" with zero
  fills (PRD "orders" unreachable); empty state now lists recent
  bucket-level fills.
- **Low (fixed)** — remaining `as never`/`as unknown as` fixtures in the
  positions-table spec + this spec's store access replaced with typed
  literals / hoisted `mockedStore`.
- **Noted** — `shownFills` membership doesn't gate on the utils'
  `isWellFormed` fill check (display only; stats unaffected).

## Round 4 — verification

**No new findings.** All round-2/3 fixes confirmed in place.

## Test results

`npx jest src/app/features/portfolio-dashboard` — 22 suites, **333/333**
green (9 new dialog specs + store/table spec updates).

## Verdict

**PASS** — all majors/minors resolved in-round; remaining items are nits.
