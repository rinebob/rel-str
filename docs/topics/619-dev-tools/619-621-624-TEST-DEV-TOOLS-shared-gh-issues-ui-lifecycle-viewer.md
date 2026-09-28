**Topic:** GitHub read-only issue UI  
**Topic Slug:** `gh-issues-ui`  
**Thread:** Lifecycle viewer  
**Thread Slug:** `lifecycle-viewer`  
**Issue:** #624  
**Thread Parent:** #621  
**Topic Parent:** #619  
**Domain:** DEV-TOOLS  
**Type:** TEST  
**Area:** SHARED  
**Status:** Complete  
**Created:** 2026-09-27  
**Last Updated:** 2026-09-27  

---

# Test Plan — SHARED: lifecycle tree contract + transforms

## Seam

`shared/lifecycle-tree.ts` — pure functions over fixture inputs. Highest seam possible: no I/O, no mocks needed.

## Unit test targets

**`decodeLabels`**
- Extracts a stage label from the closed set `1_IDEA`…`8_LIVE`; all others → `tags`
- No stage label → `stageLabel` absent
- Multiple stage labels → highest ordinal wins; the stale one is dropped from `tags`
- Case/vocabulary: `1_idea`, `9_DEPLOY`, `42_ANYTHING` are NOT stage labels

**`nodeTypeFor`**
- Depth 0 → `topic`
- `Thread:` prefix → `thread`; `{Stage}:` prefixes → `stage`; anything else → `task`
- `{AREA} Blueprint:` (e.g. `BE Blueprint:`) → `stage`

**`buildTree`**
- Composes children recursively from the `childrenOf` map; leaves get `children: []`
- `updatedAt` propagates: parent's updatedAt = max over subtree
- `status` maps from `statusOf` by issue number; absent for unconfigured repos
- Deep nesting (topic→thread→stage→task→subtask) composes correctly
- Orphan/missing child numbers in `childrenOf` don't crash (defensive skip)

**`parseInventoryGroups`**
- Parses `## Open Topics` → `###` headers → `#NNN` links into ordered groups
- `## Closed Topics` / `## Known drift` sections ignored; non-topic links skipped
- Missing section, empty doc, malformed markdown → `null`
- Topic numbers parse from the `[#NNN — ...](url)` link text form used by `list --doc`

**`orderTopics`**
- Doc order wins within groups; topics absent from groups → `ungrouped`
- Group entries referencing non-existent/closed topics are dropped
- `groups: null` input → everything ungrouped

## Edge cases

- Stage label on a closed issue still decodes (closed filtering is the UI's job)
- A task with no labels → empty tags, no stage chip
- Inventory doc listing a topic twice in two groups → first occurrence wins (document the choice)
- Empty `childrenOf` → topic with no children renders as a leaf, not an error

## Contract stability

`LifecycleNode`/`LifecycleTreeResponse` field-name assertions (sorted keys) — the compile-time contract FE and BE both build against; a dropped/renamed field fails loudly.
