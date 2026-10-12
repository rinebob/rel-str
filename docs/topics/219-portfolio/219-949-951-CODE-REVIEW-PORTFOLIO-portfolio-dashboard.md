**Topic:** Portfolio Dashboard  
**Topic Slug:** portfolio-dashboard  
**Thread:** Extend Gallery UI to Portfolio Page  
**Thread Slug:** portfolio-gallery-view  
**Issue:** #949  
**Thread Parent:** #926  
**Topic Parent:** #219  
**Task:** #951  
**Domain:** PORTFOLIO  
**Type:** CODE REVIEW  
**Status:** Complete  
**Created:** 2026-10-11  
**Last Updated:** 2026-10-11  

# Code Review — PositionCard model + card + grid/grouping (#951)

Three-axis gate review of task #951's change set: `groupPositionCards` /
`classifyCardOrders` / `PositionCardGroup` in
`pages/portfolio-gallery/utils/position-cards.util.ts`, the new
`components/position-card/` and `components/position-gallery-group/`
components, facade group wiring (`groups`, `ungrouped`, `allGroupsExpanded`,
`toggleAllGroups`, `setGroupExpanded`), header expand-all control, view
stub-grid → real-card swap, and the `isStopLossProtecting` param widening
in `utils/portfolio-pnl.util.ts`.

All findings below were **fixed in this session** and re-verified before
the verdict; severities are as filed by the reviewing axes.

## Standards

### Findings (remediated)

- **Minor — empty-string profile fields produced a blank-label group**
  (`position-cards.util.ts` `positionGroupKey`). `sector`/`industry`/
  `marketCapTier` are optional strings — `''` slipped past `??` into an
  unlabeled expando. Fixed: `||` sinks (the reference `getGroupKey`
  already uses `||`).
- **Minor — `default:` arm silently collapsed unhandled dimensions into
  a `''` group.** Same failure mode the signal gallery fixed under #820
  (thermo M1). Fixed: `default` now throws; spec pins the throw.
- **Minor — `UNKNOWN_GROUP_LABEL` duplicated `UNKNOWN_GROUP`.** Fixed:
  imports the shared constant; `UNASSIGNED_GROUP_LABEL` stays (genuinely
  new — bucket dimension has no signal-gallery counterpart).
- **Minor — `NoopAnimationsModule` (deprecated module form)** in the two
  new specs + the shipped view spec. Fixed: `provideNoopAnimations()`.
- **Minor — CAP_TIER group label rendered the raw tier key** (`mega`).
  Fixed: `tierLabel()` gives the display label (`MEGA`) matching the
  card's tier badge; group key follows (`CAP_TIER:MEGA`).
- **Nits fixed:** `imports: []` removed from `position-card`;
  `booleanAttribute` transform added to the group's `actionsDisabled`;
  `@let` replaces the `!` non-null assertions in the card day-change row;
  `'1 positions'` pluralized; expand-all `[disabled]` at zero groups;
  stale `(#926/#950)` header tags + "grouped expandos land in #951"
  comment; `classifyCardOrders` docstring now states its callers must
  pass symbol-scoped orders.

## Spec

### Findings (remediated)

- **Doc deviation — sink groups didn't sink.** The signal gallery orders
  `(Unknown)` last unconditionally; `groupPositionCards` ranked groups by
  first card, so an unattributed mega-cap put `(Unassigned)` **first**.
  IMPL says "same convention." Fixed: named groups keep first-card order,
  sink labels always sort last; pinned by a spec where the sink's top
  card outranks every named group's.
- **Spec gaps filled:** equal-cap symbol tiebreak, `daysHeld` month
  boundary, `dayChange` null on `previousClose = 0`, side-filter
  exercised with a real short in the facade spec, removed-position →
  card gone, view `expandedChange → setGroupExpanded` wiring, flat-grid
  suppression in grouped mode.
- **TEST doc corrected:** the `stopDistancePct`-for-short and
  badge-distance-sign-for-shorts lines were unimplementable as written
  (shorts-never-protected is the designed semantic); the
  `computeProtectedSymbols`-agreement pin is now scoped to longs.

### Verified met

Grouping sinks/labels, group + within-group ordering = flat ordering,
NONE/flat behavior, `expandedGroups` persistence across dimension
round-trips, expand-all (grouped-mode only), all nine meta economics,
protection badge + Add/Update Stop label, action-row skeleton (Close/
Stop emit; Add/Detail/Orders disabled stubs), `isStopLossProtecting`
widening (minimal structural seam).

## Thermo-nuclear

### Findings (remediated)

- **Major — short cards displayed the day change instrument-signed**:
  `+$3.00` green beside a P&L row that is position-signed — a losing day
  for a short read as a win. Fixed at the render layer (the model field
  stays the honest instrument move so `summary.dayPnl = dayChange ×
  signed qty` stays correct): the card negates `dayChange`/`dayChangePct`
  for shorts; spec pins the `−$3.00 / .down` display.
