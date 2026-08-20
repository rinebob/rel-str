**Topic:** Strategy Builder UI  
**Issue:** #137  
**Domain:** STRAT-BUILD-UI  
**Type:** IMPL  
**Area:** FE  
**Status:** Draft  
**Created:** 2026-08-16  
**Last Updated:** 2026-08-19  

## Overview

Build the Strategy Builder UI — a full CRUD interface for options strategy instances. List view, create/edit dialog form, lifecycle toggle, and navigation link to the Options Strategy Dashboard.

## Modules to build

### 1. Strategy Builder Service

`src/app/features/rh-agent/services/strategy-builder.service.ts`

Firestore CRUD service following the `spread-list.service.ts` pattern. Direct Firestore writes via Angular Firestore SDK, scoped by `userId`.

Methods:
- `loadInstances$(): Observable<StrategyInstanceConfig[]>` — query all instances for the current user, sorted by lifecycle state then created date
- `createInstance(config): Promise<void>` — `setDoc` with auto-generated ID
- `updateInstance(id, changes): Promise<void>` — `updateDoc`
- `deleteInstance(id): Promise<void>` — `deleteDoc` (soft delete preferred — set `lifecycleState: STOPPED` and a `deletedAt` timestamp; hard delete only if no open positions reference it)
- `setLifecycleState(id, state): Promise<void>` — convenience method for toggle

### 2. Strategy Builder Store

`src/app/features/rh-agent/stores/strategy-builder.store.ts`

NgRx SignalStore following the `options-strategy-dashboard.store.ts` pattern.

State:
- `instances: StrategyInstanceConfig[]`
- `isLoading: boolean`
- `error: string | null`
- `selectedInstance: StrategyInstanceConfig | null` (for edit form)

Computed:
- `activeInstances` — filtered to `lifecycleState === ACTIVE`
- `pausedInstances` — filtered to PAUSED
- `stoppedInstances` — filtered to STOPPED

Methods:
- `load()` — calls service `loadInstances$()`, manages subscription with DestroyRef
- `create(config)` — calls service, refreshes list
- `update(id, changes)` — calls service, refreshes list
- `remove(id)` — calls service, refreshes list
- `toggleLifecycle(id, state)` — calls service, refreshes list
- `selectForEdit(instance)` — sets `selectedInstance`
- `clearSelection()` — clears `selectedInstance`

### 3. Strategy Builder Component — List View

`src/app/features/rh-agent/pages/strategy-builder/strategy-builder.component.ts`

Standalone OnPush component with external template/styles.

List view features:
- Table: Instance ID, Symbol, Spread Type, Frequency, Lifecycle State, Exit Policies (comma-separated)
- Sortable by lifecycle state (active first)
- Action buttons per row: Edit, Toggle Lifecycle (cycle ACTIVE → PAUSED → STOPPED → ACTIVE), Delete, View in Dashboard
- "Create New Strategy" button at top
- Lifecycle state shown as a colored badge (green=ACTIVE, yellow=PAUSED, red=STOPPED)

### 4. Strategy Builder Component — Create/Edit Dialog

`src/app/features/rh-agent/pages/strategy-builder/strategy-builder-form.component.ts`

Standalone OnPush dialog component using `MatDialog`. Opened from the list component via `MatDialog.open()` with `{ instance: StrategyInstanceConfig | null }` as dialog data. Single compact form — no stepper.

**Form layout (single screen, compact fields in rows):**
- Row 1: Spread type dropdown, Symbol input, Frequency dropdown, Open time input
- Row 2: Target delta (0.01-1.0), DTE min, DTE max (must be > DTE min)
- Exit policies: multi-select chips with conditional parameter fields:
  - CLOSE_AT_TARGET_GAIN → target gain % input
  - CLOSE_AT_DTE_THRESHOLD → DTE threshold input
  - STOP_LOSS → stop loss % input
  - TRAILING_STOP → trailing stop % input (defaults to stop loss value)
  - ROLL → roll DTE threshold + roll target delta inputs
  - EXIT_AND_REPLACE → no params
  - HOLD_TO_EXPIRATION, WHEEL_IF_ASSIGNED, HOLD_SHARES_IF_ASSIGNED → no params
- Live instance ID preview at bottom of form
- Market regime: removed from v1 dialog (config stored only, not enforced by BE)
- Save button → calls `store.create()` or `store.update()`, closes dialog on success
- Cancel button → closes dialog without saving

### 5. Route registration

- Add `STRATEGY_BUILDER` to `AppRoutes` enum in `interfaces.ts`
- Register lazy-loaded route with `authGuard` in `core-routes.ts` (list view only — no /new or /edit/:id routes)
- Add navigation link from Options Strategy Dashboard to Strategy Builder

### 6. Navigation link from dashboard

Add a "Manage Strategies" button to the Options Strategy Dashboard header that navigates to `/strategy-builder`.

### 7. Manual open pass trigger ("Open Now" button)

Add an "Open Now" button to the Options Strategy Dashboard header that triggers the open pass for the currently selected instance (or all active instances if "Combined" is selected).

FE components:
- `CallableName.OPEN_PASS_MANUAL` added to `constants.ts`
- `openPassManual$(instanceId?: string)` method in `OptionsStrategyService` — calls the callable function
- `openNow()` method in `OptionsStrategyDashboardStore` — calls service, refreshes positions on success, sets error on failure
- "Open Now" button in dashboard header (next to scope dropdown), shows loading state during call
- Positions refresh after successful open

BE component (cross-area):
- `optionsOpenPassManual` callable function in `options-strategy-passes.ts` (follows `optionsMarkPassManual` pattern)
- Accepts optional `instanceId` parameter to target a specific instance
- Requires authenticated Firebase user
- Exported in `functions/src/index.ts`

### 8. Dashboard split layout

Redesign the Options Strategy Dashboard from a stacked layout (tables above chart) to a split layout (positions on left, equity curve on right).

Changes:
- Header: strategy scope dropdown (Combined or per-instance) replacing the button toggle, scales to 50+ strategies
- Stats strip: remains full-width above the split
- Left panel: open positions table (top) + closed positions table (bottom), scrollable
- Right panel: equity curve chart, sticky/fixed height matching the left panel
- Both panels share the same vertical space; left panel scrolls independently if positions overflow
- Responsive: on narrow screens, stacks vertically (tables above chart)
- Equity curve reflects the selected scope (Combined or per-instance)

## Cross-area boundaries

- Depends on **SHARED** unified type, `ExitPolicy`, `LifecycleState`, ID generator
- Depends on **BE** Firestore rules allowing FE writes to `options-strategy-instances`
- The "View in Dashboard" link navigates to `/options-strategy-dashboard` with a query param for instance filtering

## Technical risks

- **Dialog form complexity:** Conditional field visibility per exit policy, dynamic phase adding. Need reactive forms with `FormArray` for phases and exit policies.
- **ID generation timing:** The ID preview needs to update live as the user types. The ID is finalized on save (date is creation date, not form-open date).
- **Delete safety:** Hard delete should be blocked if open positions reference the instance. v1: soft delete only (set STOPPED + deletedAt).

## Testing

- Service unit tests: CRUD operations, error handling, userId scoping
- Store unit tests: load/create/update/delete/toggle state transitions, error paths
- Component tests: list rendering, dialog form field visibility, form validation, ID preview
- ID generator unit tests: all spread types, delta formats, DTE values, frequencies
