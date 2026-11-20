**Topic:** GitHub read-only issue UI  
**Topic Slug:** `gh-issues-ui`  
**Thread:** Lifecycle tree fetch performance & caching  
**Thread Slug:** `lazy-loading`  
**Issue:** #1630  
**Thread Parent:** #1609  
**Topic Parent:** #619  
**Domain:** DEV-TOOLS  
**Type:** IMPL  
**Status:** Draft  
**Created:** 2026-11-19  
**Last Updated:** 2026-11-19  

# FE IMPL — Topic Viewer lazy loading: index load + on-demand subtrees + session memo

## Architecture overview

The store moves from "one monolithic `getLifecycleTree` response" to
"index + a memo map of per-topic trees":

```text
load(repo)
  → getLifecycleTopicIndex → patch topicIndex/topics + groupOrder
  → left pane live immediately (no subtree fetch on load)

selectTopic(n) / all-topics render needs tree n
  → trees.has(n)      → serve memo (zero network)
  → inFlight.has(n)   → join the in-flight promise (dedupe)
  → otherwise         → getLifecycleTopicTree(n) → trees.set → render

refresh()
  → re-fetch index; drop trees; refetch only the rendered set
    (selected topic normally, filtered set in all-topics mode)
```

## Boundary

- **`topic-viewer.service.ts`** — two new callable wrappers +
  `CallableName` entries (deploy-name parity).
- **`topic-viewer.store.ts`** — index state, `trees` memo, in-flight
  dedupe, per-topic loading/error state, all-topics fetch queue,
  refresh semantics.
- **`topic-viewer-page.component.ts`** — right-pane skeleton/error/
  retry states; progressive all-topics sections.
- **`topic-viewer-tree.component.ts`** — unchanged (renders `rows`).

## Files

- `src/app/features/topic-viewer/topic-viewer.service.ts` (modified)
- `src/app/features/topic-viewer/topic-viewer.store.ts` (modified)
- `src/app/features/topic-viewer/topic-viewer-page.component.ts` (modified)
- `src/app/features/topic-viewer/topic-viewer.service.spec.ts` (modified)
- `src/app/features/topic-viewer/topic-viewer.store.spec.ts` (modified)
- `src/app/features/topic-viewer/topic-viewer-page.component.spec.ts` (modified)
- Callable-name surface file (`CallableName` enum/map) (modified)

## Modules

- **`ensureTopic(n)`** — the memo + dedupe gate: returns the memo entry,
  joins the in-flight `Map<number, Promise>`, or fires the callable.
  Selection, all-topics render, and refresh all funnel through it.
- **All-topics fetch queue** — FIFO over filtered-but-unfetched topics,
  concurrency ~4. A rate-limit-class error drains the queue and flags
  the page; other errors mark only their own section.
- **Derived reads** — `visibleTopics`/`groupOrder` read the index
  response (unchanged derivations); `treeRows`, `allSectionsRows`,
  `matchInfo`, `effectiveExpandedIds` read `trees[n]` — `undefined`
  while loading.
- **Refresh** — index refetch + memo invalidation scoped to the
  rendered set (selected normally; filtered set in all-topics).

## Contracts

- Service wrappers: `getLifecycleTopicIndex$(req)` →
  `LifecycleTreeResponse`; `getLifecycleTopicTree$(req)` →
  `LifecycleTreeResponse` (one populated root).
- `CallableName` additions: `getLifecycleTopicIndex`,
  `getLifecycleTopicTree` — parity-checked against `functions/src/index.ts`.
- Per-topic UI state: `treeLoading(n) | treeError(n) | tree(n)`
  tri-state per topic number.

## Decisions

- **Memo is session-scoped signal state only** — no Firestore, no
  localStorage, no TTL (per PRD: on-demand, revisit-is-free within the
  session).
- **In-flight dedupe lives beside the store** (module or store-level
  `Map`), not in signal state — promises aren't render state.
- **Per-topic fetch failures isolate** — `treeError[n]` drives that
  pane/section's error + retry; siblings unaffected.
- **Search/match scope** — in-tree `matchInfo`/`matchCount` cover only
  fetched trees (PRD caveat); left-pane search runs on index data and
  is unaffected.
- **`showClosed` is a filter, not a trigger** — index carries `state`;
  closed subtrees fetch only when selected or rendered in all-topics.
- **As-of text** — reflects the index fetch; per-tree fetch time shown
  for the selected tree when present (copy at impl).

## Sequence / phases

- **Phase 1** — service wrappers + `CallableName` + store rework
  (index, memo, dedupe, queue, refresh) + store/service specs.
- **Phase 2** — page states (skeleton, error+retry, progressive
  all-topics) + page specs.

## Prior art / regression

- `topic-viewer.store.spec.ts` already stubs the service — the same
  seam hosts the new specs (the stub gains the two callable mocks).
- Existing derivations (`visibleTopics`, `matchInfo`,
  `allSectionsRows`, expansion) have spec coverage that must keep
  passing — the change is where data comes from, not what it means.

## Verify relay

- `npx jest src/app/features/topic-viewer/` — focused specs
- `npx jest --coverage=false` — full suite
- `npx tsc -p tsconfig.app.json --noEmit`

## Risks / open seams

- **Match-count caveat** — in all-topics mode with unfetched sections,
  the badge can't count hits in trees that haven't landed; acceptable
  per PRD (recorded explicitly).
- **Refresh during in-flight fetches** — a refresh must invalidate and
  re-rendered-set-refetch without racing in-flight promises; the
  dedupe map is cleared as part of memo drop.
- **Tree component untouched** — `rows` input contract is already the
  right seam for per-section data.
