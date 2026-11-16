**Topic:** GitHub read-only issue UI  
**Topic Slug:** gh-issues-ui  
**Thread:** Topic Viewer UI polish & misc fixes  
**Thread Slug:** topic-viewer-polish  
**Issue:** #1519  
**Thread Parent:** #697  
**Topic Parent:** #619  
**Task:** #1524  
**Domain:** DEV-TOOLS  
**Type:** CODE-REVIEW  
**Status:** Complete  
**Created:** 2026-11-15  
**Last Updated:** 2026-11-15  

# Code Review — SHARED: Retrofit GitHub native sub-issues (#1524)

## Round 2 (final-state re-review)

All three axes re-ran against the remediated state: **0 critical ·
0 major · 2 minor · ~8 nit** — converged. Round-1 fixes verified in place
(no regressions); remaining items were remediated as part of this round:

| Finding | Disposition |
|---|---|
| `ancestorOf` re-fetch loop on a nonconforming `IssueReader` (500 wasted calls/hop) | Fixed — missing keys are written `null` definitively; reader contract documented |
| `ghJsonPartial`/`fetchDetails` null `data.repository` → TypeError or silent degrade | Fixed — throws a named error (bad `--repo`/auth/rate-limit) |
| Verify script ENOENT on fresh clone (`.devin/tmp` absent) | Fixed — `mkdirSync` first |
| Lazy-ancestor path (the production bug) had no spec | Fixed — dedicated `planRetrofit` spec: intermediate ancestor undeclared → lazily fetched → blocked |
| Exit precedence masked apply failures behind conflict exit | Fixed — `failures→3` checked before `conflicts→2` |
| `## Tasks:` trailing-colon heading wouldn't parse | Fixed — heading match strips `:` |
| TEST doc stale wording (cycles → "conflicts") | Fixed — doc now describes `blocked`/`superseded` semantics |
| verify `REPOS` hardcode vs `SUPPORTED_REPOS` | Fixed — derived |

**Deliberately not changed** (judged scope-proportionate): reopen/close
grouping per parent (polish for an ops script), `BlockedEdge.via` shape,
`proposedParent` conservative over-blocking (report-only, errs safe).

## Verdict: PASS

Round 1 found **3 majors and 4 minors** across the three axes — all
remediated in place and re-verified before this verdict. The two most
valuable catches surfaced *through* the remediation verification, not
static inspection: a masked mutation failure and a cycle-detection hole
that only GitHub could see.

## Standards

