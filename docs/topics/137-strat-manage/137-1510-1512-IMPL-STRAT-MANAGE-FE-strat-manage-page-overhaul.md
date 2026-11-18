**Topic:** Strategy Builder UI  
**Topic Slug:** strat-manage  
**Thread:** OpsStrat Manage Page Overhaul  
**Thread Slug:** page-overhaul  
**Issue:** #1512  
**Thread Parent:** #1510  
**Topic Parent:** #137  
**Domain:** STRAT-MANAGE  
**Type:** IMPL  
**Status:** Draft  
**Created:** 2026-11-14  
**Last Updated:** 2026-11-14  

# IMPL (FE) — OpsStrat Manage Page Overhaul

## Scope

Rename/repurpose `options/strategy/build` → `options/strategy/manage`,
rebuild the page around the variant→instance model: Paper/Real tabs,
sortable/filterable instance table, start/stop actions, two create dialogs
+ Export-to-JSON, results popup, analysis link, caller migration.

## Design

### 1. Route + nav migration

- `AppRoutes.STRATEGY_BUILDER` ('options/strategy/build') →
  `STRATEGY_MANAGE` ('options/strategy/manage'); update `PAGE_INFO`
  (title "Strategy Manage" / nav "Manage", icon), `core-routes.ts`, nav
  config (`constants.ts` `strategy-builder` entry → `strategy-manage`,
  href `options/strategy/manage`), and every importer of the old route.
- No redirect shim — old path 404s; all current callers migrate.
- Rename component dir `pages/strategy-builder/` → `pages/strategy-manage/`
  (components/classes renamed to match; keep git-following renames).

### 2. Manage store — `stores/strategy-manage.store.ts`

- Replaces `strategy-builder.store.ts`. Signal store (per the
  feature-state convention): instances stream (Firestore query,
  userId-scoped), mode partition (`paper`/`real` computed lists),
  position-status join (per-instance open-position count/status via
  `listStrategyPositions` or a positions listener), loading/error.
- Ad hoc named variants live in an in-memory signal list for the session
  (ephemeral — US-2); catalog service merges them with the shared
  registry list.

### 3. Instance table + tabs — `strategy-manage.component.*`

- Paper / Real tabs bound to `mode`; table columns: ID, symbol, variant
  name, stop type, trigger, runState, open-position (yes/no + status),
  created, actions (start/stop, results, analysis link, delete).
- Sort/filter via the design-system table patterns already used on
  sibling pages.
- Real tab renders in v1; create/start disabled for real rows.

### 4. Create New Instance dialog — `manage-create-instance.component.*`

- Named-variant picker (registry + ad hoc), mode select (paper default;
  real disabled v1), stop-type select (real only — required, `ALL` never
  offered), trigger select (daily | signal), multi-symbol picker.
- Builds `ManageInstance` per symbol, generates the ALL-CAPS ID via
  `manage-instance-id`, validates uniqueness (client-side check on the
  candidate ID doc existence; the ID is the dedup key).
- Writes via Firestore SDK (existing service pattern) — `runState:
  'UNSTARTED'`.

### 5. Create New Strategy dialog — `manage-create-strategy.component.*`

- Template picker (from catalog); renders per-leg Δ + DTE inputs from the
  template shape; generates a suggested editable name.
- Save = ad hoc variant added to the session list (ephemeral) + Export to
  JSON button opens a dialog with the variant serialized in registry JSON
  format for copy-paste.

### 6. Results summary popup — `manage-results-dialog.component.*`

- Reuses `listStrategyPositions` + `getStrategyEquityCurve` callables:
  stats block, open-position summary, compact equity sparkline.
- Analysis link: `window.open('/options/strategy/backtest/analysis/' +
  instanceId, '_blank')` — new tab per US-7.

## Task breakdown (FE)

