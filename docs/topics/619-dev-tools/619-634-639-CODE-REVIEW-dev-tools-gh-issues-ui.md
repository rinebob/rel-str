**Topic:** GitHub read-only issue UI  
**Topic Slug:** `gh-issues-ui`  
**Thread:** Lifecycle viewer  
**Thread Slug:** `lifecycle-viewer`  
**Issue:** #634  
**Thread Parent:** #621  
**Topic Parent:** #619  
**Domain:** DEV-TOOLS  
**Type:** CODE-REVIEW  
**Task:** #639  
**Status:** Resolved  
**Created:** 2026-09-28  
**Last Updated:** 2026-09-28  

---

# Code Review — #639 BE-IMPL: Lifecycle GraphQL fetch shell

Three axes: standards (coding guidelines), spec (IMPL §4/§6 + TEST bullets), thermonuclear (production bug hunt).

## Findings and resolutions

| # | Finding (axis) | Resolution |
|---|---|---|
| 1 | `nodes(ids:)` null slots (deleted/transferred/inaccessible issues) → `records.get()!` leaked `undefined` into `childrenOf`/`roots`, opaque crash in `buildTree` (all three axes) | Filter to `records.has` at assembly; dropped refs counted in `truncatedNodes` — consistent with "never silently miss." Root-level nulls same treatment. New spec covers it. |
| 2 | Search loop had no truncation guard: `hasNextPage` + null `endCursor` exited silently; no `issueCount` cross-check (thermo #2) | `issueCount` added to query; un-advanceable pagination and short-collection both count as truncated. New spec. |
| 3 | `data.repository.issue === null` (issue deleted mid-walk) → raw TypeError (thermo #3) | Null-checked; treated as truncation. New spec. |
| 4 | Malformed 200 response (`data` absent, no `errors`) silently returned `{}` → opaque downstream crash (standards #2) | Throws `GitHubApiError` on empty `data`. |
| 5 | Rate-limit classification missed HTTP 429; `fetchFileText` hardcoded `rateLimited: false` (both axes) | 429 + header-based detection shared across GraphQL and REST paths. |
| 6 | Non-Issue `search` result slots assumed Issue-shaped (thermo #7) | `n?.id`/number filter on search nodes. |
| 7 | Verify script ran `gh auth token` twice (nit) | Hoisted to one `tok` const. |
| 8 | TEST doc edge case said "first-seen parent wins; count logged" — actual: dual-parent listing, render-dedup first-occurrence (spec #4) | TEST doc rewritten to match implementation; added null-slot, stuck-search, vanished-issue bullets. |
| 9 | IMPL didn't note `SUBISSUES_PAGE_CAP`, `id` in subIssues selection, `fetchFileText` landing, or test file location (spec #1/2/7) | IMPL §2/§4 amended. |

## Deliberately not fixed (documented trade-offs)

- `projectItems(first:10)`/`fieldValues(first:20)` single-page caps — soft-degrade to absent status rather than fail the tree over a metadata field; comment in `decodeStatus`.
- Project-scope-absent PAT kills the whole fetch — hard requirement per IMPL §3 (token needs Issues+Projects read); #640 maps the error.
- Serial `collectSubIssues` per node — correct and rate-friendly; bounded batching is a future tuning knob.
- `GitHubApiError` carrying `status: 200` for GraphQL-level errors — consumed by #640's mapper, which keys on `rateLimited`/status semantics.

## Re-review iterations

**Iteration 2** — the round-1 hardening hadn't been applied inside `collectSubIssues`:
- Null/malformed `subIssues.nodes` slots (deleted/moved children) → filtered on `id`/`number` in both first-page and paginated paths; short-collection vs `totalCount` counts them
- `hasNextPage` + null `endCursor` mid-connection → carried `hasNext` flag counts as truncation (mirrors the search-loop fix)
- Tightened the dedup test to exact call counts; added a null-subIssues-slot spec (15 total)
- `labels(first:50)` documented as soft-degrade

**Iteration 3** — CLEAN.

## Verdict

**PASS** (after convergence sweep, no remaining findings)

## Evidence

- `npm run test:gh-lifecycle` — 14/14 specs (search paging, BFS dedup, level batching, subIssues pagination, truncation paths ×3, status decode ×4)
- `npx tsx scripts/verify/dev-tools-gh-lifecycle-639-fetch.ts` — real GitHub BFS: 27 roots, 480 nodes, 465 statuses, `truncatedNodes 0`, all checks PASSED (re-run after fixes)
- `npm run build` clean; `tsc --noEmit` clean for gh-lifecycle (one pre-existing unrelated error in `rh-agent-mcp/broker/broker-order-adapter.ts`)
- Full jest suite: 2 pre-existing failures in `allocation-page.component.spec.ts` — unrelated in-flight portfolio work, not this change