- **Minor — long-only invariant lived at call sites.** The predicate's
  docstring claimed long-only but tested `quantity !== 0`; both new call
  sites re-guarded `> 0`. Fixed: `p.quantity > 0` is folded into
  `isStopLossProtecting` itself; call-site guards dropped; short-quantity
  spec added.
- **Minor — vacuous emit specs** in the group spec (emitting on the
  component's own output proves nothing about the `(opened)`/`(closed)`
  and `(action)` bindings). Fixed: real `.mat-expansion-panel-header`
  clicks drive `expandedChange`; a real child-card `.action-close` click
  drives `cardAction`.
- **Minor — `dayChange` degenerate inputs** (`previousClose = 0` rendered
  the full price as the day's "change"; NaN admitted). Fixed: requires
  `previousClose > 0` and `Number.isFinite(marketPrice)`; spec pins the
  zero-close case.
- **Nits fixed:** expansion-key doc comment vs spec-name mismatch (keys
  restore on a dimension round-trip — both corrected); expand-all enabled
  at zero groups → `[disabled]`; `?? undefined` redundancy in the tier
  badge.

### Deferred (documented, next tasks own them)

- **Card-identity retention for #952** — `buildPositionCards` mints fresh
  objects per patch; `track card.key` keeps DOM stable but every card
  re-renders. Harmless with text + placeholder; matters once #952 mounts
  a real chart per card on this input (the signal gallery solved this
  with `retainGalleryCards` — port or give the chart a primitive input).
- **Eager card mount in collapsed groups** — `mat-expansion-panel`
  instantiates projected content regardless of `expanded`; with per-card
  charts in #952, collapsed groups still pay the mount cost.
  `matExpansionPanelContent` lazy rendering is the available seam.
- **v1 `computeProtectedSymbols` divergence** — it inlines
  `quantity !== 0`, so a shorted symbol with a resting sell stop still
  reads "protected" in the v1 positions table while the card (correctly)
  says UNPROTECTED. Pre-existing shipped semantics in a file under active
  edit — flagged, not changed.
- **`stop_limit` distinction (PRD AC4)** — `stopOrders` doesn't tag the
  order subtype; verify the #953 Orders popup surfaces it.
- **Unconsumed `action`/`cardAction` emits** — intentional skeleton for
  #953; the wiring must be consumed in both flat and grouped modes.

## Test results

- Focused: **138 specs green** (util 30, facade 27, view 17, card 9,
  group 5, header/ui-store/pnl remainder) — portfolio-gallery +
  portfolio-pnl suites.
- `tsc --noEmit`: clean on the change set; the repo reports 3
  pre-existing errors in unrelated WIP files (`bulk-swing-sweep.ts`,
  `indicator-config-dialog.component.ts`).
- Full suite: 2 failing suites, 43 tests — `screenshot-capture-contracts`
  (`PositionType` enum grew option values) and `order.component`
  (missing `Functions` provider for the new `ScreenshotService`). Both
  traced to unrelated uncommitted screenshot/options work — pre-existing,
  identical to the #950 review round.

## Round 2 — convergence pass on the fixed diff

All round-1 remediations verified by all three axes — the fixes are
correct and no material new defects were introduced.

| Finding | Disposition |
|---|---|
| LOW — cross-sentinel sink swallow: `isSink` checks both sentinel names for every dimension, so a bucket literally named `(Unknown)` also sinks last | **Documented** — ordering-only, same collision class as the known sink-name item; comment added at the partition |
| LOW — `classifyCardOrders` ↔ `computeProtectedSymbols` longs-agreement pin had no cross-assert | **Fixed** — spec asserts both on a shared fixture |
| LOW — util spec didn't pin the raw instrument-signed `dayChange` for a short | **Fixed** — spec asserts `+3` raw for a short (facade `dayPnl` math depends on it) |
| NIT — IMPL doc: `averageCost: number` vs `number \| null`; `marketValue: quantity × price` vs `\|quantity\|`; `stopDistancePct "signed for shorts"` (unreachable); TEST "calendar days" vs elapsed-days | **Fixed** — docs corrected |
| LOW — transient blank-grid frame while a manual account selection awaits the corrective repin effect | **Documented** — intended trade-off from #950's gate (manual data must not flash; blank grid beats wrong data) |
| NIT — `fmtMoney(NaN)` → `'$NaN'` for degenerate broker price fields; "no signal-timeframe pill" unpin'd | **Deferred** — degenerate-input cosmetics, outside task scope |

**Stopped at 2 rounds** — remaining findings are nits and doc drift. Post-fix: 140 focused specs green, tsc clean on the change set.

## Verdict: PASS

One major-pending-intent (short day-change sign) and a cluster of real
minors — all remediated and re-tested before this verdict. The clone
discipline held: every divergence from the signal-gallery reference is
either deliberate and documented (first-card group ordering, no sunk
lane) or a bug that got fixed (sink ordering, `||` sinks, throw on
unhandled dimension).
