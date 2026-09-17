**Topic:** Option chain percent change grid  
**Topic Slug:** option-chain-pct-change-grid  
**Thread:** Save param configuration  
**Thread Slug:** save-param-config  
**Issue:** #364  
**Thread Parent:** #361  
**Topic Parent:** #326  
**Domain:** OPTIONS  
**Type:** Implementation Plan  
**Area:** BE  
**Status:** Draft  
**Created:** 2026-09-17  
**Last Updated:** 2026-09-17  

---

# Implementation Plan — BE: Save param configuration

## Scope

Firestore security rules for the new `configs` root collection, allowing authenticated read/write to the `option-chain-pct-change` feature configs. No user-scoping (single user).

## Components

### 1. Firestore security rules

**File:** `firestore.rules`

Add a new rule block before the default deny:

```
// Saved user configurations — authenticated CRUD, no user-scoping (single user)
// Path: configs/option-chain-pct-change/configs/{configId}
match /configs/{featureDoc} {
  allow read: if false;  // intermediate doc — no direct reads
  allow write: if false; // intermediate doc — no direct writes
  match /configs/{configId} {
    allow read: if request.auth != null;
    allow write: if request.auth != null;
  }
}
```

This follows the same intermediate-doc pattern as `zig-zags/{symbol}/analyses/{paramsId}` — the intermediate doc (`configs/option-chain-pct-change`) is denied, the leaf docs are authenticated CRUD.

## Dependencies

- No BE code changes — rules only.
- No callable functions needed — FE writes directly to Firestore via AngularFire (same as swing-analysis pattern).

## Risks

- The `configs` root collection is shared across features. Future features will add their own subcollections under `configs/{feature-name}/configs/{configId}`. The rule must allow any feature doc under `configs/`, not just `option-chain-pct-change`.

## Test plan

See `326-361-364-TEST-OPTIONS-be-option-chain-pct-change-grid-save-param-config.md`.
