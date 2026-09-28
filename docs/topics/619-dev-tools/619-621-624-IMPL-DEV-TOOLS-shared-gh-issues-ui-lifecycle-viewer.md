**Topic:** GitHub read-only issue UI  
**Topic Slug:** `gh-issues-ui`  
**Thread:** Lifecycle viewer  
**Thread Slug:** `lifecycle-viewer`  
**Issue:** #624  
**Thread Parent:** #621  
**Topic Parent:** #619  
**Domain:** DEV-TOOLS  
**Type:** IMPL  
**Area:** SHARED  
**Status:** Complete  
**Created:** 2026-09-27  
**Last Updated:** 2026-09-27  

---

# Implementation Plan — SHARED: lifecycle tree contract + transforms

## 1. Scope

Everything the BE callable and FE page share: the response contract types and the pure transforms that assemble raw GitHub payloads into grouped topic trees. No I/O — all pure functions over plain inputs, following the `portfolio-allocation-utils.ts` precedent.

## 2. Files

- `shared/lifecycle-contracts.ts` — request/response types and node shape.
- `shared/lifecycle-tree.ts` — the pure transforms (tree assembly, label decode, inventory-doc parse, grouping).
- `shared/lifecycle-contracts.spec.ts`, `shared/lifecycle-tree.spec.ts` — companion specs.

## 3. Contracts (`lifecycle-contracts.ts`)

```ts
export interface LifecycleRepoRequest {
  owner: string;
  repo: string;
}

export type LifecycleNodeType = 'topic' | 'thread' | 'stage' | 'task';

export interface LifecycleNode {
  number: number;
  title: string;
  state: 'open' | 'closed';
  url: string;
  nodeType: LifecycleNodeType;
  /** Stage label from the closed 1_IDEA…8_LIVE set — highest ordinal wins when two are present. */
  stageLabel?: string;
  /** Non-stage labels — Category/DOMAIN/agents etc., surfaced as tags. */
  labels: string[];
  /** Project Status field value for the repo's configured project; absent when the repo has no projectNumber. */
  status?: string;
  /** Most recent updatedAt across this node's subtree (computed). */
  updatedAt: string;
  children: LifecycleNode[];
}

export interface LifecycleTopicSection {
  /** Super-group heading text as written in TOPICS-INVENTORY.md, or 'Ungrouped'. */
  name: string;
  /** Topic-rooted trees, closed topics included (UI filters via the Show-closed toggle). */
  topics: LifecycleNode[];
}

export interface LifecycleTreeResponse {
  /** Ordered sections — the callable pre-assembles grouping; a repo with no
   *  inventory doc yields a single 'Ungrouped' section sorted by updatedAt desc. */
  sections: LifecycleTopicSection[];
  fetchedAt: string;
  /** The callable throws before returning a partial tree, so a successful
   *  response always carries 0. The verify script asserts this explicitly. */
  truncatedNodes: number;
  /** Set when the inventory doc could not be read (non-404) or parsed to no
   *  groups — sections are still returned; the UI shows "grouping unavailable"
   *  distinctly from "no doc". */
  groupingWarning?: string;
}
```

The parsed inventory shape (`LifecycleInventoryGroup { name, topicNumbers[] }`) is exported from `lifecycle-tree.ts` — it's an intermediate, not part of the response. Request validation lives on the callable; the shared side carries only the shapes.

## 4. Transforms (`lifecycle-tree.ts`)

Pure, independently unit-testable:

- `decodeLabels(labels)` → `{ stageLabel?, tags[] }` — stage labels are a closed set (`1_IDEA`…`8_LIVE`, kept as a local const since shared/ can't read project-config.json). If two stage labels are present (stale mid-transition labels exist in the repo), the highest ordinal wins and the stale one is dropped — it does not survive into `tags`.
- `nodeTypeFor(title, depth)` → `topic` at depth 0; `thread` when title starts `Thread:`; `stage` for `Idea:`/`Plan:`/`Blueprint:`/`Implement:`/`Review:`/`QA:`/`Ship:` prefixes (also matches `{AREA} Blueprint:`); else `task`. `nodeType` is a presentation hint derived from title conventions, not a semantic guarantee.
- `buildTree(roots, childrenOf, statusOf)` → `LifecycleNode[]` — inputs are plain maps keyed by issue number (the BE supplies them from its GraphQL pages; tests supply fixtures). Recursively composes children, propagates `max(updatedAt)` upward, and maps `statusOf` → `status`. Dedupe: a node reached under two parents expands once; a root also reachable as a child of an earlier root is not re-emitted; cycles terminate. `updatedAt` inputs must be ISO-8601 UTC (GitHub's format) — compared lexically. The transform never calls GitHub — the mock-blindness guard is that the fetch shell's query shape is verified by the prod verify script, not mocks.
- `parseInventoryGroups(markdown)` → `LifecycleInventoryGroup[] | null` — parses `## Open Topics` → `###` headers → `#NNN` links; `null` on missing section or empty input. Tolerant: `Closed Topics` / `Known drift` sections ignored, non-topic links skipped; a topic listed under two groups belongs to the first.
- `orderTopics(topics, groups)` → `LifecycleTopicSection[]` — doc-order wins; unconsumed topic numbers dropped; leftover topics land in a trailing `Ungrouped` section sorted by `updatedAt` desc. `groups: null` → one `Ungrouped` section covering everything. Group placement only applies to top-level emitted topics — a topic absorbed as a child of an earlier root (dedup) renders under its parent, not in its doc-listed group.

## 5. Boundaries

- FE imports `LifecycleNode`/`LifecycleTopicSection`/`LifecycleTreeResponse` for typing only — no transform imports (the callable pre-assembles sections).
- BE imports everything — `buildTree` + `parseInventoryGroups` + `orderTopics` run inside the callable.
- No dependency on `project-config.json` — nothing in this module knows field/option IDs.
