**Topic:** Portfolio Dashboard  
**Topic Slug:** portfolio  
**Thread:** Load Architecture & Order Surfacing  
**Thread Slug:** load-architecture-order-surfacing  
**Issue:** #1407  
**Thread Parent:** #1403  
**Topic Parent:** #219  
**Task:** #1414  
**Domain:** PORTFOLIO  
**Type:** CODE-REVIEW  
**Status:** Complete — 2026-11-07 — PASS (2 rounds; 2 pre-gate fixes + 1 in-gate fix)  
**Created:** 2026-11-07  
**Last Updated:** 2026-11-07  

# Code Review — #1414: Positions-table stop columns + UNPROTECTED marker

**Scope:** `portfolio-pnl.util.ts` (`protectiveStopsBySymbol` +
`computeProtectedSymbols` long-only fix), `portfolio-dashboard.store.ts`
(`protectiveStops` computed), `equity-positions-table.component.*`
(4 columns, tooltip, marker), parent wiring + specs. Foreign
`open-orders-table.*` diffs excluded (other session's work).

## Axes

### Standards — PASS

- View stays a view: `stopFor`/`stopDist`/`retraced`/`stopTooltip` are
  formatting + `Map.get` lookups; the derivation lives in
  `portfolio-pnl.util.ts` beside its siblings, the store computed mirrors
  `updatableStops` verbatim.
- Marker uses theme tokens (`--mat-sys-error`); dense-table `num` class
  and `aria-sort` conventions preserved on all 4 new columns.
- Spec conventions: jasmine spies, fixture factories, `setInput` — all
  match the file's existing style.

### Spec — PASS, all ACs met

| AC | Evidence |
|---|---|
| Columns render for protected; `—` underivable | `stopFor`/`peakFor` cells; spec: underivable→`—`, pending→`…` |
| UNPROTECTED marker + Add Stop | `.pd-unprotected` chip in Stop cell; existing Add Stop action retained |
| Stop-limit shown, Update follows eligibility | `protectiveStopsBySymbol` includes stop_limit; `updatableSymbols` still gates the button — spec pins both |
| Component specs cover 4 cases | protected/unprotected/stop-limit/missing-peak all asserted |

IMPL extras verified: TIF/qty/age tooltip (`stopTooltip`), sortable
columns (sort keys for all four), totals-row colspan updated.

## Pre-gate fixes (found in implementation self-review, landed + spec'd)

1. **`computeProtectedSymbols` long-only fix** — it marked shorts
   protected on nonzero qty, contradicting `isStopLossProtecting`'s own
   rule; the new column would show UNPROTECTED while Add Stay stayed
   disabled. Now `quantity > 0`; util spec pins the short case.
2. **Retr% pending mismatch** — Peak showed `…` while deriving, Retr%
   showed `—`; both now show `…`.

## Round 2 — convergence pass

One real gap found and fixed in-gate:

- **Derive failure → perpetual `…`** — a rejected `derivePeaks` leaves
  `positionPeaks.data` null with `error` set; the parent passed `{}` and
  every Peak/Retr% cell spun `…` forever, misreporting a finished state.
  Fixed: `peaksError` input + `peakPending()` — pending requires
  `error === null`; failures settle to `—` like the underivable case.
  Spec: error → `—` in both cells.

Re-verified clean:

- `protectedSymbols` / `updatableSymbols` / `protectiveStops` now
  provably agree for longs (same `isProtectiveStopOrder` + qty>0 after
  the round-1 fix) — the Stop column and the Actions cell can't disagree.
- `@else if (…; as pk)` compiles + specs green; null-sort-last on all
  four new keys; totals colspan correct.
- Mixed-type ladder divergence documented below (nit).

## Nits (documented, not gating)

- **Mixed-type stop ladder** — the column quotes the highest protective
  stop (may be a stop_limit) while Update Stop targets the updatable
  order (a lower stop_market). Both are live orders in Open Orders, so
  the spec's "same live order" reconciliation holds literally; the
  divergence only matters when a trader runs a mixed ladder — rare.
- `stopTooltip` quotes the wire `type` verbatim — a `market`-typed sell
  carrying `stopPrice` tooltips "market" though it behaves as a stop;
  accurate to the wire, cosmetic only.
- `retraced(pos)` evaluated 3× per row for class binding — matches the
  existing `pos.pnlPercent` binding pattern; negligible cost.
- `sinceLastFill` peak intentionally unused here — dual-peak display is
  #1415's dialog context per IMPL Phase 4.

**Convergence: no third pass needed** — round 1 produced 2 pre-gate
fixes, round 2 produced 1 in-gate fix; remaining surface is documented
nits.

## Evidence

- 4 touched suites green: pnl util (63), table component (32),
  store selectors (20 incl. 2 new protectiveStops), component spec —
  162 total
- `tsc --noEmit -p tsconfig.app.json` clean
- Live: dev server on 4200 hot-reloads; columns land after positions

## Verdict

**PASS** — cleared to `/proj qa 219 1414`.
