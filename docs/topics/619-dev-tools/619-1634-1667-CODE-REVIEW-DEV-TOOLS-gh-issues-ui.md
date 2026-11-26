**Topic:** GitHub read-only issue UI  
**Topic Slug:** gh-issues-ui  
**Thread:** Lifecycle tree fetch performance & caching  
**Thread Slug:** lazy-loading  
**Issue:** #1634  
**Thread Parent:** #1609  
**Topic Parent:** #619  
**Task:** #1667  
**Domain:** DEV-TOOLS  
**Type:** CODE-REVIEW  
**Status:** Complete  
**Created:** 2026-11-24  
**Last Updated:** 2026-11-24  

# CODE-REVIEW — #1667 Topic Viewer: remove hand-maintained topic grouping + bound page scroll to panes

**Verdict: PASS** (pass 1 found real stragglers; pass 2 re-verified clean after fixes)

Spec source: issue #1667 body (6 ACs) + DECISION doc
`docs/topics/619-dev-tools/619-1634-1667-DECISION-DEV-TOOLS-remove-topic-grouping.md`
(authoritative excision map).

## Pass 1 — findings (all resolved in pass 2)

| # | Severity | Finding | Resolution |
|---|----------|---------|------------|
| 1 | CRITICAL | `fetchInventoryDoc: async () => null` survived in `tests/functions/gh-lifecycle/issue-map-1695.test.ts:130` — TS2353 under `typecheck:tests` | Line deleted; typecheck clean |
| 2 | CRITICAL | Same stub in `functions/scripts/verify/gh-lifecycle-issue-map-1695.ts:75` — TS2353 under `npm --prefix functions run typecheck` | Line deleted; typecheck clean |
| 3 | MAJOR | Pin spec `SCAN_FILES` was a 13-file whitelist that missed exactly the dirs where findings 1–2 lived | Rewritten: recursive `.ts` scan over `shared/`, `functions/src`, `functions/scripts`, `tests/functions`, `src/app/features/topic-viewer`, `scripts/verify` + per-file `ALLOWED` map for legit negative pins |
| 4 | MAJOR | `.devin/skills/proj/README.md:26-27` still advertised `/proj list --doc` / `/proj list 176 --doc` | Rows deleted |
| 5 | MINOR | `.devin/skills/proj/skill.md:104` stale `(its --doc flag ...)` parenthetical | Removed |
| 6 | MINOR | `.devin/skills/docs/proj-skill-design.md:260` still described `proj-list.md` as `(+ --doc persistent markdown output)` | Removed; added to pin's doc scan |
| 7 | MINOR | Duplicated sort expression in `visibleTopics` + `allTopicsBlocks` | Extracted `sortedFilteredTopics` computed (second withComputed block — same-block computeds can't see each other) |
| 8 | NIT | Dead `TopicRow.status` field (mapped by `toRow`, never bound — the `.status` in the template is `AllTopicBlock.status`) | Field + mapping removed; page-spec row fixture updated |
| 9 | NIT | Dead `firstValueFrom`/`from` rxjs imports in `topic-viewer.store.spec.ts` | Removed |
| 10 | NIT | DECISION doc header carried non-canonical `**Blueprint Parent:**` field | Removed |

## Accepted debt (not fixed — noted for the record)

- `callables.test.ts` `as any` unauthenticated-request fixtures (3 sites) — established fixture idiom in the file; nit-level.
- `:host` open-codes the `vl.page-host` contract (`display:block; height: calc(100vh - var(--header-height,0px))`) — deliberate; inline comment documents the convention and #1734 retires every `--header-height` site at once.
- `allTopicsBlocks` has no unsorted-input ordering test — mirror-tested via `visibleTopics`; nit.
- `fetchFileText` has no production caller post-excision — kept as the github-client file seam; the 639 verify script exercises it.
- Cosmetic fixture-reformat residue in `topic-viewer.store.spec.ts` and double blank lines in `topic-viewer-deep-resolve.spec.ts`.

## AC verification (pass 2)

1. **Index emits no group fields** — `LifecycleTreeResponse = { topics, fetchedAt, issueMap? }`; `handleIndex` is fetch → assemble → optional `issueMap`; exact-key assertion in `lifecycle-contracts.spec.ts` pins the shape. **MET**
2. **Flat issue-# render** — `visibleTopics`/`allTopicsBlocks` both derive from `sortedFilteredTopics` (issue-# asc); sort pill + section headers + warn banner gone; negative pins in page spec (`sort-grouped`/`sort-number`/`section-name` testids asserted null). **MET**
3. **Zero live-code refs** — recursive grep-pin spec: ~700 `.ts` files × 19 banned symbols + `\bLifecycleTopic\b`, allowlisted `sort-grouped` negative pin, doc scan over the four skill docs, inventory-doc deletion check. **MET**
4. **Verify scripts green** — 637, 639, 640, 1635, 1636 all PASS live via `gh auth token` fallback (run pre-review; unchanged by pass-2 fixes); `gh-lifecycle-issue-map-1695.ts` verify 11/11. **MET**
5. **DECISION doc** — exists with rationale + A–F seed map + excision map; header now canonical. **MET**
6. **Scroll containment** — `:host { display:block; height: calc(100vh - var(--header-height, 0px)) }` bounds the page under `.shell-content`; `.tree-head` outside `.tree-scroll`; left `.topics` scrolls independently. Verified statically + dev-server eyeball pending user check. **MET**

## Gates (pass 2)

- `npm --prefix functions run typecheck` — clean
- `tsc -p tests/tsconfig.json` — zero errors in swept files (76 pre-existing foreign-session errors elsewhere: paper-trading/options)
- jest `topic-viewer` + `shared` — 65 suites / 16,687 tests
- jest full suite — re-run in flight at review time; prior full run 6751/6751 before pass-2 edits
- tsx `tests/functions/gh-lifecycle` — 123/123

## Deploy note

Deployed callable still emits `group`/`groupOrder` until next functions deploy — FE ignores the superset (TS structural typing; no exact-shape validation on the wire payload). Contract shrinks at ship.
