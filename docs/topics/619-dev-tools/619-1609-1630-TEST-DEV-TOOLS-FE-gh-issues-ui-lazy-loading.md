**Topic:** GitHub read-only issue UI  
**Topic Slug:** `gh-issues-ui`  
**Thread:** Lifecycle tree fetch performance & caching  
**Thread Slug:** `lazy-loading`  
**Issue:** #1630  
**Thread Parent:** #1609  
**Topic Parent:** #619  
**Domain:** DEV-TOOLS  
**Type:** TEST  
**Status:** Draft  
**Created:** 2026-11-19  
**Last Updated:** 2026-11-19  

# FE TEST — Topic Viewer lazy loading: index + memo + on-demand subtrees

## Scope

The store's lazy-loading machinery and the page's new states:

- Index load renders the left pane alone (no subtree fetch on load).
- `ensureTopic` — memo hit (zero network), in-flight dedupe, fresh fetch.
- All-topics fetch queue — bounded concurrency, per-section errors,
  rate-limit drain.
- Refresh — index + rendered-set refetch only.
- Page states — right-pane skeleton, error + retry, progressive
  all-topics sections.

## E2E User Journeys

Covered by UAT (manual): open page → left pane fast → click topic →
skeleton → tree → revisit instant → all-topics progressive → refresh.

## Integration Tests

### Store (service stubbed — existing seam)

- `load` patches `topicIndex`/grouping from the index callable; zero
  subtree calls on load.
- `ensureTopic` — memo hit issues no call; two concurrent triggers
  share one promise; error marks `treeError[n]` not the store.
- All-topics: enabling queues only unfetched filtered topics at bounded
  concurrency; sections render as they land; re-enable reuses memo.
- Rate-limit-class error drains the queue; non-rate-limit error marks
  only its section.
- `refresh` — index refetched, memo dropped, only the rendered set
  refetched (selected normally; filtered set in all-topics).
- `showClosed` — index-level filtering only; no subtree calls from the
  toggle alone.
- Existing derivations (`visibleTopics`, `matchInfo`, `treeRows`,
  `allSectionsRows`, expansion) keep passing — data-source change only.

### Page (store stubbed or real-store/stubbed-service)

- Right pane: unselected → prior copy; selected-but-loading → skeleton;
  loaded → tree; errored → message + retry.
- All-topics: unfetched sections render section skeletons; sections
  populate independently; errored section shows its own retry.
- Refresh button still disables while loading.

## Unit Tests

- Service wrappers: `getLifecycleTopicIndex$`/`getLifecycleTopicTree$`
  pass `topicNumber` through and map responses.
- Dedupe map: concurrent `ensureTopic` calls coalesce; memo cleared on
  refresh.

## Test Seams

- `topic-viewer.service.ts` stubbed in store specs (existing pattern).
- Store stubbed in page specs (existing pattern); real-store +
  stubbed-service for the dedupe/queue specs where useful.

## Test data / fixtures

- Existing lifecycle fixture builders (topics, nodes, groupOrder) —
  index fixtures = roots with `children: []`; tree fixtures = one
  populated root.

## Existing Test Coverage

- `topic-viewer.store.spec.ts`, `topic-viewer-page.component.spec.ts`,
  `topic-viewer.service.spec.ts` — all extended, not replaced.

## Edge Cases

- Click a topic whose fetch is already in flight (queue or prior
  click) → join, no double call.
- Selected topic fetch fails → error state + retry; siblings fine.
- All-topics + showClosed → closed topics fetched only when rendered.
- Refresh mid-flight — memo cleared without racing in-flight promises.
- Match count with partially-loaded all-topics set — badge counts only
  fetched trees (PRD caveat, spec-pinned).

## Verify relay

- `npx jest src/app/features/topic-viewer/`
- `npx jest --coverage=false`
- `npx tsc -p tsconfig.app.json --noEmit`
