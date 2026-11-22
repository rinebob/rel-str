**Topic:** DEV-TOOLS: GitHub issue UI  
**Topic Slug:** gh-issues-ui  
**Thread:** Lifecycle tree fetch performance & caching  
**Thread Slug:** lazy-loading  
**Issue:** #1634  
**Thread Parent:** #1609  
**Topic Parent:** #619  
**Task:** #1638  
**Domain:** DEV-TOOLS  
**Type:** CODE-REVIEW  
**Status:** Complete  
**Created:** 2026-11-22  
**Last Updated:** 2026-11-22  

## Scope

Task #1638 — FE-IMPL: service wrappers + page skeleton/retry/progressive
all-topics. Diff: 5 files under `src/app/features/topic-viewer/`
(store, page, and the three spec files). Phase 2 of the lazy-loading
IMPL — page-state layer over #1637's store machinery.

## Verdict

**PASS** — all three axes clean after one in-gate nit fix. No critical
or major findings.

## First pass

### Standards — PASS (1 nit fixed in-gate)

- **nit → fixed:** skeleton markup duplicated verbatim in the
  all-topics `@default` block and the selection-loading block (~12
  lines each, differing only in indent-row count). Extracted a shared
  `ng-template #skeleton` with `wide` / `extraIndent` / `testid`
  context params — the file's existing `topicRow`/`treeActions`
  outlet convention (topic-viewer-page.component.ts).
- nit (accepted): `.empty` reused for the per-topic error block carries
  `padding: 32px 8px` — chunky if many sections error at once, but
  consistent with the pane's other states.
- Standing note (not a finding): `topic-viewer.store.ts` ~870 lines —
  pre-existing size smell; the feature-store accumulates derivations
  and was flagged at the #1637 review.
- Contract check: the CallableName parity spec reads the real
  `functions/src/index.ts` and asserts all six service-dialed names
  are exported — the SDK surface is verified, not just mocked.

### Spec — PASS, all 6 ACs met

| AC | Evidence |
|---|---|
| CallableName parity vs `functions/src/index.ts` green | service spec `describe('CallableName parity…')` parses `export {}` blocks + declarations, asserts all 6 service callables |
| Right pane: unselected / skeleton / tree / error+retry | shimmer skeleton via `#skeleton` template (`wide` variant); page spec pins `tree-loading .skeleton` + `tree-empty` absent |
| All-topics: skeletons, independent sections, per-section retry | `allTopicsSections` emits a block per filtered topic — `loading`/`error`/`ready`; page spec pins `allsec-skeleton-7`, `allsec-error-7` + `allsec-retry-7` → `ensureTopic(7)` |
| Refresh disables while loading; new semantics | `[disabled]="store.loading() \|\| store.anyTreeLoading()"`; page spec pins the disable; `refresh()` semantics unchanged from #1637 |
| Match badge counts fetched trees only | derivation untouched; #1637 pin stands |
| jest + tsc green | 115/115 focused, tsc clean, full suite green (scanner suites' foreign breakage healed mid-review — 70/70) |

Deferred items from the TEST doc map: "sections populate
independently" — per-topic blocks land as each tree resolves;
"errored section shows its own retry" — per-topic error block with
its own Retry (per-topic granularity exceeds the section-level ask).

### Thermo-nuclear — APPROVE, no majors

- `status` precedence `tree > error > loading`: a landed tree wins
  over a stale error (stale-while-revalidate); `ensureTopic` clears
  `treeErrors[n]` on dispatch so the states can't coexist anyway. ✓
- Error-block Retry calls `ensureTopic`, which resolves `null` on
  failure — no unhandled template rejection. ✓
- `resumeAllTopics` no-ops when all-topics is off; re-arms via
  `enqueueFiltered` which self-clears the drain flag. Spec-pinned. ✓
- `@default` case degrades any unanticipated status to the skeleton —
  defensive. ✓
- `track b.topic.number` — unique across sections (a topic holds
  exactly one group). ✓
- Judgment call (noted, not a finding): Refresh disabled while
  `anyTreeLoading` — covers the queue drain (~seconds–tens of
  seconds). AC reads "disables while loading"; the widening prevents
  mid-drain refresh churn, but a user can't force a manual refresh
  while the queue drains. Defensible either way.
- a11y nit (accepted): each skeleton carries `role="progressbar"` +
  identical aria-label — some announcement noise when many topics are
  pending; each block does need one.

## Second pass

Re-checked the full diff surface: drain-notice placement (renders
even when the filtered set is empty — coherent with the empty
states), `@empty` gates unchanged, `readyBlock` fixture group
stamping, `fetchedTopics` still consumed by match/expand
derivations (not dead), `b.topic` carries the index root (number +
title for error context). No new findings.

## Pass log

- First pass complete — Standards 1 nit (fixed in-gate), Spec all
  ACs met, Thermo no majors.
- Second pass complete — no new findings; union covers the diff.
- Convergence: PASS — clean pass, no third pass needed.

## Test results

- `npx jest src/app/features/topic-viewer/` — **115/115** (+14 vs.
  #1637 suite; skeleton dedup re-verified green).
- `npx tsc -p tsconfig.app.json --noEmit` — clean.
- Full suite: 6,109 tests pass; the 3 scanner suites that compile-
  failed earlier belong to a foreign session's in-flight work and
  were healed during this review (70/70 re-run green).
