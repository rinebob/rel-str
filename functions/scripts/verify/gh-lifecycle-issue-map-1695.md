# gh-lifecycle-issue-map-1695 — issue-number → Topic-root map (#1695)

Verifies the #1694 deep-search plumbing: the maintained `issueNumber → rootTopicNumber` map, the index emit, tree-fetch maintenance, and the `resolveLifecycleIssue` fallback.

```bash
cd functions && npx tsx scripts/verify/gh-lifecycle-issue-map-1695.ts          # DRY — handler-level, no env
cd functions && npx tsx scripts/verify/gh-lifecycle-issue-map-1695.ts --live   # + real GitHub chain walk + real map doc
```

**Flags/args:**

- `--live` — runs the DRY checks plus: `fetchIssueAncestorChain` against
  real GitHub for `#1696` (asserts the chain ends at Topic `#619`), and a
  real read of `gh-lifecycle-issue-map/rinebob-rel-str` asserting
  `entries["1696"] === 619`.
- Env for `--live`: `GITHUB_READ_TOKEN` (or `$(gh auth token)`) + ADC with
  Firestore access.

**What it verifies (DRY, 11 checks):**

1. `buildTreeIssueMap` inverts `childrenOf` — every node maps to its root,
   roots self-map; doc id is `{owner}-{repo}`.
2. `getLifecycleTopicIndex` emits `issueMap`; a map-read failure omits the
   field while topics still return (best-effort emit).
3. `getLifecycleTopicTree` calls `syncIssueMapFromTree` post-fetch; a sync
   failure never fails the tree response.
4. `resolveLifecycleIssue` returns `path` root→issue inclusive and upserts
   every chain number → root; no-parent and non-Topic-top chains return
   no `path`; unknown issue → `not-found`.

**What `--live` adds (4 checks):** real `parent`-chain walk resolves
`#1696` to Topic `#619`; the seeded map doc is populated and knows
`#1696 → #619`. If the doc is unseeded it WARNs (not FAILs) and prints
the seed command — seeding is an ops step, not a script defect.

**Seeding:** `cd functions && GITHUB_READ_TOKEN=$(gh auth token) npx tsx scripts/seed-gh-lifecycle-issue-map.ts --apply`
(dry census without `--apply`). After seeding, every
`getLifecycleTopicTree` call keeps the map fresh — no re-seed needed.

**Passing:** `=== 11 passed, 0 failed ===` (DRY), `=== 15 passed, 0 failed ===` (`--live`).
