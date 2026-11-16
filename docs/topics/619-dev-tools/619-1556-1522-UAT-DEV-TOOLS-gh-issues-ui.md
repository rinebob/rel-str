**Topic:** GitHub read-only issue UI  
**Topic Slug:** gh-issues-ui  
**Thread:** Topic Viewer UI polish & misc fixes  
**Thread Slug:** topic-viewer-polish  
**Issue:** #1556  
**Thread Parent:** #697  
**Topic Parent:** #619  
**Task:** #1522  
**Domain:** DEV-TOOLS  
**Type:** UAT  
**Status:** Complete  
**Created:** 2026-11-15  
**Last Updated:** 2026-11-15  

# UAT — SHARED: Lifecycle contract v2 / flat response + group assignment (#1522)

## Scope

Verifies the Lifecycle contract v2 migration end-to-end: the callable
emits the flat v2 shape (`topics` + `groupOrder`, no `sections`), the
topic-viewer store re-groups identically to v1, and the degrade paths
(doc absent / doc stale) behave per contract.

## Prerequisites

- `gh` CLI authenticated for `rinebob` (live verifies hit prod GitHub).
- Node deps installed (`npx tsx` resolves — devDependency).
- Dev servers running: Angular on `:4210`, observation API on `:3456`
  (the callable the UI hits is the **local functions** build — see S4 note).
- No emulator, credentials, or seed data — every scenario hits prod GitHub.

## Getting to the feature

- **Route:** `/tools/topic-viewer` — Sidenav → **Topic Viewer** → select
  `rinebob/rel-str` in the repo dropdown → the left pane lists Topic
  roots grouped into inventory sections; selecting a Topic renders its
  tree in the right pane.
- **CLI surfaces:** three verify scripts under `scripts/verify/` —
  see scenarios.

## Test scenarios

### S1 — Offline contract checks (`637`)

1. `npx tsx scripts/verify/dev-tools-lifecycle-contracts-637.ts`
2. **Expect:** `ALL CHECKS PASSED`, exit 0. Confirms: shared shapes
   compile to the v2 contract, `assignGroups` stamps groups +
   deduped doc-order `groupOrder` (+ Ungrouped sentinel), `isTopicRoot`
   accepts `TOPIC:`/`Topic:` and rejects `Thread:`/`Idea:`/`INVENTORY:`.
3. **Result:** PASS — `ALL CHECKS PASSED` (2026-11-15, post-review-remediation).

### S2 — Live fetch + transforms (`639`)

1. `npx tsx scripts/verify/dev-tools-gh-lifecycle-639-fetch.ts`
2. **Expect:** `ALL CHECKS PASSED`, exit 0. Real fetch: ~55 roots,
   ~1300 nodes, `truncatedNodes === 0`, Topic #619 present with
   thread #621 beneath it, inventory doc fetched and parsed.
3. **Result:** PASS — `ALL CHECKS PASSED`; roots: 56, nodes with
   children: 1309, statuses: 1289; #619 has children incl. thread #621;
   every topic carries a group (2026-11-15, post-remediation).

### S3 — Live callable → v2 response (`640`)

1. `npx tsx scripts/verify/dev-tools-gh-lifecycle-640-callable.ts`
2. **Expect:** `ALL CHECKS PASSED`, exit 0. Response parses to
   `LifecycleTreeResponse` v2: `{topics, groupOrder, fetchedAt}`, fresh
   ISO `fetchedAt`, every topic carries `group`, `groupOrder` covers
   every stamped group (or is empty on the degrade path), #619 contains
   #621, recursive node shape intact; `groupingWarning` absent on the
   happy path. Fixture-validation legs (unsupported repo, missing auth)
   reject correctly.
3. **Result:** PASS — `ALL CHECKS PASSED` incl. both validation legs
   (2026-11-15, post-remediation).

### S4 — Topic Viewer renders groups identically to v1

1. Start the app (`npm start` → `:4210`), open `/tools/topic-viewer`.
2. **Expect:** left pane shows Topic roots grouped under the same named
   sections as before the migration (per `TOPICS-INVENTORY.md`), with an
   `Ungrouped` section last if any Topics are unlisted — the same layout
   v1 rendered. No console errors.
3. **Result:** PASS — user confirmed identical grouped render against
   the live v2 callable (deployed 2026-11-15).

### S5 — Intra-group ordering is issue-number ascending

1. In the left pane, pick a named section with ≥2 Topics.
2. **Expect:** Topics sorted by issue number ascending within every
   section — matching what v1's doc-order render effectively produced.
   (An `updatedAt`-desc default was planned but corrected at QA — the
   user wants number order.)
3. **Result:** PASS — user confirmed number-ascending order in the live
   page (2026-11-15).

### S6 — Empty section drop + show-closed

1. With "show closed" unchecked, confirm a section whose Topics are all
   closed disappears entirely (no empty header).
2. Toggle "show closed" → the section reappears with closed Topics
   marked.
3. **Result:** PASS — user confirmed drop + reappear (2026-11-15).

### S7 — Selection persistence across refresh

1. Select a Topic → its tree loads in the right pane.
2. Click the page's **Refresh** button → selection is retained while
   the Topic still exists. (A browser reload is NOT expected to
   preserve it — the store is memory-only, no URL/localStorage state.)
3. **Result:** PASS — user confirmed the in-page refresh preserved
   selection; browser-reload loss confirmed as expected (2026-11-15).

### S8 — Degrade path signals (static confirmation)

The degrade branches can't be triggered without breaking the inventory
doc, so these are confirmed by code + spec rather than live:

- Doc 404 → `groupingWarning` absent, `groupOrder: []`, store renders a
  single `Ungrouped` section (spec `topic-viewer.store.spec.ts` "empty
  groupOrder falls back").
- Doc fetch fails / parses null / lists no fetched topics →
  `groupingWarning` set; the page surfaces it via the warning banner
  (specs `callables.test.ts` + store spec).
- **Result:** confirmed by spec coverage — PASS.

## Traceability

| AC | Scenario |
|---|---|
| Flat `LifecycleTreeResponse` v2 emitted; `sections`/`LifecycleTopicSection`/`orderTopics` removed | S1, S3 |
| `assignGroups` replaces `orderTopics` — group stamping, doc-order `groupOrder`, Ungrouped sentinel | S1, S3, S4 |
| `isTopicRoot` shared and filters real Topic roots | S1, S2 |
| `truncatedNodes` stays internal | S3 (v2 shape assertions) |
| Consumers migrated; UI renders identically | S4–S7 |
| Degrade paths signaled per contract | S8 |

## Regression / smoke

- [x] Full jest suite green post-change — 313/313 suites, 5646 tests (2026-11-15)
- [x] Other lifecycle consumers unaffected — all three lifecycle verify
  scripts pass against live prod (S1–S3)

## Results log

- 2026-11-15 — UAT drafted; executing scenarios.
- 2026-11-15 — S1/S2/S3 PASS (all three verify scripts, live prod GitHub).
- 2026-11-15 — Functions deployed (`firebase deploy --only functions`,
  user-run); v2 callable live. S4–S7 verified in-browser by the user:
  identical grouped render, issue-number ascending within groups,
  emptied-section drop + show-closed restore, in-page refresh preserves
  selection. S8 degrade paths confirmed by spec coverage.
  **QA PASS.** One course-correction recorded: intra-group ordering is
  issue-number ascending (was planned `updatedAt` desc).
