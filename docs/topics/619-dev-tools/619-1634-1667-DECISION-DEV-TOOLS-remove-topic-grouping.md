**Topic:** GitHub read-only issue UI  
**Topic Slug:** `gh-issues-ui`  
**Thread:** Lifecycle tree fetch performance & caching  
**Thread Slug:** `lazy-loading`  
**Issue:** #1667  
**Thread Parent:** #1609  
**Topic Parent:** #619  
**Task:** #1667  
**Domain:** DEV-TOOLS  
**Type:** DECISION  
**Status:** Approved  
**Created:** 2026-11-24  
**Last Updated:** 2026-11-24  

# DECISION: Delete hand-maintained topic grouping — the viewer renders issue order only

## Context

The Topic Viewer's all-topics "Grouped" mode rendered section headers from a `groupOrder` emit, which the `getLifecycleTopicIndex` callable produced by parsing `docs/dev-notes/TOPICS-INVENTORY.md` — a hand-curated markdown snapshot captured 2026-09-26 via `/proj list`. The mechanism was:

```text
TOPICS-INVENTORY.md  (hand-organized ### A..F super-groups, hardcoded #NNN links)
   └── getLifecycleTopicIndex  →  parseInventoryGroups → assignGroups
                                 → topic.group + response.groupOrder
        └── FE store foldGroups → Grouped sort view → section headers
```

Surfaced during `#1638` UAT (2026-11-22): the section names no longer reflected real topic organization. The data was stale on arrival — topics created or moved after 09-26 landed in Ungrouped or tripped the "inventory lists none of the fetched topics" warning — and the only maintenance path was hand-editing the markdown.

`/proj list --doc` can regenerate the file in place, but that never happened after 09-26 — a snapshot doc that lies between regenerations is a trap for the next reader, and the live roster question is already answered by `/proj list`.

## Decision (user directive, 2026-11-24)

- **No separate mechanism.** Delete the grouped view end-to-end — contract fields, BE parse/assign, FE store fold + sort pill + warn banner, and `TOPICS-INVENTORY.md` itself with the `/proj list --doc` feature. The September grouping was "a mistake that got propagated way too far" — static, hand-maintained, and wrong the day it was written.
- **Future grouping comes from issue metadata, not a doc.** When a real taxonomy exists, `grp:*` labels on Topic issues ride the payload `getLifecycleTopicIndex` already fetches — editable in the GitHub UI, zero new plumbing, self-maintaining. The super-group names below are archived here as seed material for that taxonomy; no label writes now (curating ~25 topics into drifting groups is the treadmill being removed).
- **Full excision, no dormant plumbing.** `group`, `groupOrder`, `groupingWarning`, `LifecycleInventoryGroup`, `UNGROUPED_SECTION`, `parseInventoryGroups`, `assignGroups`, and `foldGroups` are deleted — not stubbed emitting empty. The viewer is the only consumer.

## Seed taxonomy — the September super-groups (archived)

Derived 2026-09-26 from domain labels and work area. Preserved verbatim (with boundary notes) as candidate `grp:*` label vocabulary for a future metadata-driven grouping:

| Group | Topics |
|---|---|
| **A. Options & Spread Engine** (pricing backend) | #108, #139, #486 (+ closed #114) |
| **B. Options & Spread Analysis Surfaces** (UI) | #77, #106, #137, #326 |
| **C. Indicator Library & Swing Analysis** (ST suite) | #261, #594, #221 |
| **D. Trader Workflow Screens** | #213, #215, #465, #468 |
| **E. Execution & Portfolio** | #176, #219, #553, #576 |
| **F. Platform & Plumbing** | #159, #162, #178, #217, #300, #433, #828 |

Boundary notes carried over from the snapshot:

- #326 is labeled OPTIONS but is a chart/analysis surface on options data — could sit in A or B.
- #433 is labeled SIGNAL-REVIEW but is pipeline maintenance — belongs with #159/#162 conceptually.
- #219's Order Placement thread (#279) overlaps #176's broker work — the portfolio/trading boundary is already fuzzy.

## Excision map

| Layer | Delete |
|---|---|
| `shared/lifecycle-contracts.ts` | `LifecycleTopic.group`, `LifecycleTreeResponse.groupOrder`/`groupingWarning`, `LifecycleInventoryGroup` |
| `shared/lifecycle-tree.ts` | `UNGROUPED_SECTION`, `parseInventoryGroups`, `assignGroups` |
| `functions/src/gh-lifecycle/callables.ts` | `INVENTORY_PATH` contents-API fetch + parse/assign calls + both warnings |
| `topic-viewer.store.ts` | `foldGroups`, `sortMode`/`setSortMode` (collapses to issue-# only), `groupingWarning`, grouped `visibleTopics` branch |
| `topic-viewer-page.component.ts` | `Grouped`/`Issue #` sort pill, warn banner |
| Verify scripts + guides | group assertions in `dev-tools-gh-lifecycle-639-fetch.ts`, `dev-tools-lifecycle-contracts-637.ts` + `.md` guides + README rows |
| Skills | `--doc` flag + inventory feature in `.devin/skills/proj/proj-list.md` + `proj/README.md` |
| File | `docs/dev-notes/TOPICS-INVENTORY.md` |

## Folded-in decision: page scroll containment

The page-level vertical scrollbar reported in the same session is a separate latent bug, folded into `#1667` as one `:host` rule:

- **Root cause.** `app-topic-viewer-page` carried no `:host` rule — custom element hosts are `display: inline`, so `.page { height: 100% }` resolved to `.shell-content`'s full scrollport height while sitting 48px below `rs-header`. Perpetually 48px too tall → `.shell-content` (the app-level scroller) always showed a scrollbar and the toolbar scrolled away. `topic-viewer-page` was the only routed page in the app missing a host bound.
- **Fix.** The established workbench-page convention — `:host { display: block; height: calc(100vh - var(--header-height, 0px)) }` (the `vl.page-host` mixin semantic; `--header-height` is injected on `.shell-content`, `0px` in fullscreen). `.tree-head` already sits outside `.tree-scroll`, so it pins naturally once the panes bound.
- **Not done here — structural alternative.** Moving the app scroller below the header (`.shell-content` becomes `overflow:hidden` + `rs-header { flex:none }` + bounded `.shell-outlet` around the router-outlet) would hand every page a real bounded parent — plain `height: 100%` would just work and this bug class couldn't recur. It also pins `rs-header` app-wide, a chrome-behavior change on every page, so it was filed as its own task rather than smuggled in.
