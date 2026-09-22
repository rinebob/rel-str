**Topic:** Watchlist management  
**Topic Slug:** watchlist-mgmt  
**Thread:** Unified list infrastructure  
**Thread Slug:** unified-list-infra  
**Issue:** #496  
**Thread Parent:** #492  
**Topic Parent:** #465  
**Domain:** WATCHLIST  
**Type:** PRD  
**Status:** Approved  
**Created:** 2026-09-22  
**Last Updated:** 2026-09-22  

# PRD: Unified list infrastructure — registry model for symbol lists

## Problem

List behavior is hardcoded. Which lists exist, what they're called, how they
sort, and whether membership is exclusive all live in TypeScript
(`SymbolListName`, `ALL_SYMBOL_LIST_NAMES`, `SYMBOL_LIST_FILTER_OPTIONS`,
name-checks scattered through stores). Consequences, observed during Thread
#466:

- Every surface rebuilt the same concepts its own way — identical bugs (the
  filter-dependent Monitor chip) had to be fixed three times.
- Users cannot create lists at all — adding one means editing an enum, a
  display map, filter options, and exclusivity logic in sync.
- List doc ids ignore `userId`, so two users' `PRIMARY` docs collide — the
  multi-user model is silently broken today.
- Three different sentinels mean "no filter" (`SymbolListName.NONE`, `'ALL'`)
  or "untriaged" (`NO_MEMBERSHIP`), and the boundary between them is
  per-surface folklore.

