# #1636 — BE getLifecycleTopicTree callable

Per-topic subtree callable for Topic Viewer lazy loading
(`LifecycleTopicTreeRequest` `{ owner, repo, topicNumber}` → one
fully-populated `LifecycleTreeResponse`).

## dev-tools-gh-lifecycle-1636-topic-tree.ts

**Stage:** callable handler (probe + guard + shared BFS + assembly),
real GitHub.

**What it does:** runs `ghLifecycleDeps()` (real GitHub transport +
real inventory doc) through `handleGetLifecycleTopicTree` — everything
except the HTTP `onCall` wrapper — then exercises the guard paths.

**Usage:**

```bash
npx tsx scripts/verify/dev-tools-gh-lifecycle-1636-topic-tree.ts [topicNumber]
```

- `topicNumber` — optional; defaults to `619` (this Topic's anchor,
  guaranteed a `Topic:` root with children).
- Token: `GITHUB_READ_TOKEN` env var, else `gh auth token` fallback.
  Read-only — no GitHub or Firestore writes.

**PASS when:**

- exactly one topic comes back — the requested one, with a non-empty
  `children` array (subtree actually walked)
- root metadata intact (title/state/url/updatedAt/labels/nodeType)
- `group`, `groupOrder`, `fetchedAt` stamped like the monolith
- guard paths: non-`Topic:` issue → `invalid-argument`; unknown
  number → `not-found`; `topicNumber` 0 → `invalid-argument`;
  unsupported repo → `invalid-argument`; unauthenticated →
  `unauthenticated`

**FAIL means:** probe/guard mis-mapped (e.g. GitHub's `NOT_FOUND`
GraphQL error leaking as `internal`), single-root scoping violated
(more than one topic or an empty subtree on a topic that has
children), or metadata/grouping drift from the monolith pipeline.

**Observed 2026-11-20:** ~5s for #619 (61 descendants), all checks
green, `groupOrder` matches the inventory doc; stale-doc
`groupingWarning` present because #619 is not listed in
TOPICS-INVENTORY.md (expected behavior — sanitized degrade, not an
error).