1. **F1 — Route/nav migration + store + table shell** — route rename,
   callers migrated, tabs skeleton, instances streaming.

   **As-built (#1540):** `AppRoutes.STRATEGY_BUILDER` → `STRATEGY_MANAGE`
   (`'options/strategy/manage'`); PAGE_INFO title "Strategy Manage" (icon
   `build` retained — no icon was specified); nav item
   `strategy-manage`/"Manage". Route loads
   `pages/strategy-manage/strategy-manage.component` (`StrategyManageComponent`)
   — new dir, not a `git mv` rename, because the page is a fresh skeleton
   rather than a renamed legacy component. Old path 404s: no shim,
   `core-routes.spec` retired-list entry pins it. Callers migrated:
   options-strategy-dashboard "Manage Strategies" link, paper-trading
   "Strategy Manage" link + empty-state copy, `nav-sections.spec`,
   `core-routes.spec` (registered + retired + AppRoutes map).
   `strategy-manage.service.ts` streams `collectionData` on the shared
   `st-strategy-instances` root with the single `userId` `where` —
   manage-shape (`runState` ∈ vocabulary) and soft-delete filters run
   client-side so no composite index is needed, mirroring the BE reader's
   `runState` discriminator. `strategy-manage.store.ts` is the signal
   store: `instances`/`isLoading`/`error` + `paperInstances`/`realInstances`
   computeds. Page skeleton: `.dse-tabs` tab bar (the analysis-page
   pattern) over a dense-table shell — id/symbol/variant/runState
   columns; the full column set + sort/filter + badges is F2.
   **Deviation:** the legacy `strategy-builder-form.component.*`,
   `strategy-builder.store.*`, and `strategy-builder.service.*` were NOT
   deleted — the form carries a foreign session's uncommitted
   curated-variant edits (`PickerVariantFamily`), and its spec depends on
   the legacy store. Only the routed page component was removed; the
   remaining legacy files' cleanup defers to that session/follow-up.
   Specs: service 7, store 6, component 8.
2. **F2 — Table complete** — columns, sort/filter, runState badges,
   position-status join, start/stop actions.

   **As-built (#1546):** `strategy-manage.service` gained
   `setRunState(id, runState)` — `updateDoc` + `updatedAt` stamp, same
   `requireUserId` gate as the reader. `strategy-manage.store` gained
   `openPositions` state (one-shot `listStrategyPositions$` fetch inside
   `load()` — position writes are engine-owned so a poll/stream is
   unnecessary), the
   `openPositionsByInstance` computed (Record<instanceId, Position[]>),
   and `toggleRunState(instance)` mapping UNSTARTED→ACTIVE,
   ACTIVE→STOPPED, STOPPED→ACTIVE — restart never returns to UNSTARTED,
   and real-mode rows are a no-op at the store seam (the UI also disables
   the button). The Firestore stream delivers the optimistic update; no
   local patch needed. The component now renders the full 9-column table
   (Instance ID, Symbol, Variant, Stop Type, Trigger, Run State, Open
   Position, Created, Actions) with paper-trading's multi-sort convention
   (click asc→desc→unsorted, shift+click secondary keys, `aria-sort` +
   sort icon). Filter bar: text input over `id + symbol + variant.name`,
   run-state select (ALL/UNSTARTED/ACTIVE/STOPPED), position-status
   select (all/open/waiting/flat — the same three buckets the cell
   renders, so the filter matches what the user sees). Position cell:
   `Yes · {status}` from the join; `Waiting` for ACTIVE-flat (the
   noon-gate state — spec-pinned so it can never render blank); `No` for
   non-ACTIVE flat. Action button is
   `ds-btn outline small` — Start/Stop/Restart label per run state,
   `[disabled]` on real rows (row also dimmed via `.real-row` opacity).
   Specs: service +1 (9), store +7 (13), component +11 (19). Build clean;
   the only new warning introduced during dev (`variant?.name` on a
   non-nullable field, NG8107) was resolved to `.name`.
3. **F3 — Create New Instance dialog** — variant picker, mode/stop/trigger
   selects, multi-symbol, ID gen + dedup, writes.
4. **F4 — Create New Strategy dialog + Export JSON** — template-driven leg
   form, ephemeral variant save, JSON export dialog.
5. **F5 — Results popup + analysis link** — stats/positions/sparkline
   dialog, new-tab analysis link.

## Dependencies

- S1–S3 (SHARED) block all FE tasks.
- F1 blocks F2–F5. F3 needs the SHARED ID generator + catalog.
- Position-status join (F2) needs BE positions existing — can land with
  mocked data behind the seam if B1 isn't done; verify with real data in
  QA.
