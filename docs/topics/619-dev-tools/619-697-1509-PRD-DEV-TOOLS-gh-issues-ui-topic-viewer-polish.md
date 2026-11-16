**Topic:** GitHub read-only issue UI  
**Topic Slug:** `gh-issues-ui`  
**Thread:** Topic Viewer UI polish & misc fixes  
**Thread Slug:** `topic-viewer-polish`  
**Issue:** #1509  
**Thread Parent:** #697  
**Topic Parent:** #619  
**Domain:** DEV-TOOLS  
**Type:** PRD  
**Status:** Approved  
**Created:** 2026-11-14  
**Last Updated:** 2026-11-14  

# PRD — Topic Viewer: data correctness, findability & tags

## Background

The Topic Viewer (`/tools/topic-viewer`) shipped a working skeleton in
Thread #621 — a master-detail page that walks the proj-workflow issue
hierarchy (Topic → Thread → stage issue → task) via **native GitHub
sub-issue edges**, groups topics by `docs/dev-notes/TOPICS-INVENTORY.md`,
and renders stage chips, Status badges, and label chips read-only. A first
visual-polish pass (#715) fixed row layout, depth guides, stage-colored
chips, and banner styling.

Daily use has since surfaced three classes of problems:

- **The data is incomplete.** The fetcher only follows native sub-issue
  edges, but most of the repo's ~40 Topic anchors are *legacy* — they
  declare their hierarchy in body markdown (`## Stage Issues`,
  `## Blueprint Issues`). Example: Topic #137's body lists ~14 children;
  the viewer shows exactly one (#154 — its single native sub-issue). The
  repo is half-migrated: newer topics are natively linked, older ones are
  not. Separately, the root search `is:issue Topic: in:title`
  substring-matches, so non-Topic issues named "Thread: Topic Viewer…",
  "INVENTORY: Topic Viewer…", "Idea: Topic Viewer…" surface as fake
  roots — and because the tree builder dedupes first-expanded-wins, a fake
  root can *steal* a real node out of a real Topic's subtree.
- **The page doesn't scale with use.** No way to find a topic by name,
  number, or label; no way to see more than one topic's tree at once; no
  way to sort the topic list; and the left pane shows a stage-colored dot
  whose meaning is opaque.
- **Tagging is missing entirely.** The naming hierarchy (Topic/Thread/
  stage/task) is rigid — there is no lightweight way to mark an issue
  with an arbitrary tag and later find issues by it. GitHub labels
  already are that mechanism; the viewer just can't write them.

This thread's original framing was "visual polish only"; this phase
deliberately widens it to data correctness, findability, and the thread's
first write path.

## Terminology

- **Native sub-issue edge** — GitHub's real parent→child relationship
  (`subIssues` connection); the only structure the fetcher walks. One
  issue can have at most one parent.
- **Body-declared hierarchy** — the legacy convention of listing children
  as markdown `#refs` under `## Stage Issues` / `## Blueprint Issues` /
  `## Threads` in an issue body. Visible on github.com, invisible to the
  tree.
- **Root** — an issue in the left-pane topic list. Must be an anchor whose
  title *starts with* `Topic:`/`TOPIC:`.
- **Group / `groupOrder`** — a topic's assignment to a TOPICS-INVENTORY
  super-group section, and the doc's section ordering. Group membership is
  data carried on each node; grouping and sorting are view concerns.
- **Tag** — a plain GitHub label. No naming convention, no `tag-` prefix;
  the user curates the label set.
- **System label** — a label carrying workflow semantics: stage labels
  (`1_IDEA`–`8_LIVE`), DOMAIN labels, Category labels, structural labels
  (IMPL/QA/BE/FE/SHARED). Displayed on rows but never offered by the
  add-tag picker — applying one as a "tag" would corrupt derived state.
- **All-topics mode** — a right-pane mode rendering every topic's tree,
  not just the selected one.

## Goals

1. Make the tree complete and truthful — every body-declared child
   appears exactly once, in the right place, and non-Topic titles can
   never occupy the root list.
2. Make issues findable — search by title, issue number, or label; sort
   the topic list by issue number; see the whole project at once.
3. Tag issues with arbitrary GitHub labels without leaving the page —
   including managing the repo's label set itself.
4. Keep the write path narrow — labels only. No issue edits, no stage
   advancement, no hierarchy mutations from the UI.

## Non-goals

- ARIA treegrid semantics / keyboard navigation (parked —
  disproportionate for a read-mostly dev tool).
- App-wide design-token/theming pass (owned by Workflows topic
  #625 / nav-reorg #661 — already in the inventory parking lot).
- Rewriting Topic bodies to match native edges — native links become
  canonical; body-index drift stays a `/proj` refresh concern.
- `TOPICS-INVENTORY.md` regeneration (separate `/proj list --doc` flow).
- Response pagination/caching — only if the post-retrofit payload
  actually trips the callable timeout.
- Write operations beyond labels — no issue field edits, no stage
  advancement, no reparenting from the UI.
- Repos beyond the two supported (`rel-str`, `av-proxy-api`).
- Per-node doc viewing (PRD/IMPL surfacing) — a deliberate follow-on
  Thread per the lifecycle-viewer PRD.

## User stories

### US-1 — See the full declared hierarchy

As a developer, I want a one-time retrofit that turns every legacy
body-declared parent→child relationship into a real native sub-issue
edge, so that the viewer's tree matches what each Topic's body already
declares — starting with #137.

*Acceptance criteria:*
- A repo-local ops script (run via `gh`, under `scripts/`) parses each
  Topic anchor's structural body sections — `## Stage Issues`,
  `## Blueprint Issues`, `## Threads`, and their indented task bullets —
  into an intended edge set, diffs it against actual `sub_issues`, and
  calls `addSubIssue` for the missing links.
- Default mode is **dry-run**: it prints every proposed edge with its
  intended parent and writes nothing. `--apply` performs the writes.
- An issue that already has a *different* native parent is skipped and
  reported in a conflict list — never silently reparented.
- Closed parents are transiently reopened to accept links, then
  re-closed (GitHub requires an open parent).
- Both supported repos are processed (`rinebob/rel-str`,
  `rinebob/av-proxy-api`).
- The script is idempotent — a second run reports zero diffs.
- The script adds edges only; it does not rewrite issue bodies.

### US-2 — Trust the root list

As a developer, I want only real `Topic:`/`TOPIC:` anchors to appear as
tree roots, so that non-Topic issues can't pollute the topic list or
steal nodes from real subtrees.

*Acceptance criteria:*
- #697 ("Thread: Topic Viewer…"), #713 ("INVENTORY: Topic Viewer…"),
  and #1509 ("Idea: Topic Viewer…") never appear in the left pane.
- Those same issues always render inside #619's/#697's trees regardless
  of search-result order — the fake-root/dedup interaction is gone.

### US-3 — Sort the topic list

As a developer, I want to sort the left pane by issue number, and I want
the grouped ordering preserved as the default.

*Acceptance criteria:*
- The response carries a **flat `topics[]` list** — each node with a
  `group` property (inventory section name or the Ungrouped sentinel) —
  plus `groupOrder: string[]`. The grouped default view renders
  identically to today's grouped sections (group order, then
  updatedAt-desc within group).
- A sort toggle offers **Grouped** (default) and **Issue #** (flat
  ascending; group headers not shown in this mode).

### US-4 — Find issues fast

As a developer, I want one search box that finds topics and issues by
title fragment, issue number, or tag — and shows me where matches live
in a tree.

*Acceptance criteria:*
- Typing a title fragment filters the left-pane topic list
  (case-insensitive substring).
- Typing `154` or `#154` matches issue 154.
- Typing a label name (e.g., `BACKTEST`) matches issues carrying that
  label.
- With a topic selected, a query auto-expands ancestors of matching
  nodes, highlights hit rows, and shows a match count; clearing the
  query restores prior expansion state.
- Search is client-side on the already-fetched response — no backend
  round-trip per keystroke.

### US-5 — See the whole project at once

As a developer, I want a mode that renders every topic's tree in the
right pane, so that expand-all + show-closed gives me the entire
project issue graph on one page.

*Acceptance criteria:*
- A header toggle switches the right pane between "selected topic" and
  "all topics"; section headers are preserved in the all-topics render.
- Expand-all, collapse-all, and Show-closed apply globally in
  all-topics mode — expand-all + show-closed displays every open and
  closed issue in the tree set.
- Selection, refresh, and error banners keep working in both modes.

### US-6 — Tag an issue

As a developer, I want to attach and detach arbitrary GitHub labels on
any tree node — including creating a new label inline — without leaving
the page.

*Acceptance criteria:*
- A tree row exposes a tag affordance; I can attach an existing label
  and see the chip appear, and detach one and see it removed.
- Typing a label name that doesn't exist creates the GitHub label and
  attaches it.
- The add-picker excludes system labels (stage, DOMAIN, Category,
  structural) while rows continue to display every label on the issue.
- Label changes reflect on the affected row immediately after a
  successful write — never stale chips.
- A failed write (expired token, insufficient scope) surfaces a banner
  naming the failure; the row's chips are unchanged.

### US-7 — Manage the label set

As a developer, I want a label manager dialog with CRUD over the repo's
labels, so that label hygiene lives next to where the labels are used.

*Acceptance criteria:*
- A header "Labels" button opens a dialog listing all repo labels.
- Create, rename, recolor, and delete round-trip through GitHub and
  reflect in the dialog.
- Deletes are confirmed — a label in use by issues is not silently
  removed from every issue.

### US-8 — Read every row at a glance

As a developer, I want the left-pane rows and tree rows to stay readable
under real data — real stage chips instead of cryptic dots, and titles
that ellipsis instead of pushing chips off-screen.

*Acceptance criteria:*
- Left-pane topic rows show the same stage chip the tree uses
  (color-coded, full label text) — the stage-dot is gone.
- A row with a long title + many chips ellipsizes the title; the chip
  cluster stays fully visible.

## The flat response contract

`LifecycleTreeResponse.sections` is replaced by:

```ts
{
  topics: LifecycleNode[];   // each node carries `group: string`
  groupOrder: string[];      // TOPICS-INVENTORY section order
  fetchedAt: string;
  groupingWarning?: string;
}
```

Group membership is data; grouping and sorting are view concerns owned
by the store's computeds. The flat shape is what makes sort-by-number
possible without re-flattening sections, and it simplifies search
predicates. Sort modes: `grouped` (default — `groupOrder`, then
updatedAt-desc within group) and `number` (ascending). Ungrouped topics
carry the existing `UNGROUPED_SECTION` sentinel as their `group`.

The change is breaking but internal — the callable's only consumer is
this page and they deploy together; no versioning needed.

## Retrofit semantics

- **Parse scope** — structural sections only (`## Stage Issues`,
  `## Blueprint Issues`, `## Threads` and their indented task bullets).
  Prose `#refs` elsewhere in a body are mentions, not children.
- **Parent resolution** — top-level bullets attach to the anchor;
  indented bullets attach to the bullet above them (a task under a
  blueprint bullet → child of that blueprint).
- **Never silently reparent** — a target already natively parented
  elsewhere is skipped + reported. Conflicts are a human decision.
- **Closed parents** — reopened transiently to accept a link, then
  re-closed (GitHub's `addSubIssue` requires an open parent).
- **Coverage** — both supported repos; every `Topic:`/`TOPIC:` anchor.
- **Verification** — dry-run on #137 must list exactly its declared edge
  set; post-`--apply`, a re-run reports zero diffs and the viewer shows
  the full #137 tree with Show-closed on.

## Technical context

- **Read-only → read-write.** The Topic's name says *read-only*; tags are
  the first mutation surface. Scope is labels only — the read callable is
  untouched.
- **Token story.** A second secret — a write-scoped fine-grained PAT over
  the supported repos (`GITHUB_WRITE_TOKEN`) — mirrors the
  `GITHUB_READ_TOKEN` mint pattern from #638.
- **Payload growth.** Post-retrofit, the walk covers most of each repo's
  issue graph (hundreds of nodes). The callable batches `nodes(ids)` at
  50 and pages subIssues to completion; the 120s timeout is the hard
  bound. Caching/pagination stays out of scope unless the timeout trips.
- **Group source.** `group`/`groupOrder` come from
  `docs/dev-notes/TOPICS-INVENTORY.md` (already fetched); absent/degraded
  doc → `groupingWarning` + Ungrouped, unchanged semantics.
- **av-proxy-api** has no GitHub Project (Status absent) — unaffected;
  it *does* need the retrofit (its Topics predate native sub-issues).
- **Post-write freshness** — the store patches the written node's labels
  in place on success (or marks the response stale for refetch);
  blueprint picks the mechanism.

## System context

```mermaid
flowchart LR
    subgraph App
      Page[Topic Viewer page]
      Store[TopicViewerStore<br/>group · sort · search · all-topics]
      Lbl[Label manager dialog<br/>+ per-row tag editor]
    end
    subgraph Functions
      Read[getLifecycleTree<br/>read-only]
      Write[label write callable(s)<br/>attach · detach · CRUD]
    end
    subgraph GitHub
      GQL[(GraphQL<br/>issues · subIssues)]
      REST[(REST<br/>label CRUD · add/remove)]
      SECR[(GITHUB_READ_TOKEN)]
      SECW[(GITHUB_WRITE_TOKEN)]
    end
    Ops[scripts/<br/>retrofit-subissues]
    Page --> Store --> Read
    Page --> Lbl --> Write
    Read --> SECR --> GQL
    Write --> SECW --> REST
    Ops -.->|gh api addSubIssue| GQL
```

## Open questions for blueprint

1. Callable topology for label writes — one `manageLabels` endpoint with
   an op discriminator, or separate callables for issue-label writes vs.
   label-CRUD.
2. System-label exclusion set — hardcoded list vs. derived (stage-label
   prefix + configured domain/category vocabularies); and whether the
   server also enforces it or the picker alone. Server-side enforcement
   on stage labels is cheap and protects workflow state.
3. Retrofit conflict handling — report-only vs. interactive prompt per
   conflict during `--apply`.
4. All-topics render cost — default expansion state in that mode, and
   whether whole-project scale needs row virtualization.
5. Freshness mechanism after a label write — patch the node in place vs.
   mark stale + refetch.
