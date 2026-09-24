**Topic:** Watchlist management  
**Thread:** Unified list infrastructure  
**Task:** #526 — FE-IMPL: User-list CRUD API (create/rename/delete/reorder)  
**Status:** Complete  
**Reviewed:** 2026-09-23  
**Verdict:** PASS (fixes applied in-gate)

## Axes

### Spec — PASS (all 5 ACs)
1. `createList` — slug key + appended order: `service.ts` createList; spec'd.
2. `renameList` — label-only merge; nothing keyed on label: spec asserts payload absence.
3. `deleteList` — composite doc delete; catalog drops on emission: spec'd.
4. `setListOrder` — batched order writes: spec'd.
5. Service specs cover all ops + store delegation/failure paths.

### Standards — PASS after fixes
- File crossed 400 lines → extracted migration/resolution into `symbol-list-registry.ts` (service 353, registry 157).
- `enqueueWrite` generic verified: queue stays depth-1, failures don't poison the chain, result propagates.

### Thermo-nuclear — PASS after fixes
- Tombstone resurrection (merge-set on a deleted key recreating a ghost doc) — **real defect, fixed**: `setListOrder` uses `batch.update` (atomic failure on missing doc) and filters system keys.
- Cross-tab create TOCTOU — acknowledged low-risk for single-user; queue serializes intra-tab.

## Fixes applied during review

| Fix | Where |
|---|---|
| `setListOrder` → `batch.update` + system-key filter (ghost-doc + order-block clobber) | service |
| `deleteList` rejects system keys | service |
| `renameList` getDoc existence check (no stub materialization) | service |
| `createList` slug collision set is case-insensitive incl. system keys (`'Primary'` → `primary-2`) | service |
| Migration/resolution extracted to `symbol-list-registry.ts` | new module |
| Store `deleteList` resets `activeListFilter` → `'ALL'` when it matches | store |
| New specs: floor order, case-collision, system-key reject, unknown-key rename, update-batch | spec |

## Deferred (non-blocking)
- Cross-tab `createList` race (same-slug last-write-wins) — single-user app.
- Duplicate user-list labels allowed — management UI should warn.
- Queue serialization proof spec for overlapped `createList`s — queue contract already tested via moveToList serialization.

## Second pass (post-fix re-review)

All first-pass fixes verified. One new real defect found and fixed:

| Fix | Where |
|---|---|
| `renameList` → `updateDoc` (getDoc→setDoc-merge TOCTOU could resurrect a doc deleted mid-flight as a key-less stub → migration ghost) | service |
| `deleteList` filter reset now success-gated via `map(() => true)` sentinel — enqueueWrite resolves undefined on both paths for void writes | store |
| Orphaned docblock left by the extraction removed | service |
| `setListOrder` commit-reject propagation spec | spec |
| `deleteList`/`activeListFilter` reset + non-reset specs | store spec |
| Mojibake in spec comments | spec |

Accepted/deferred: atomic-fail reorder is the correct failure mode (cosmetic, retryable); `taken` set doesn't see unstamped legacy docs (merge-set reconciles anyway); `moveToList` can stamp role-less stubs for unknown keys (pre-existing, catalog-bounded — noted for hardening); cross-tab TOCTOU (single-user).

## Verification
- Focused: 40 tests (service + store specs) green.
- Feature suite: 69 suites / 1262 tests green.
- Full suite: 132 suites / 1812 tests green.
- `tsc --noEmit` clean on touched files.
