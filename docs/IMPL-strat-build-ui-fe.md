**Topic:** Strategy Builder UI  
**Issue:** #137  
**Domain:** STRAT-BUILD-UI  
**Type:** IMPL  
**Area:** FE  
**Status:** Draft  
**Created:** 2026-08-16  
**Last Updated:** 2026-08-16  

## Overview

Build the Strategy Builder UI — a full CRUD interface for options strategy instances. List view, create/edit stepper form, lifecycle toggle, and navigation link to the Options Strategy Dashboard.

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

### 4. Strategy Builder Component — Create/Edit Stepper

`src/app/features/rh-agent/pages/strategy-builder/strategy-builder-form.component.ts`

Standalone OnPush component using Angular Material Stepper.

**Step 1 — Strategy Type & Symbol**
- Spread type dropdown (from `PositionSpreadType` enum)
- Symbol input
- Frequency dropdown (DAILY, WEEKLY)
- Open time input (PT, HH:MM format)
- Live instance ID preview at bottom

**Step 2 — Phase Configuration**
- For each phase:
  - Target delta (0.01 - 1.0, numeric input)
  - DTE min (integer)
  - DTE max (integer, must be > DTE min)
- "Add Phase" button (only for multi-phase strategies like wheel)
- Phase 1 required; phase 2 optional

**Step 3 — Exit Policies**
- Multi-select (chips or checkboxes) of `ExitPolicy` values
- Conditional parameter fields per selected policy:
  - CLOSE_AT_TARGET_GAIN → target gain % input
  - CLOSE_AT_DTE_THRESHOLD → DTE threshold input
  - STOP_LOSS → stop loss % input
  - TRAILING_STOP → trailing stop % input (defaults to stop loss value)
  - ROLL → roll DTE threshold + roll target delta inputs
  - EXIT_AND_REPLACE → no params
  - HOLD_TO_EXPIRATION, WHEEL_IF_ASSIGNED, HOLD_SHARES_IF_ASSIGNED → no params
- Note: "Policies evaluated in order. First match wins."

**Step 4 — Market Regime (optional)**
- Dropdown: No filter / Bull / Bear / Neutral
- Note: "v1: config stored only, not enforced by BE"
- Skip button

**Step 5 — Review & Save**
- Summary card with all configured values
- Final instance ID
- Lifecycle state default: ACTIVE
- Save button → writes to Firestore, navigates to list
- Back button to edit any step

### 5. Route registration

- Add `STRATEGY_BUILDER` to `AppRoutes` enum in `interfaces.ts`
- Register lazy-loaded route with `authGuard` in `core-routes.ts`
- Add navigation link from Options Strategy Dashboard to Strategy Builder

### 6. Navigation link from dashboard

Add a "Manage Strategies" button to the Options Strategy Dashboard header that navigates to `/strategy-builder`.

## Cross-area boundaries

- Depends on **SHARED** unified type, `ExitPolicy`, `LifecycleState`, ID generator
- Depends on **BE** Firestore rules allowing FE writes to `options-strategy-instances`
- The "View in Dashboard" link navigates to `/options-strategy-dashboard` with a query param for instance filtering

## Technical risks

- **Stepper complexity:** Most complex form in the app. Conditional field visibility per exit policy, dynamic phase adding. Need reactive forms with `FormArray` for phases and exit policies.
- **ID generation timing:** The ID preview in step 1 needs to update live as the user types. The ID is finalized on save (date is creation date, not form-open date).
- **Delete safety:** Hard delete should be blocked if open positions reference the instance. v1: soft delete only (set STOPPED + deletedAt).

## Testing

- Service unit tests: CRUD operations, error handling, userId scoping
- Store unit tests: load/create/update/delete/toggle state transitions, error paths
- Component tests: list rendering, stepper navigation, conditional field visibility, form validation, ID preview
- ID generator unit tests: all spread types, delta formats, DTE values, frequencies
