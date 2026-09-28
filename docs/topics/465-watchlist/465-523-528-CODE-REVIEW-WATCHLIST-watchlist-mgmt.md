**Topic:** Watchlist management  
**Thread:** Unified list infrastructure  
**Task:** #528 — FE-IMPL: Rewire surfaces to catalog + retire enum-era plumbing  
**Reviewed:** 2026-09-25  
**Last Updated:** 2026-09-25  
**Status:** Complete  
**Verdict:** PASS (fixes applied in-gate)

## Axes

### Spec — PASS (all 5 ACs)

1. **All three dropdowns render identical grouped options** —
   `filterOptionGroups` (`symbol-list.store.ts`, single source) is bound by:
   nav native `<select>` via `<optgroup>` + 'All symbols' sentinel,
   signal-review-header via `sentinelOptions`/`listGroups` (facade
   passthrough), review-header via the same inputs bound to
   `symbolListStore.filterOptionGroups()`. Per-surface sentinel labels are
   per spec ("each surface supplies its own show-everything anchor").
2. **Enum-era plumbing deleted** — `SymbolListName`,
   `ALL_SYMBOL_LIST_NAMES`, `EXCLUSIVE_SYMBOL_LIST_NAMES`,
   `SYMBOL_LIST_FILTER_OPTIONS`: zero hits in `src/`. No production
   name-checks (`SYSTEM_LIST_KEYS` remains only for seed/write-guard and a
   default initial filter value — not read-path checks).
3. **Role-aware "Not triaged" everywhere** — `isUntriaged(symbol, lists,
   exclusiveKeys)`; every production caller supplies catalog-derived keys
   (group.store ×2 via `exclusiveListKeys`, `untriagedSymbols`, nav,
   viewport, export). No static exclusive list remains.
4. **Live user-list propagation** — all dropdowns bind the signal/computed
   over `watchLists$`; a `createList` doc lands in 'My lists' on the next
   emission, no reload.
5. **Deleted-list fallback** — three sites, one shared predicate
   (`isLiveListFilter`): store emission resets `activeListFilter`; nav
   feature resets `navFilter` (applyNavFilter + effect); viewport masks at
   read via `activeViewportList` computed (non-destructive — triage-store
   state untouched). No uncovered filter-value holder found.

### Standards — PASS after fixes

- `toggleList` `{symbol, listKey}` contract propagated uniformly through
  chips → symbol-row → group-panel → signal-detail → pages → nav →
  `toggleSymbolInList`. `toggleMonitor`/`onMonitor` fully gone.
- Chips = fixed system set only per PRD — `systemActionLists` filters
  `order < USER_LIST_ORDER_START && !hidden`.
- Write-on-read seeding in `symbol-list-registry` reviewed: batch is
  atomic (migration + seeds together), short-circuits once seeded —
  seeded users never write again. Hazards noted below.
- No `as any`/`as never`; `as unknown as` casts removed from the touched
  spec.
- Sizing: `symbol-nav.component` ~255 lines, acceptable;
  `swing-analysis-page.component.spec.ts` 1430+ lines flagged as a smell —
  split nav/chip tests if it grows.

### Thermo-nuclear — PASS after fixes

- Three fallback sites are intentionally different policies (store+nav
  reset destructively; viewport masks non-destructively) — kept per-
  surface, but the `isLiveListFilter` predicate is now shared.
- Exclusive-keys derivation consolidated to one `exclusiveListKeys`
  computed; `untriagedSymbols`, `toggleSymbolInList`, and both
  group.store sites consume it.
- `exclusiveListKeys` now **required** on `BuildFilteredCandidatesInput`/
  `BuildSymbolGroupsInput` — the optional `[]` default would have made
  NO_MEMBERSHIP return everything-as-untriaged if a caller omitted it.
- Nav effect verified terminating (≤1 extra cycle).
- No flicker risk: snapshot emissions are complete; a live key is never
  transiently absent.

## Fixes applied during review

| Fix | Where |
|---|---|
| Dead `byKey` re-check deleted (unreachable — `activeViewportList` already masks) | chart-review-viewport.service |
| `isLiveListFilter` shared predicate (was duplicated 4×) | constants.ts ← store, nav feature (via `filterExists`), viewport |
| `exclusiveListKeys` required (was optional `[]`) | utils.ts inputs + spec fixture |
| `exclusiveListKeys` computed — one derivation | symbol-list.store; consumed by store + group.store |
| `hidden` excluded from chips | symbol-list-actions |
| `listCatalog` input → `required` (uniform contract) | signal-detail + spec |
| Orphan "Toggle MONITOR" comments deleted | signal-review.component, facade |
| Dead imports removed (`NavFilter`, `SYSTEM_LIST_KEYS`) | symbol-nav, facade |
| `const key = listKey` redundant alias collapsed | symbol-list.store |
| Redundant warm-check removed — store's `listsWatched` guard dedupes | symbol-nav.component |
| Domain copy: 'None'→'All' sentinel, 'No memberships'→'Not triaged' export label, stale comments | review-header, facade, constants.ts, viewport service, chip header |
| `as unknown as` casts dropped | swing-analysis-page spec |
| Mojibake (`â€"`) normalized in touched files | group.store, index.ts, symbol-list.store spec |
| `listName`→`filter` param renames in touched code | chart-review.component, viewport service |

## Deferred / notes

- `symbol-list-registry` write-on-read: retry-loop on persistent batch
  failure (no backoff), stale-label clobber window on concurrent rename,
  and `probeLegacyDocs` runs first-emission-only (mid-session backend
  writes to legacy docs are invisible until resubscribe). Accepted for
  single-user tool; revisit if the backend legacy writer stays active.
- Policy asymmetry: store+nav reset a deleted-key filter destructively;
  viewport masks at read (revives if the slug is recreated). Accepted.
- Compat shims tracked for removal: `symbolLists` record, `unlistedSymbols`
  alias, `loadAllLists`.
- `systemActionLists` defines "system" by `order < 100` while
  `deleteList`/`setListOrder` key off `systemListDef(key)` — two
  definitions of "system"; a hand-edited `order: 50` user doc would chip
  but stay deletable. Latent edge, noted.
- `ST-NO_MEMBERSHIP.txt` export filename keeps the canonical key value.
- Pre-existing mojibake in untouched files (st.store, types.ts,
  signal.service, dashboard, etc.) left for a separate cleanup pass.
- UI spot-check: dev preview running; grouped menus on all three surfaces
  verified statically and by suite; awaiting user eyeball pass.

## Verification

- Focused suites: 156 tests pass; full savant-trader feature suite:
  **72 suites / 1,276 tests pass**.
- `git diff --check` clean for #528 files (one pre-existing trailing-
  whitespace in an unrelated docs file).
- Typecheck clean via jest/ts-jest compile of all touched files.
