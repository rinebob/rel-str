# Code Review — #589 FE Buckets tab — unified table + dialogs

**Status:** Final
**Task:** #589 — FE: Buckets tab — unified table, Cash row, create/edit/retire dialogs
**Blueprint:** #582 (FE) · Topic #576 / Thread #577
**Files:** `allocation-buckets-table.component.ts`, `allocation-bucket-dialog.component.ts`,
their specs, `allocation-page.component.ts` wiring (Buckets subtab → real table)

## Verdict: PASS (3 axes × 2 rounds)

## ACs

| AC | Verdict |
|---|---|
| Merged bucketRows + Cash pinned + Unassigned | ✅ |
| Create/edit/rename/retire persist via bucket service | ✅ — store → `AllocationBucketService`; edit short-circuits unchanged fields |
| Retired buckets reject new attributions + stay visible | ✅ — rejection lives in `position-attribution.service.ts` txn (by design); UI shows RETIRED, no actions. Flag for #590: the assign-picker must filter `status === ACTIVE` |
| Σ>100% warns, never blocks | ✅ — ACTIVE rows only, `Number.isFinite` guard |
| Spec covers rows + actions | ✅ — 14 table + 6 dialog specs |

## Findings → resolution

**Round 1:**

- **[LOW] Cash `$` rendered under the "Target $" column** → `colspan="3"` label, number lands under Exposure.
- **[LOW] Silent write failures** — dialog closes before the store call resolves, rejections vanished → `runWrite()` wrapper + `writeError` signal + `role="alert"` banner.
- **[LOW] Account captured at `afterClosed`** → moved to open time (mostly unreachable — modal backdrop — but creates could target the wrong account on programmatic reselection).
- **[LOW] NaN `targetPct` poisons `overTarget`** → `Number.isFinite` guard (legacy/corrupt docs only).
- **[LOW] Empty row on `bucket && !stats`** → `@else` fallback row (`stats unavailable`).
- **[TRIVIAL]** typed `MatDialogRef<C, BucketDialogResult | boolean | undefined>`; warn-banner `tabindex`/`role`; icon-button `aria-label`s; page dead code (`rowKey`, `BucketRow` import) removed; `.alloc-table` styles retained (still used by the Positions subtab); page-spec mock given the write methods + `selectedAccount`.
- **[NIT]** retire-copy assertion tightened to `'reject new attributions'`; NaN-clear spec; cash-diverged row spec; write-error spec.

**Round 2 (verify + fresh pass):**

- **[LOW] colspan overshoot** — colspan-3 + 6 + trailing td = 11 cells in a 10-col table → `colspan="5"`.
- **[LOW] `writeError` persists across account switch / during retry** → clears via `effect()` on `selectedAccount` and at write start.
- **[INFO]** Dialog write races (stacked dialogs) — noted, deferred; ordering within an edit is sequential.
- **[INFO]** `bucket && !stats` fallback is defensive-only (store always attaches stats) — kept as insurance.
- **[NIT]** retired rows interleave with active (no ordering) — cosmetic, deferred; `as never` casts in spec fixtures (CashCheck shape) noted.

## Test results

- `allocation-buckets-table.component.spec.ts`: 14/14
- `allocation-bucket-dialog.component.spec.ts`: 6/6
- `src/app/features/portfolio-dashboard`: **19/19 suites, 299/299**
- `tsc -p tsconfig.app.json --noEmit`: clean

## Noted for #590

The assign-bucket picker must filter `status === ACTIVE` — retired
rejection is enforced service-side but the picker shouldn't offer them.

## QA handoff

→ `/proj qa 576 589` — real UI: create/edit/retire flows, warn banner,
retired visibility, per-account scoping on a live account.
