**Topic:** Watchlist management  
**Topic Slug:** watchlist-mgmt  
**Thread:** Unified list infrastructure  
**Thread Slug:** unified-list-infra  
**Issue:** #511  
**Thread Parent:** #492  
**Topic Parent:** #465  
**Domain:** WATCHLIST  
**Type:** TEST  
**Status:** Draft  
**Created:** 2026-09-22  
**Last Updated:** 2026-09-22  

# Test Plan (FE): Unified list infrastructure

## E2E User Journeys

- Analyst picks "Not triaged" on nav / chart-review / signal-review →
  sees symbols in zero exclusive lists; monitored-but-unfiled appears.
- Analyst toggles Monitor chip on any surface → membership persists;
  symbol remains untriaged for the exclusive-only filter.
- A user-list doc written directly to Firestore appears in every
  dropdown's "My lists" group live (no reload).
- Existing user's legacy docs (name-ids, PAST_SIGNALS) migrate on first
  load with zero visible change.

## Integration Tests

- `SymbolListStore` + mocked `SymbolListService.watchLists$` (Subject):
  emission → catalog computeds update; a second emission (live sync)
  re-derives; write-failure → snackbar + no state divergence.
- Store mutation → service spy: exclusive toggle calls `moveToList` with
  exclusive keys only; nonexclusive toggle calls add/remove; re-filing
  preserves nonexclusive membership.
- `RhSelectMenu` + grouped options → group headers render, generic value
  flows typed to consumers (no casts).
- Nav / viewport / facade consuming `filterOptions` + `untriagedSymbols`.

## Unit Tests

- `isUntriaged`/complement helpers: exclusive-only membership counts.
- Migration logic: rekey id derivation, `PAST_SIGNALS`→`MONITOR` mapping,
  merge with existing target doc, failure fallback.
- Catalog computeds: ordering, `byKey`, `byRole`, `hidden` exclusion,
  grouped `filterOptions` shape.
- Slug generation for user-list keys (collision suffixing).

## Test Seams

- Highest seam: `SymbolListStore` public surface with mocked service
  (existing `symbol-nav.feature.spec.ts` pattern — real store, mocked
  boundary).
- Service seam: mocked Firestore collection/doc fns (existing
  `symbol-list.service.spec.ts` pattern).
- Component seam: TestBed render for `RhSelectMenu` groups.

## Existing Test Coverage

- `utils.spec.ts` (isUnlisted/shouldShowInListFilter — retarget to
  untriaged semantics), `symbol-nav.feature.spec.ts` (nav sequence,
  coexistence), `swing-analysis-page.component.spec.ts` (option order —
  updates to grouped shape), `symbol-list.service.spec.ts` (migration —
  extends to rekey+stamp).
- Gaps this plan fills: live-sync re-derivation, user-list CRUD at the
  service layer, grouped dropdown rendering, role-aware untriaged.

## Edge Cases

- Empty state: user with zero docs → system lists still render (defs
  materialize), My lists group empty/absent.
- Migration failure → unmigrated read, retry next emission.
- `order` collisions between user docs → stable secondary sort (label).
- Snapshot emission during in-flight mutation → latency-compensated
  echo must not double-apply or flicker.
- Filter state referencing a deleted list key → falls back to the
  surface's show-everything anchor.
