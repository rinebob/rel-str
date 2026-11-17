**Topic:** GitHub read-only issue UI  
**Topic Slug:** gh-issues-ui  
**Thread:** Topic Viewer UI polish & misc fixes  
**Thread Slug:** topic-viewer-polish  
**Issue:** #1520  
**Thread Parent:** #697  
**Topic Parent:** #619  
**Task:** #1527  
**Domain:** DEV-TOOLS  
**Type:** CODE-REVIEW  
**Status:** Complete  
**Created:** 2026-11-17  
**Last Updated:** 2026-11-17  

# Code Review — #1527 BE: Root filter `^Topic:` + flat emit

Three review axes (Standards / Spec / Thermo-nuclear) plus the full test
suite. One round: no critical/major findings; the minors worth fixing
were remediated in-round and re-verified live.

## Scope reviewed

- `functions/src/gh-lifecycle/github-client.ts` — #1527 hunks only:
  `title` on `SEARCH_PAGE`, the `isTopicRoot` filter +
  hits-seen `seen` counter in `searchTopicRoots`, truncation computation
  (the `Rest`/`githubRest` transport in the same file is #1528's scope)
- `tests/functions/gh-lifecycle/github-client.test.ts` — root-filter
  describe block + fixture `title`
- `scripts/verify/dev-tools-gh-lifecycle-639-fetch.ts` + `.md` — the
  `^Topic:` root check and the inside-tree acceptance checks

Note: the "flat emit" half of this task shipped under #1522
(contract v2) — verified still emitting `{topics, groupOrder, fetchedAt,
groupingWarning?}`; this review covers the remaining filter work.

## Round 1 findings and remediation

| Severity | Axis | Finding | Resolution |
|---|---|---|---|
| Minor | TN + Standards | `n.title ?? ''` counted an unclassifiable hit (valid id/number, missing title) as `seen` then silently dropped it — inverting the "uncollected hits trip truncation" semantics | `seen++` now gated on `typeof n.title === 'string'`; unclassifiable hits count as missed. New spec pins it (missing-fixture hit → `truncatedNodes === 1`) |
| Minor | Spec | Live verify asserted fake roots absent *from roots* but not that they render *inside* trees — the issue's literal acceptance (#697/#713/#1509) | 639-fetch gains `#697 ∈ childrenOf[619]` and `#713/#1509 ∈ childrenOf[697]` checks — PASS live |
| Nit | TN + Standards | `hasNext && after===null ? true : seen < issueCount` — redundant ternary | Simplified to `||` |
| Nit | TN | Test name "via buildTree dedup" overclaimed (asserts fetch-level roots only) | Renamed + comment now describes the actual mechanism (numToId order + dedup) |
| Nit | TN + Standards | Search fixture stamped `title ?? ''`, silently swallowing fixture typos | Fixture emits the real value; a missing fixture now surfaces as an unclassifiable (missed) hit |
| Noted | TN | Search-title vs fetched-title race — a retitle between SEARCH_PAGE and NODES_BATCH can still emit a non-`Topic:` depth-0 node | Accepted — inherent two-query race, flagged; `Issue.title` is `String!` so the missing-title case can't fire legitimately |
| Noted | Standards | `github-client.ts` at ~400 lines — proximity to the 400-line strong-smell line (mostly #1528's transport block) | Flagged for the #1528 review; not this task's fix |

## Test results

- `npx jest` full suite: **315 suites / 5832 tests, all pass**
- `npx tsx --test tests/functions/gh-lifecycle/*.test.ts`: **56/56** (incl. new unclassifiable-hit case)
- `npx tsx scripts/verify/dev-tools-gh-lifecycle-639-fetch.ts` (live): **ALL CHECKS PASSED** — 43 roots, all pass `^Topic:`; #697 inside #619; #713/#1509 inside #697
- `functions && npm run build`: clean (earlier in session)

## Second pass (serial coverage check)

Re-checked the union of the three axes over the full diff: every finding
captured and remediated as recorded; truncation math re-derived
(`seen < issueCount` fires only on unclassifiable/null-node hits, never
on filtered fakes); error paths examined (missing payload → throw,
null nodes → `?? []`, malformed fields → missed→truncated); the Rest
transport block confirmed as #1528 scope. One pre-existing theoretical
edge noted (absent-vs-null `endCursor` could skip the break — GraphQL
returns the field as null; outside this diff). Converged — no further
pass needed.

## Verdict: **PASS** (2 passes: axes in parallel + serial coverage pass; in-round remediations verified)

Next: `/proj qa 619 1527`.
