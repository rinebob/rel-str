**Topic:** GitHub read-only issue UI  
**Topic Slug:** `gh-issues-ui`  
**Thread:** Topic Viewer UI polish & misc fixes  
**Thread Slug:** `topic-viewer-polish`  
**Issue:** #1513  
**Thread Parent:** #697  
**Topic Parent:** #619  
**Domain:** DEV-TOOLS  
**Type:** IMPL  
**Status:** Draft  
**Created:** 2026-11-14  
**Last Updated:** 2026-11-14  

# Implementation Plan — SHARED: contract v2, label contracts, retrofit script

## Scope

Three deliverables: (1) the flat response contract that unblocks
sort/search/all-topics, (2) the write-side label contracts shared by the
callables and the app, (3) the one-time `addSubIssue` retrofit script that
repairs legacy body-declared hierarchies. No functions or app code lives
here — the consumers land in the BE and FE blueprints.

## 1. Flat response contract (`shared/lifecycle-contracts.ts`)

```ts
export interface LifecycleTopic extends LifecycleNode {
  /** TOPICS-INVENTORY section name, or UNGROUPED_SECTION. */
  group: string;
}

export interface LifecycleTreeResponse {
  /** Flat root list — grouping/sorting is a view concern. */
  topics: LifecycleTopic[];
  /** TOPICS-INVENTORY section order; empty when the doc is absent. */
  groupOrder: string[];
  fetchedAt: string;
  /** Present only when the inventory doc degraded (non-404). */
  groupingWarning?: string;
}
```

`sections: LifecycleTopicSection[]` and `LifecycleTopicSection` are
removed — the only consumer is the topic-viewer page and it deploys with
the callable (internal API, no versioning). `LifecycleNode` is unchanged
(children never carry `group`).

## 2. `shared/lifecycle-tree.ts` — transform changes

- **`assignGroups(roots, groups)`** replaces `orderTopics`. Input: the
  built topic trees + parsed inventory groups. Output: each root stamped
  with its `group` (first inventory section containing its number, else
  `UNGROUPED_SECTION`) + `groupOrder` (deduped section names in doc order;
  `UNGROUPED_SECTION` appended when ungrouped roots exist). No
  sorting — order is decided by the consumer.
- **`isTopicRoot(title)`** — `^topic:` case-insensitive on the trimmed
  title. Shared so the BE root filter and the retrofit script apply the
  identical rule ("Thread: Topic Viewer…" fails, "TOPIC: X" passes).
- `parseInventoryGroups` unchanged — already returns `{name, topicNumbers}`
  in doc order.
- `decodeLabels`, `stageOrdinal`, `buildTree` unchanged.

## 3. Label contracts (`shared/lifecycle-labels.ts`, new)

```ts
export interface RepoLabel {
  name: string;
  color: string;        // 6-hex, no '#'
  description: string | null;  // GitHub returns null, never omits
}

export interface ListRepoLabelsRequest { owner: string; repo: string }
export interface ListRepoLabelsResponse { labels: RepoLabel[] }

export interface UpdateIssueLabelsRequest {
  owner: string; repo: string; issueNumber: number;
  add: string[];        // label names; missing labels are created
  remove: string[];
}

export type RepoLabelOp = 'create' | 'update' | 'delete';
export interface ManageRepoLabelRequest {
  owner: string; repo: string; op: RepoLabelOp;
  name: string;         // target label (and existing name for update)
  newName?: string; color?: string; description?: string;
}
```

**System-label guard** — `isSystemLabel(name)` + `SYSTEM_LABEL_PATTERNS`:
stage labels via `/^[1-8]_/` prefix plus an explicit constant list
(`INTERNAL`, `FEATURE`, `TECH DEBT`, `CORE`, `APP`, `PARTNER`, `MAINT`,
`IMPL`, `QA`, `BE`, `FE`, `SHARED`, `CONFIG`, `CHORE`, `DOCS`, `BUG`,
`TRIAGE`, plus the `domainLabels` vocabulary mirrored from
`project-config.json` — a shared constant, synced manually since the proj
config isn't an app-runtime dependency). The FE picker hides these; the
BE rejects **stage-label** writes outright. Rows still display all labels.

## 4. Retrofit script (`scripts/retrofit-gh-subissues.ts`, new)

One-time ops script run locally via `gh` (user's auth — no token mint).

```
npx tsx scripts/retrofit-gh-subissues.ts [--repo owner/name] [--apply]
```

- **Anchor enumeration** — `gh issue list --repo {r} --search "Topic:
  in:title" --json number,title,state`, filtered through `isTopicRoot`
  (shared predicate — kills the Thread/INVENTORY/Idea false positives).
- **Edge extraction (BFS over declared structure)** — for each anchor,
  fetch its body and parse only structural sections: `## Stage Issues`,
  `## Blueprint Issues`, `## Threads` (and their indented task bullets).
  Top-level bullets → child of the anchor; an indented bullet → child of
  the bullet above it. Each discovered stage/blueprint issue's body is
  parsed the same way (tasks listed inside blueprint bodies attach to
  that blueprint). Prose `#refs` outside structural sections are ignored.
- **Diff vs reality** — for each intended `(parent, child)` edge, read the
  child's current parent (GraphQL `parent { number }`). No parent → edge
  is proposed; same parent → already-correct (skipped, not counted);
  different parent → **conflict** (skipped, reported — never reparented).
- **Dry-run default** — prints proposed edges, already-correct edges, and
  the conflict list; writes nothing. `--apply` performs the `addSubIssue`
  mutations and prints the same report plus per-edge results.
- **Closed parents** — transiently reopened, linked, re-closed
  (`addSubIssue` requires an open parent). Logged loudly.
- **Coverage** — `--repo` defaults to both supported repos
  (`rinebob/rel-str`, `rinebob/av-proxy-api`); pass it to scope a run.
- **Idempotent** — a second run reports zero proposed edges.
- **Exit codes** — 0 clean; non-zero when conflicts exist (so a run
  finishes unattended but flags that a human has adjudication to do).
- The report is also written to a timestamped file under `.devin/tmp/`
  (never the OS temp dir).

## Test seams

- `assignGroups`, `isTopicRoot`, `isSystemLabel`, edge-extraction
  (markdown → edge set), and diff computation are pure functions over
  injected inputs — unit-test them in `shared/` specs and a script spec
  driving fixture bodies; no network needed.
- The script's `gh` calls go through a small injected transport (same
  pattern as `Gql` in `github-client.ts`) so specs simulate sub_issue
  reads and `addSubIssue` mutations without touching GitHub.
