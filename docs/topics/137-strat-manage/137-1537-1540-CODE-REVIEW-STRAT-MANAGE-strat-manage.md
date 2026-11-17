**Topic:** Strategy Builder UI  
**Topic Slug:** strat-manage  
**Thread:** OpsStrat Manage Page Overhaul  
**Thread Slug:** page-overhaul  
**Issue:** #1537  
**Thread Parent:** #1510  
**Topic Parent:** #137  
**Task:** #1540  
**Domain:** STRAT-MANAGE  
**Type:** CODE-REVIEW  
**Status:** Complete  
**Created:** 2026-11-17  
**Last Updated:** 2026-11-17  

# Code Review — #1540 FE: Route/nav migration + store + table shell

## Scope reviewed

New: `services/strategy-manage.service.{ts,spec.ts}`,
`stores/strategy-manage.store.{ts,spec.ts}`,
`pages/strategy-manage/strategy-manage.component.{ts,html,scss,spec.ts}`.
Modified: `interfaces.ts`, `constants.ts`, `core-routes.ts`,
`core-routes.spec.ts`, `nav-sections.spec.ts`,
`options-strategy-dashboard.component.{html,spec.ts}`,
`paper-trading.component.html`,
`scripts/verify/design-system-foundation-migration-1171.ts`.
Deleted: `pages/strategy-builder/strategy-builder.component.*`.

## Axes

### Standards — PASS (1 minor + 3 nits, all fixed in-cycle)

- Convention-verified end to end: store mirrors the
  options-strategy-dashboard signalStore pattern (resubscribe guard,
  catchError→patchState, takeUntilDestroyed); service mirrors the legacy
  read path with the BE reader's `runState` discriminator (client-side
  so no composite index); `.dse-tabs` markup matches the analysis-page
  precedent; vl-mixin SCSS, jest mock conventions, aliases, OnPush,
  standalone all conform.
- **FIXED (real)** `scripts/verify/design-system-foundation-migration-1171.ts`
  eagerly `readFileSync`'d the deleted `strategy-builder.component.*`
  and is registered in run-all — it crashed with ENOENT and would have
  broken the verify suite. Retargeted `strategyBuilder` →
  `strategyManage`; dropped the two page-specific checks that no longer
  apply (stopped-badge retokenization, 24px dense-row override — F2
  territory); replaced with a nowrap-header check. Also healed a stale
  `mat-icon`-only banner regex — the DS migration moved banners to
  `dse-icon`, so optionsDash/paperTrading were failing pre-existing;
  the regex now accepts either icon form. Script back to 103/103.
- **FIXED (nit)** dangling `.mode-tabs` modifier dropped;
  `aria-label="Instance mode"` added to the tablist.
- **ACCEPTED (nit)** `catchError → of([])` wipes prior instances on
  transient error and completes the stream — identical semantics to the
  dashboard-store precedent; consistent beats divergent here.
- **ACCEPTED (nit)** tablist has no arrow-key nav — matches the
  page-level precedent; the richer pattern only exists in dialogs.

### Spec — PASS (1 minor + 3 nits; minor fixed in-cycle)

- **FIXED** `instance.variant.name` could throw on a malformed doc
  passing the light FE filter (half-written doc with vocab runState but
  no variant) → `variant?.name`. The looser-than-BE filter is
  acceptable for F1 — BE normalizes authoritatively; the template just
  can't crash.
- **FIXED** error and empty states co-rendered ("Failed to load…" +
  "No paper instances yet") → empty state gated on `!store.error()`.
- All three AC verified met and pinned: route registered auth-gated +
  lazy, no redirect shim (wildcard fallthrough is the app's retired-route
  convention — spec-pinned via the retired list), zero STRATEGY_BUILDER
  callers remain, store has the userId-scoped stream + paper/real
  computeds + loading/error, tabs + table shell render streamed rows.
- **ACCEPTED (nit)** `createdAt` non-ISO sort is a malformed-doc edge —
  `String()` coercion can't crash, just sorts oddly.
- **ACCEPTED (deviation, disclosed)** legacy form/store/service retained
  — the form carries a foreign session's uncommitted curated-variant
  edits (`PickerVariantFamily`) and its spec depends on the legacy
  store. Deleting it would destroy another session's work. Tracked in
  the IMPL as-built note; cleanup should land when that session ships.

## Verdict

**PASS.** 21 new specs green (service 7, store 6, component 8) +
220 touched-suite tests, `npm run build` clean, verify script healed
103/103. One real defect (broken registered verifier) and three minors
fixed in-cycle.
