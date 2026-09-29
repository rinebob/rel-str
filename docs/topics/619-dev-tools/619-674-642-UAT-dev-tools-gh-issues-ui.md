**Topic:** GitHub read-only issue UI  
**Topic Slug:** `gh-issues-ui`  
**Thread:** Lifecycle viewer  
**Thread Slug:** `lifecycle-viewer`  
**Issue:** #674  
**Task:** #642  
**Topic Parent:** #619  
**Domain:** DEV-TOOLS  
**Type:** UAT  
**Area:** FE  
**Status:** Complete  
**Created:** 2026-09-28  
**Last Updated:** 2026-09-28  

---

# UAT — #642 FE-IMPL: DevLifecycleService + LifecycleStore

## Scope

FE data layer for the lifecycle viewer: `dev-lifecycle.service.ts` (httpsCallable wrapper + `DEV_LIFECYCLE_REPOS`) and `lifecycle.store.ts` (SignalStore: `topicSections`, `selectedTopic`, `treeRows`, `expandableIds`, `groupingWarning`, `showClosed`, `loading`, `error`, `fetchedAt`; stale-response guard). No UI yet — page/tree are #643/#644.

## Prerequisites

- `npm install` done.

## Scenarios

### S1 — Specs

```powershell
npx jest src/app/features/dev-lifecycle --coverage=false
```

Expected: 10/10 — service callable name + `.data` unwrap; section assembly (grouped + ungrouped), closed filtering at both levels, emptied-section drop, expand/collapse semantics, stale-response discard, error-preserves-tree, refresh clears error + `fetchedAt`, vanished selection reset.

**Result:** PASS — 10/10.

### S2 — Typecheck

```powershell
npx tsc -p tsconfig.app.json --noEmit
```

Expected: clean — `@lifecycle/*` aliases resolve (jest moduleNameMapper + root tsconfig), SignalStore typing correct.

**Result:** PASS.

### S3 — Convention reads

- Callable name `getLifecycleTree` matches BE export (`functions/src/index.ts`).
- `DEV_LIFECYCLE_REPOS` mirrors `SUPPORTED_REPOS` (rel-str only; SA lands with #638).
- Store is read-only — zero write methods.

**Result:** PASS.

## Traceability

| Acceptance criterion | Scenario |
|---|---|
| `getLifecycleTree$` typed against shared contracts; CallableName registered | S1, S3 |
| `topicSections` doc-order groups; closed filtered unless `showClosed` | S1 |
| `selectRepo` stale-response guard; refresh updates `fetchedAt`/clears error; failed fetch preserves tree | S1 |
| Store + service specs per FE test plan §6 | S1 |

## Refinement pass

Not applicable — no rendered surface yet (page is #643).
