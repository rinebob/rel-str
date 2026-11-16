**Topic:** GitHub read-only issue UI  
**Topic Slug:** `gh-issues-ui`  
**Thread:** Topic Viewer UI polish & misc fixes  
**Thread Slug:** `topic-viewer-polish`  
**Issue:** #1513  
**Thread Parent:** #697  
**Topic Parent:** #619  
**Domain:** DEV-TOOLS  
**Type:** TEST  
**Status:** Draft  
**Created:** 2026-11-14  
**Last Updated:** 2026-11-14  

# Test Plan: contract v2 + retrofit script (SHARED)

## E2E User Journeys
- Retrofit dry-run on rel-str: prints proposed edges per anchor +
  conflict list, exits non-zero iff conflicts exist, writes nothing
  (verify no `addSubIssue` calls in a stubbed-transport run, and spot-
  check one anchor on GitHub afterward).
- Retrofit `--apply` on #137 only: the body's declared edge set lands as
  native sub-issues; re-run reports zero proposed edges (idempotent).

## Integration Tests
- Script + injected `gh` transport: fixture bodies → edge extraction →
  diff → dry-run report; `--apply` issues `addSubIssue` mutations only
  for proposed edges; closed parent triggers reopen → link → re-close
  sequence in order.

## Unit Tests
- `isTopicRoot`: "Topic: x"/"TOPIC: x" pass; "Thread: Topic Viewer…",
  "INVENTORY: Topic Viewer…", "Idea: Topic Viewer…", plain titles fail.
- `assignGroups`: roots get doc-order groups; unlisted →
  `UNGROUPED_SECTION`; `groupOrder` mirrors doc order (deduped; Ungrouped
  sentinel appended when ungrouped roots exist); absent doc → all
  Ungrouped + empty `groupOrder`.
- `isSystemLabel`: stage labels (`1_IDEA`…`8_LIVE`), structural, DOMAIN,
  Category names excluded; arbitrary names pass.
- Edge extraction: `## Stage Issues`/`## Blueprint Issues`/`## Threads`
  bullets → top-level edges; indented bullets → parent = enclosing
  bullet's issue; prose `#refs` outside those sections ignored; links
  (`[#N](url)`) and bare `#N` both parsed.
- Diff: no-parent → proposed; same-parent → already-correct; different
  parent → conflict.

## Test Seams
- Highest seam: the script's transport seam — real parse+diff+report
  pipeline against fixture `gh` responses (same `Gql`-injection pattern
  as `github-client.ts` specs).
- Lower seams: pure functions in `shared/` specs.

## Existing Test Coverage
- `shared/lifecycle-tree.spec.ts` covers `buildTree`/`orderTopics`/
  `parseInventoryGroups` — `orderTopics` cases migrate to `assignGroups`
  semantics (flat output, group stamping).

## Edge Cases
- Anchor body with no structural sections → zero edges, no crash.
- Structural section present but empty → zero edges.
- Issue number in a bullet that doesn't resolve → reported, skipped.
- Declared/structural cycles (A lists B, B lists A, or a live inverted
  ancestor) → the cycle-closing edge lands in  (never applied);
  a child re-declared by a later issue lands in  — both
  report-only.
- Closed parent → reopen/link/re-close logged; failure mid-sequence
  leaves parent re-closed (finally-style restore).
- Deleted issue referenced in a body → unresolvable, reported.
