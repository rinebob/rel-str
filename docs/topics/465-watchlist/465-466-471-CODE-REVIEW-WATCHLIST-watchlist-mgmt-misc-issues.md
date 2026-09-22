**Topic:** Watchlist management  
**Topic Slug:** watchlist-mgmt  
**Thread:** Misc issues  
**Thread Slug:** misc-issues  
**Issue:** #471  
**Task:** #466 (Thread — no Blueprint task issue exists; work was implemented directly)  
**Thread Parent:** #466  
**Topic Parent:** #465  
**Domain:** WATCHLIST  
**Type:** CODE-REVIEW  
**Status:** Resolved  
**Created:** 2026-09-22  
**Last Updated:** 2026-09-22  

# Code Review: Symbol List filters + nav/saved-sets plumbing

## Summary

| Axis | Result |
|---|---|
| Standards | 1 major (monitor-chip wrong filter store), 5 minor, 6 nit |
| Spec | All PRD acceptance criteria met; 1 semantic note (browse-mode universe), 2 coverage nits |
| Thermo-nuclear | 4 majors (monitor semantics, duplicated tracked-symbols universe, three NO_MEMBERSHIP universes, non-atomic read-path migration), 2 minor, 2 nit |
| Tests | Full suite green — 112 suites / 1557 tests |

**Verdict: FAIL** — major findings exist. See below.

## Major findings

### M1 — Monitor chip toggles by filter, not membership (and reads the wrong filter)

`symbol-nav.component.ts:127`, `chart-review.component.ts:256`, `signal-review.facade.ts:458` — all three decide add-vs-remove via `activeListFilter() === MONITOR` instead of `isInList(MONITOR)`.

