**Topic:** GitHub read-only issue UI  
**Topic Slug:** `gh-issues-ui`  
**Thread:** Lifecycle viewer  
**Thread Slug:** `lifecycle-viewer`  
**Blueprint:** #635  
**Task:** #642  
**Domain:** DEV-TOOLS  
**Type:** Code Review  
**Status:** Complete  
**Created:** 2026-09-28  

# Code Review — FE `DevLifecycleService` + `LifecycleStore`

## Files changed

- `src/app/features/dev-lifecycle/dev-lifecycle.service.ts` — httpsCallable wrapper + `DEV_LIFECYCLE_REPOS`
- `src/app/features/dev-lifecycle/lifecycle.store.ts` — SignalStore view-model layer
- `src/app/features/dev-lifecycle/*.spec.ts` — 10 specs
- `src/app/core/common/constants.ts` — `CallableName.GET_LIFECYCLE_TREE`
- `jest.config.js`, `tsconfig.json` — `@lifecycle/*` aliases

## Review axes

**Combined standards+spec+deep:** APPROVE — `paper-trading.service.ts` pattern byte-for-byte; store derivation correct (stale-guard, closed filtering at both levels, error preserves tree); all spec assertions falsable.

## Iterations and fixes

**Round 1** — no blocking findings; applied:

- Selection-reset on refresh gated on `selectedTopicNumber() !== null` (was clearing `expandedIds` unconditionally — latent coupling)
- `groupingWarning` computed passthrough added (page surfaces it in #643)
- IMPL doc aligned: `expandedIds` is `number[]` (serializable state), `DEV_LIFECYCLE_REPOS` naming, SA-repo mirror must land with #638

**Iteration 2** — CLEAN.

## Deliberate decisions (kept)

- `expandedIds: number[]` not `Set` — SignalStore state is serializable; Set semantics applied at use sites
- `selectTopic` seeds the root into `expandedIds` — depth-1 rows visible by default; `collapseAll` → root row only
- `selectedTopic` searches closed topics too — a selected-then-closed topic keeps rendering its tree
- `selectRepo` out-of-range → silent no-op (dropdown only emits valid indexes)

## Evidence

| Check | Result |
|---|---|
| `jest src/app/features/dev-lifecycle` | 10/10 pass |
| `tsc -p tsconfig.app.json --noEmit` | clean |

## Verdict

**PASS**