| Severity | Finding | Disposition |
|---|---|---|
| major | New files used tab indent; `.editorconfig` + repo convention is 2-space | Fixed — all files rewritten in spaces |
| major | `isTopicRoot` landed in `retrofit-hierarchy.ts`; IMPL §2 puts it in `lifecycle-tree.ts` for the BE root filter | Fixed — moved to `lifecycle-tree.ts`, imported by script + spec |
| minor | `DEFAULT_REPOS` duplicated `SUPPORTED_REPOS` | Fixed — imports from `functions/src/gh-lifecycle/config` (dependency-free, same path the #639 verify script uses) |
| nit | verify `FAILED` vs sibling `FAIL`; local Edge/Report types; `first:30` cap; weak `total>0` invariant | Fixed — convention, imported types, `first:100`, real `buckets===intended` invariant |

`gh api graphql` partial-data recovery was also flagged for confirmation —
see the masked-mutation finding below (it was real, and worse than guessed).

## Spec

| Severity | Finding | Disposition |
|---|---|---|
| major | Read-transport seam not injected; TEST doc's "highest seam" (parse+diff+report pipeline vs fixture gh responses) unmet | Fixed — `planRetrofit(anchors, IssueReader)` extracted to `shared/`; 5 pipeline specs added (BFS, superseded, anchor-skip, unresolved, bucket partition) |
| minor | Declared-cycle/first-declarer drops were silent | Fixed — `superseded` report bucket: every shadowed declaration prints + lands in the JSON report (14 surfaced in the live run) |
| minor | `## Tasks` parsed beyond the spec's section list | Accepted — deliberate superset; thread bodies declare lane children there. Noted in code comment |
| nit | alreadyCorrect/per-edge apply lines not printed | Partial — apply now logs `linked #c under #p` per edge; already-correct stays count-only (500+ edges of noise otherwise) |

All task ACs and PRD US-1 criteria: **met**. Scope-creep items (`--only`,
`blocked`, `skippedAnchorChildren`, exit 3) judged defensible — they only
ever narrow or report, never mutate.

## Thermo-nuclear

| Severity | Finding | Disposition |
|---|---|---|
| major | `closeIssue` re-close clobbers `stateReason` — a NOT_PLANNED/DUPLICATE parent would silently become COMPLETED | Fixed — `stateReason` fetched, threaded through `MutationOps.setIssueState`, echoed in `closeIssue` input; spec-pinned |
| major | "Shared by the BE root filter" claim was unwired | Fixed (comment) — consumption lands in #1527 (blocked by #1522); placement in `shared/` is correct for both |
| minor | Cycle filter only walked live parents of *fetched* nodes | Fixed — see below; this turned out to be exploitable in production |
| minor | `JSON.parse(stdout)` unguarded on error path | Fixed — try/catch preserves the real gh error |
| nits | double batching, `--only` NaN, `--limit 400` | Fixed (`--only` guard); batching kept (BATCH=15 bounds query size) |

## What the remediation verification caught (the real story)

Re-running `--apply` against prod after the fixes exposed **two bugs no
static review had fully predicted**:

1. **Masked mutation failure.** `gh: Failed to add sub-issue #140 —
   circular dependency` printed to stderr while the script reported
   `applied: 1` — the partial-`data` recovery intended for query errors
   swallowed mutation errors. Split into `ghJson` (strict — mutations must
   throw) and `ghJsonPartial` (fetch-tolerant). This also means the earlier
   "39 applied / 0 failed" count was audited: a post-fix re-run shows
   `proposed: 0` — every reported apply genuinely persisted.

2. **Cycle-detection hole.** #140 under #139 cycled through an *unfetched
   intermediate ancestor* — the walk only consulted parents of fetched
   nodes. `partitionBlockedCycles` now takes an `ancestorOf` resolver and
   `planRetrofit` lazily fetches intermediate ancestors — matching GitHub's
   own check. The live run now shows `BLOCKED #140 under #139` at plan
   time instead of a doomed apply.

A third finding the run surfaced for free: **14 superseded declarations**
(issues whose bodies declare a child already claimed by an earlier
issue — e.g. #851 and #625 both declaring #852–#854). Previously silent;
now reported.

## Test results

- `shared/retrofit-hierarchy.spec.ts`: **31/31** — parse, indent-stack
  resolution, diff partition, `partitionBlockedCycles` (incl. two-edge
  proposed cycle), `planRetrofit` pipeline via fixture `IssueReader`,
  `applyEdges` ordering + finally-restore + `stateReason` echo.
- Verify `scripts/verify/dev-tools-retrofit-subissues-1524.ts`:
  **17/17 PASS against prod** — dry-run both repos, real bucket invariant
  (`buckets === intended`), post-apply `proposed: 0`, live-parentage
  spot-checks, #137 native sub-issue persistence.
- Full suite: **312 suites / 5608 tests** green.

## Files

- `shared/retrofit-hierarchy.ts` — parse / edges / diff / blocked-cycle
  partition / `planRetrofit` (injected `IssueReader`) / `applyEdges`
  (injected `MutationOps`, finally-restore, `stateReason` echo)
- `shared/retrofit-hierarchy.spec.ts`
- `shared/lifecycle-tree.ts` — `isTopicRoot` (+4 lines)
- `scripts/retrofit-gh-subissues.ts` — CLI glue: anchors, aliased-batch
  GraphQL reader, strict/partial gh split, apply, report, exit codes
- `scripts/verify/dev-tools-retrofit-subissues-1524.{ts,md}` + README row +
  run-all entry

## Deferred / out of scope (by design)

- **132 conflicts** across both repos — child parented elsewhere than the
  body declares (incl. inverted blueprint↔task pairs). Reparenting needs a
  decision: `--reparent` mode or manual triage — follow-up scope.
- 5 dead body refs under #108; 4 blocked cycles incl. the #139/#140 pair
  whose *live* structure is itself inverted (conflict #142-style).
- `assignGroups`/`isSystemLabel` TEST-doc items belong to #1522/#1523.