The user's end state: lists as data — create, rename, reorder, and group
symbols into arbitrary non-exclusive lists ("coming earnings", "look for
breakouts") alongside the fixed triage buckets, with identical behavior on
every surface.

## Solution

Lists become **documents, not TypeScript**. Every symbol list — system or
user-created — is a Firestore doc carrying its own metadata. A single
`SymbolListStore` catalog computed merges the docs into ordered, typed list
objects, and every surface (Swing nav, Chart Review, Signal Review, export,
chips, the future management UI) renders from that catalog. Behavior is
driven by `role`, not by name-checks: `exclusive` lists strip each other on
move; `nonexclusive` lists (Monitor + all user lists) coexist freely.

Scope of this thread is **infra-only** — the registry model, migration, the
unified store/service/view-model, and rewiring every existing surface to
consume it. The list-management UI is a follow-on thread built on top.

## User Stories

1. As an analyst, I want every list-filter dropdown to render the same
   options in the same order — system group first, then my lists — so that
   filtering behaves identically no matter which page I'm on.
2. As an analyst, I want a "Not triaged" pseudo-filter on every list
   dropdown that shows untriaged symbols — zero *exclusive* memberships —
   so that symbols parked in Monitor or a user list but unfiled still
   surface for review. (Interim semantics pre-registry: literal zero
   memberships, since `role` doesn't exist as data yet. The registry makes
   the filter role-aware.)
3. As an analyst, I want Monitor to stay non-exclusive, so that filing a
   monitored symbol into a triage bucket never silently un-monitors it.
4. As an analyst, I want a symbol to belong to at most one exclusive
   (triage) list at a time, moved atomically, so that triage buckets never
   overlap.
5. As an analyst, I want my lists to exist as data, so that a list created
   through any mechanism appears in every dropdown, chip-eligible surface,
   complement computation, and export without code changes.
6. As an analyst, I want user lists to be non-exclusive, so that one symbol
   can live in "coming earnings" AND "breakouts" at once.
7. As an analyst, I want list renames to be cosmetic, so that renaming
   "watch later" to "revisit" breaks nothing downstream.

> **Note on stories 5–7:** these assert *infrastructure capability*, verified
> at the store/service layer — a doc written directly to Firestore (no UI)
> must appear in the catalog and every consumer. The user-facing CRUD UI
> that exercises them is the follow-on management-UI thread.
8. As an analyst, I want my list order to be persisted, so that the
   management UI (follow-on thread) and all dropdowns agree on ordering.
9. As an analyst, I want list changes to propagate live, so that if a list
   is edited elsewhere (management UI, another tab) my open surfaces update
   without a reload.
10. As an analyst, I want my lists isolated per user, so that another user
    can never see or overwrite my list membership.
11. As an analyst upgrading from the current build, I want my existing list
    membership migrated transparently, so that I never lose data or notice
    the restructure.
12. As a developer, I want one store/service API for all list operations —
    load, membership predicates, filtered sequences, add/remove/move —
    so that no surface implements its own list logic.
13. As a developer, I want the `SymbolListName` enum gone from runtime
    behavior, so that list semantics are driven by document data.
14. As a developer, I want one sentinel for "no filter" per surface instead
    of `NONE` vs `'ALL'` folklore, so the filter contract is uniform.

## Implementation Decisions

**Document model (uniform — every list is a doc).**
- Collection `st-symbol-lists`, doc id `{userId}_{key}` — fixes the existing
  multi-user collision as a side effect.
- Shape: `{ key, label, order, role: 'exclusive'|'nonexclusive', hidden,
  symbols[], userId, createdAt, updatedAt }`.
- `key` is the immutable machine identifier (reserved keys `PRIMARY`…
  `MONITOR` for system lists; generated slug for user lists). `label` is
  free-text and renameable — nothing references it.
- `SYSTEM_LIST_DEFS` remains in code as **seed/migration template only** —
  it stamps metadata when materializing system docs, then the docs are the
  truth. Read paths never consult it.
- `SymbolListName` enum dies: lookups go through catalog computeds
  (`byKey`, `byRole`), and pseudo-filters (`ALL`, `NO_MEMBERSHIP`) are never
  persisted.

**Roles drive behavior.** `moveToList` strips membership within
`role==='exclusive'` docs only. `nonexclusive` covers Monitor and every
user list — `toggleSymbolInList` routes by role, not by name.

**Semantics.** "Not triaged" (the `NO_MEMBERSHIP` filter value; label
renamed from "No memberships") currently means zero memberships across all
lists — literal, since `role` doesn't exist as data yet. Under the registry
it becomes role-aware: zero *exclusive* memberships, so monitored-but-
unfiled symbols resurface for review. Chips render the fixed system set
only; user lists appear in dropdowns, exports, complements, and the
management UI.

**Catalog + view-model.** `SymbolListStore` owns the single subscription
(`onSnapshot` — updates are infrequent, live sync is cheap) and exposes
computeds: `lists` (ordered catalog), `byKey`, `exclusiveLists`,
`nonexclusiveLists`, `filterOptions` (grouped: Triage section then My
lists), `unlistedSymbols`/`untriagedSymbols`, membership predicates, and
filtered-sequence helpers. Surfaces inject the store and consume computeds —
no surface loads lists itself.

**Universe contract per surface.** The complement machinery is shared; the
base set is declared per surface: nav + chart-review browse use the tracked
universe; signals-mode grouped view uses its candidate set; export uses the
tracked universe. "Untriaged" is always computed against the declaring
surface's universe.

**Dropdowns.** A shared grouped-option model: Triage group (five system
buckets + Not triaged + Monitor) then My lists (user docs by `order`).
Each surface still supplies its own "show everything" anchor, unified to a
single sentinel. `RhSelectMenu` needs option-group support; option typing
goes generic (`RhSelectOption<T>`) to kill the three `as SymbolListFilter`
boundary casts.

**Migration.** Lazy-on-load, extending the MONITOR-migration pattern:
rekey each existing doc to `{userId}_{key}` (system lists get metadata
stamped from `SYSTEM_LIST_DEFS`), batch write+delete, failure returns the
unmigrated read and retries next load. No ops script, no downtime.

**Chips.** `SymbolListActionsComponent` renders the five exclusive chips +
Monitor only — unchanged UI. Chip state/action already membership-driven.

## Testing Decisions

Tests exercise the public store seam (external behavior), not internals:
- `SymbolListStore` specs against a mocked `SymbolListService`: catalog
  merge order, `byRole` semantics, exclusive-move strips only exclusive
  docs, nonexclusive coexistence, untriaged computation, filter-option
  grouping, live snapshot updates re-deriving computeds.
- `SymbolListService` specs: `{userId}_{key}` doc ids, migration batch
  (rekey + stamp + delete, failure fallback), user-list CRUD writes.
- Surface specs unchanged in shape — they mock the store contract, which
  keeps mocks honest by construction (existing pattern from #466).
- Prior art: `symbol-nav.feature.spec.ts` (real store + mocked service),
  `symbol-list.service.spec.ts` (batched writes, failure paths).

## Out of Scope

- **List-management UI** (create/rename/delete/reorder, drag symbols,
  include/exclude) — a dedicated follow-on thread under this Topic. The
  infra must *support* it; building it is deferred.
- Changing triage workflow semantics (what Primary/Secondary/etc. mean).
- Sharing/subscribing to other users' lists.
- Per-list notification, signal, or automation behavior.

## Technical Context

- Existing `st-symbol-lists` docs are rekeyed in place on first load
  post-deploy; brief duplication window is self-healing (old doc deleted in
  the same batch).
- `onSnapshot` on ≤ ~50 small docs is negligible cost; it does convert the
  store's read path to a subscription, which is a deliberate architectural
  change, not an accident.
- `RhSelectMenu` option-group support is new component work, sized at
  blueprint.

## System Context

```mermaid
flowchart LR
  subgraph FS[Firestore st-symbol-lists]
    SD[System docs {userId}_{key}]
    UD[User list docs]
  end
  SVC[SymbolListService<br/>CRUD + move/add/remove + migration]
  SLS[SymbolListStore<br/>catalog computeds, universes, predicates]
  NAV[Swing nav]
  CR[Chart Review]
  SR[Signal Review + export]
  CHIP[Symbol-list-actions chips]
  MGMT[List mgmt UI — follow-on thread]
  FS -- onSnapshot --> SVC --> SLS
  SLS --> NAV & CR & SR & CHIP
  MGMT -.->|future| SVC
```