- On swing-analysis, `lists.activeListFilter()` is the *signal-review* store's filter — not `navFilter`, which is what the chip displays. Icon says "Stop monitoring" while the click adds.
- On chart-review, `symbolListStore.activeListFilter` isn't the page's filter at all (that's `triageStore.activeViewportList`) — you can't un-monitor while viewing the MONITOR list.
- A monitored symbol on a non-MONITOR filter hits `addToList`'s early-return — the chip is a dead click.

**Fix:** membership-driven toggle — `isInList(MONITOR) ? remove : add` at all three call sites; `activeListFilter` becomes display-only.

### M2 — Lazy migration is non-atomic and can brick list loading

`symbol-list.service.ts:85-107` — `getDoc` → `setDoc(MONITOR)` → `deleteDoc(PAST_SIGNALS)` as sequential awaits. `writeBatch` is already imported and used by `moveToList`. A write failure propagates into `loadAllLists`' error path → user gets *no lists at all* — a lazy migration turned a read into a mandatory write. Batch the set+delete; consider catching migration failure separately so lists still load.

### M3 — `trackedSymbols` universe duplicated across two stores

`symbol-list.store.ts:95-115` and `symbol-nav.feature.ts:112-134` are copy-pasted loaders (same callable, same normalize/dedupe/sort, same `length > 0` guard). `SwingAnalysisStore` already injects `SymbolListStore` for `navSequence` — the seam exists. Consolidate on `SymbolListStore` (extend `SymbolNavListsInput` with `trackedSymbols()`/`unlistedSymbols()`) or at minimum extract the normalize block into `utils.ts`.

### M4 — Three different universes for "No memberships"

- Nav: `trackedSymbols` complement (symbol-nav.feature.ts:67)
- Chart-review browse: `unlistedSymbols` (tracked-derived) — consistent
- Export: `signalService.getAllSymbols()` profiles (facade:200)

If `getAllSymbols()` ≠ `getTrackedSymbols$()`, the exported TXT and the browsed set are different lists under one label. (Arguably profiles is the right export base — but pin the semantic deliberately.)

## Minor findings

- `utils.ts:174` `shouldShowInListFilter(filter: string | 'ALL')` and `BuildFilteredCandidatesInput`/`BuildSymbolGroupsInput` should take `SymbolListFilter`; `TriageState.activeViewportList: string` likewise.
- Three "empty" sentinels now coexist: `'ALL'`, `SymbolListName.NONE` ("no filter"), `NO_MEMBERSHIP` ("zero lists") — `NONE` reads as "no membership"; future confusion guaranteed.
- Saved-sets follow-symbol machine: `selectedSymbol`/`browsedSymbol`/`lastPageSymbol` + `checked`/`unchecked` — six signals for one question; works but will spaghetti as the panel grows.
- Migration: redundant `getDoc` (MONITOR doc already in the `loadAllLists` result); spread order drops MONITOR's `createdAt`.
- `utils.ts:7` imports `SymbolRow`/`SymbolGroup` as a plain (non-`import type`) import — creates a latent cycle edge (`symbol-list.store → utils → group.store → symbol-list.store`); make it `import type`.
- Spec coverage gaps: no test for reopen-after-nav-away stale refetch; no test pinning MONITOR-counts-as-listed; spec uses literal `'NO_MEMBERSHIP'` instead of the constant.

## Nits

- Raw `'MONITOR'`/`'PAST_SIGNALS'` literals in service vs `SymbolListName.MONITOR` enum.
- Dead `ALL_SYMBOL_LIST_NAMES` import in symbol-list-actions.component.ts:11.
- `as` cast in `symbol-list.store.ts:149` (`n as string`).
- Dead `writeBatch` mock line in the new service spec.
- `listId(_userId, name)` ignores userId — doc IDs are global names; pre-existing, but the migration now writes the shared `MONITOR` id, making it load-bearing.
- `signal-review.facade.ts` ~531 lines — pre-existing god-facade, flag only.
- Export filename `ST-NO_MEMBERSHIP.txt` — cosmetic.
- Type-erased `as unknown as { toggleSymbolInList: jest.Mock }` stubs in page spec.

## Spec axis — acceptance criteria

All US-1/US-2 criteria met (shared ordered options on all three dropdowns; NO_MEMBERSHIP on nav/viewport/grouped view/export; MONITOR rename + merge/delete migration; nav jump "1 of N"; saved-sets follows symbol). One interpretation note: browse-mode NO_MEMBERSHIP returns the full unlisted tracked universe rather than `reviewSymbols ∩ unlisted` — consistent with named-list browse semantics; PRD text said "review symbols … in both modes" — met-as-intended.

## Test results

`npx jest --coverage=false` — 112 suites, 1557 tests, all green.

## Verdict (initial)

**FAIL** — fix M1–M4 (or explicitly accept M3/M4 as deferred), then re-run `/proj review`.

---

## Re-review — 2026-09-22 (post-fix)

All four majors fixed and verified against `npx jest` (113 suites / 1569 tests green) + `tsc -p tsconfig.app.json` clean:

- **M1 — fixed.** `SymbolListStore.toggleMonitor(symbol)` is membership-driven (`isInList ? remove : add`); nav, chart-review, and the facade all delegate to it. The chip's icon/tooltip now key off `isInList(MONITOR)` too, so display and action agree everywhere. The `activeListFilter` input existed only to feed that tooltip — the whole pass-through chain (actions ← row ← panel / detail ← pages/nav) was removed.
- **M2 — fixed.** Migration is a single `writeBatch` (set MONITOR + delete PAST_SIGNALS); a write failure logs and returns the unmigrated lists — read path no longer bricks. Redundant `getDoc` dropped; merged result preserves MONITOR's `createdAt`.
- **M3 — fixed.** `SymbolListStore` is the sole owner of `trackedSymbols`/`unlistedSymbols`; `symbolNavComputedBlock` reads them via the `lists` input (NO_MEMBERSHIP branch is now `lists.unlistedSymbols()` — single canonical implementation); `SwingAnalysisStore.trackedSymbols` state field removed and exposed as a passthrough; `loadTrackedSymbols` delegates. Shared `normalizeTrackedSymbols` lives in `utils.ts`.
- **M4 — fixed.** `exportSelectedList` awaits `loadTrackedSymbols()` and exports `unlistedSymbols()` — the same set nav and browse-mode show (profiles still supply exchange metadata for the TXT format).

Minors also addressed: `SymbolListFilter` at the utils/triage/viewport/review-header boundaries; `import type` on utils→group.store (kills the latent cycle edge); `SymbolListName.MONITOR` enum in the service; dead `ALL_SYMBOL_LIST_NAMES` import; `as` cast dropped in `moveToList` call; specs updated (batch mock + failure-path test, MONITOR-counts-as-listed, `NO_MEMBERSHIP` constant instead of literal, store mock matches the new contract).

**Deferred by design:** `SymbolListName.NONE` ("no filter") vs `NO_MEMBERSHIP` ("zero lists") naming collision — a rename is a cross-cutting semantic change better done under the full list-management thread; saved-sets follow-symbol state machine works and is flagged for the next touch; `listId(_userId)` global doc ids is pre-existing and flagged for the multi-user question.

**Verdict: PASS.**

---

## Second-pass review — 2026-09-22

All pass-1 majors confirmed **RESOLVED** by all three axes. Pass 2 surfaced one new major and several minors; all were fixed in this same diff:

- **New major — `toggleSymbolInList` stripped MONITOR on every re-file** (`symbol-list.store.ts`). The local optimistic update and the `moveToList` batch both iterated `ALL_SYMBOL_LIST_NAMES` including MONITOR, silently un-monitoring a symbol when filed into a triage list — contradicting MONITOR's "can coexist with any exclusive list" semantic. Fixed: MONITOR excluded from both the local strip and the batch target set; `toggleSymbolInList(MONITOR)` routes through `toggleMonitor` (footgun guard). Regression tests added in `symbol-nav.feature.spec.ts` (coexistence + routing). CONTEXT.md corrected.
- `loadTrackedSymbols` now dedupes in-flight loads via a shared promise (no double round-trip under concurrent callers).
- Dead service API removed (`loadList`, `setList`, `toggleInList` — ~90 lines, zero callers); `deleteDoc` import dropped.
- Page-spec mock now uses the real `isUnlisted` predicate (no contract drift); stray blank lines cleaned; `tierLabel` mojibake fixed; `type` import convention applied.

**Remaining advisory items (accepted, not blocking):**
- `loadTrackedSymbols` resolves `[]` on failure — consistent with `getTrackedSymbols$`'s own error→`[]` contract; export shows "empty" rather than an error on load failure. Acceptable today.
- Three `as SymbolListFilter` casts at select boundaries — `RhSelectMenuComponent` should eventually be generic (`RhSelectOption<T>`); deferred to the unified-infra thread.
- `this.` sibling calls in `withMethods` are correct but brittle if methods are ever extracted to a helper file — style note.
- Test coverage gaps (existing surfaces without specs): monitor-chip click on nav, viewport NO_MEMBERSHIP (signals+browse), export NO_MEMBERSHIP, grouped-view integration, non-nav dropdown option lists. Deferred — covered behaviorally where infrastructure exists.
- `SymbolListName.NONE` vs `NO_MEMBERSHIP` naming — deferred to list-registry thread.

**Verdict: PASS** — full suite green (113 suites / 1571 tests) after pass-2 fixes, all majors resolved, minors triaged.
