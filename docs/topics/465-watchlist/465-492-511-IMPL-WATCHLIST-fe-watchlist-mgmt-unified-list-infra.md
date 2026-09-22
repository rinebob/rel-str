**Topic:** Watchlist management  
**Topic Slug:** watchlist-mgmt  
**Thread:** Unified list infrastructure  
**Thread Slug:** unified-list-infra  
**Issue:** #511  
**Thread Parent:** #492  
**Topic Parent:** #465  
**Domain:** WATCHLIST  
**Type:** IMPL  
**Status:** Draft  
**Created:** 2026-09-22  
**Last Updated:** 2026-09-22  

# IMPL (FE): Unified list infrastructure

PRD: `465-492-496-PRD-WATCHLIST-watchlist-mgmt-unified-list-infra.md`.
Single FE blueprint — no BE (no callable/schema work), no SHARED area
(`RhSelectMenu` is feature-local under `savant-trader/components`).

## Architecture

### Document model

- Collection `st-symbol-lists` stays flat (repo convention); doc id becomes
  `{userId}_{key}` — fixes the multi-user collision (`listId` ignoring
  userId) as a side effect.
- Doc shape: `{ key, label, order, role, hidden, symbols[], userId,
  createdAt, updatedAt }`.
  - `key` — immutable machine id. Reserved for system lists
    (`PRIMARY`…`HIDE`, `MONITOR`); generated slug for user lists.
  - `label` — renameable display text; never a lookup key.
  - `order` — sort position; system block orders 0–5, user block after.
  - `role` — `'exclusive'` (system triage only) | `'nonexclusive'`
    (MONITOR + every user list). Behavior keys off role, never name.
  - `hidden` — excluded from filter dropdowns when true (default false).
- `SYSTEM_LIST_DEFS` const in code = **seed/migration template only**.
  Read paths never consult it.
- Pseudo-filters (`'ALL'`, `NO_MEMBERSHIP`) are never persisted; a single
  shared sentinel replaces the `NONE`/`'ALL'` split per surface.

### Service (`SymbolListService`)

- `watchLists$()` — `collectionSnapshots` on `where('userId','==',uid)`
  (precedent: `spread-run.service`). Emits `SymbolListDef[]`.
- Lazy migration inside the snapshot stream: docs missing `key`/`role` or
  bearing legacy ids are batched — rekey to `{userId}_{key}`, stamp
  metadata from `SYSTEM_LIST_DEFS`, map `PAST_SIGNALS` → `MONITOR`,
  delete legacy doc. Failure logs + yields the unmigrated read; retries
  next emission.
- Mutations keyed by composite id: `addToList`, `removeFromList`,
  `moveToList` (accepts the exclusive-key set from the store — the service
  stays role-agnostic), `createList`, `renameList`, `deleteList`,
  `setListOrder`.

### Store (`SymbolListStore`) — snapshot truth, no optimistic layer

- `loadSymbolLists()` → single `watchLists$()` subscription
  (`takeUntilDestroyed`, guarded once). Each emission patches `lists`.
- **Optimistic updates are deleted.** Firestore latency compensation emits
  local writes to the listener immediately; a rejected write re-emits
  server state = automatic revert. Mutations delegate to the service and
  surface write errors via snackbar only.
- Computeds: `catalog` (defs sorted by order), `byKey`, `byRole`,
  `symbolLists` (derived `Record<key, symbols[]>` — compat shape so
  existing consumers don't churn), `untriagedSymbols` (role-aware: zero
  exclusive memberships; supersedes `unlistedSymbols`), `filterOptions`
  (grouped: Triage section, then My lists).
- `toggleSymbolInList` routes by the target's `role`: exclusive →
  `moveToList` over exclusive keys; nonexclusive → add/remove. The
  MONITOR name-check dies with the enum.

### Components / surfaces

- `RhSelectMenu` — option groups + generic `RhSelectOption<T>` typing
  (kills the three `as SymbolListFilter` casts).
- `SymbolListActionsComponent` chips — unchanged five-triage + Monitor
  row; driven by `role` lookups rather than enum iteration.
- Surfaces (nav, review-header, signal-review-header, chart-review
  viewport, signal-review facade/export) consume `filterOptions` +
  catalog computeds; each declares only its universe + its "show
  everything" anchor label.
- `SymbolListName` enum and `ALL_SYMBOL_LIST_NAMES`/
  `EXCLUSIVE_SYMBOL_LIST_NAMES` retire — replaced by `SYSTEM_LIST_KEYS`
  (strings, seed/migration use) and `byRole` lookups.
  `SymbolListFilter` becomes `string`-key based over catalog keys +
  pseudo-filter constants.

## Phases

- **P1 — Core data layer.** Types/defs, service (watchLists$, composite
  ids, migration, CRUD incl. user-list ops), store subscription + catalog
  computeds + snapshot-truth mutations + role-aware untriaged.
- **P2 — Surfaces.** `RhSelectMenu` groups/generics, shared `filterOptions`
  + single sentinel, rewire every consumer, delete enum + casts.
  Blocked by P1.

## Risks

- Snapshot echo semantics on mutation failure (auto-revert) — covered by
  store specs asserting the emission contract.
- Migration mid-flight (crash between rekey writes) — batched per doc;
  partial state self-heals on next load.
- Consumers holding stale `Record` assumptions during transition — the
  derived `symbolLists` compat computed bridges P1 → P2.
