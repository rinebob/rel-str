**Topic:** Strategy Builder UI  
**Issue:** #137  
**Domain:** STRAT-BUILD-UI  
**Type:** TEST  
**Area:** FE  
**Status:** Draft  
**Created:** 2026-08-16  
**Last Updated:** 2026-08-16  

## E2E journeys

- Navigate to `/strategy-builder` → see list of instances (empty state if none)
- Click "Create New Strategy" → dialog opens → fill in fields → save → instance appears in list
- Click "Edit" on an instance → dialog pre-filled → modify → save → list updates
- Click lifecycle toggle → state cycles ACTIVE → PAUSED → STOPPED → ACTIVE → badge color changes
- Click "View in Dashboard" → navigates to `/options-strategy-dashboard` filtered by instance
- Click "Delete" → confirmation dialog → confirm → instance removed from list
- Click "Manage Strategies" from Options Strategy Dashboard → navigates to `/strategy-builder`

## Integration boundaries

- Service → Firestore (direct writes via Angular Firestore SDK)
- Store → Service (Observable subscriptions with DestroyRef cleanup)
- Component → Store (signals)
- Dialog form → reactive forms with FormArray for phases and exit policies

## Unit test targets

### Strategy Builder Service
- `loadInstances$()` returns sorted list (active first, then by created date)
- `createInstance()` writes to Firestore with correct shape and userId
- `updateInstance()` merges changes without overwriting untouched fields
- `deleteInstance()` removes doc from Firestore
- `setLifecycleState()` updates only the lifecycleState field
- Error handling: Firestore permission denied → throws meaningful error

### Strategy Builder Store
- `load()` populates instances signal from service
- `create()` calls service and refreshes list
- `update()` calls service and refreshes list
- `remove()` calls service and refreshes list
- `toggleLifecycle()` cycles state and calls service
- `activeInstances` computed returns only ACTIVE
- `pausedInstances` computed returns only PAUSED
- `stoppedInstances` computed returns only STOPPED
- Error state set on service failure

### List Component
- Renders table with correct columns
- Empty state when no instances
- Loading spinner while loading
- Error banner on error
- Lifecycle badge color matches state
- Action buttons present per row
- "Create New Strategy" button navigates to form

### Dialog Form Component
- Spread type dropdown populated from enum
- Instance ID preview updates live as user types
- Phase fields render (target delta, DTE min, DTE max)
- DTE max must be > DTE min (validation)
- Exit policy multi-select shows conditional fields
- Trailing stop defaults to stop loss value
- Save calls store.create() or store.update()
- Edit mode: all fields pre-filled from selectedInstance
- Form invalid → save button disabled

### ID Generator
- Covered in SHARED test plan

## Test seams

- Service: mock Firestore with spy functions
- Store: mock service, test state transitions
- Component: `ɵresolveComponentResources` for external templates (follow options-strategy-dashboard pattern)
- Dialog form: Material MatDialog test harness

## Edge cases

- Create with no exit policies selected → should be valid (HOLD_TO_EXPIRATION is default)
- Create with ROLL selected but no roll params → form invalid
- Edit while another edit is in progress → should not conflict (single-user)
- Delete instance with open positions → v1: soft delete only, warn user
- Symbol input with lowercase → normalize to uppercase
- Delta input with > 1 → validation error
- DTE min > DTE max → validation error
- Network error during save → error message, form data preserved
