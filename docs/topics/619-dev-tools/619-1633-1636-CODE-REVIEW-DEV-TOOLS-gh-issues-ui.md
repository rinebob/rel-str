**Topic:** GitHub read-only issue UI  
**Topic Slug:** `gh-issues-ui`  
**Issue:** #1633  
**Task:** #1636  
**Topic Parent:** #619  
**Domain:** DEV-TOOLS  
**Type:** CODE-REVIEW  
**Status:** Final  
**Created:** 2026-11-20  
**Last Updated:** 2026-11-20  

# Code Review — BE-IMPL: getLifecycleTopicTree callable (#1636)

## Axes summary

| Axis | Verdict | Findings |
|---|---|---|
| Standards | FAIL → remediated | 1 major (file-size gate: github-client.ts 527 lines — the split this task reserved); 2 minors; 2 nits |
| Spec | PASS | all 6 ACs met/met-by-construction; 4 lows (spec-strengthening), 2 nits |
| Thermo-nuclear | PASS | no critical/major; 3 minors, 5 nits |

## Remediated in-gate

1. **MAJOR — `github-client.ts` split** (Standards): transports stay in
   `github-client.ts` (148 lines: `Gql`, `GitHubApiError`+`gqlType`,
   `githubGql`, `Rest`, `githubRest`, `fetchFileText`); the whole
   lifecycle BFS shell moved to new `lifecycle-fetch.ts` (392 lines:
   queries, `searchTopicRoots`, `collectSubIssues`, `walkSubtree`, all
   `fetch*` entry points). Importers updated (`callables.ts`,
   `label-callables.ts` untouched, 639 verify script), spec file renamed
   to `lifecycle-fetch.test.ts` + `test:gh-lifecycle` script updated.
   Pure move — zero behavior change, spec-pinned green.
2. **`walkSubtree` missing-nodes guard** (all three axes converged):
   `Array.isArray(data.nodes)` check added — malformed batch now throws
   the same controlled `missing nodes payload` `GitHubApiError` as the
   index path instead of a raw `TypeError`.
3. **`topicNumber` Int32 bound** (Thermo nit → fix): `> 2_147_483_647`
   now `invalid-argument` instead of a mid-probe GraphQL error; local
   renamed `topicNumber` → `data`.
4. **Spec gaps closed** (convergent): malformed-probe branch spec,
   `repository:null`-without-errors spec, `statusOf` parity made
   non-vacuous (a `projectItems` Status fixture), `topicNumber`
   over-Int32 row in the parametrized validation spec.
5. **IMPL doc drift** (Spec F5/Thermo): probe selects `{ number id
   title }` (doc said `id title state`); new file layout + the
   `NOT_FOUND`-error-collapse design note documented; IMPL/TEST
   Status → Complete.

## Deferred findings (documented, not blocking)

- **Repo-level `NOT_FOUND` masked as issue not-found** — a gone/renamed
  repo collapses to `null` → `not-found` naming the issue. Fixing
  requires carrying GraphQL error `path` into `GitHubApiError`;
  misdiagnosis severity is low (the supported-repos allowlist makes
  this near-impossible in practice). Defer.
- **Single-topic `groupingWarning` semantics** (Spec F4 / Thermo):
  the stale-doc check fires when the doc lists none of the *fetched*
  topics — on a per-topic response any unlisted topic warns even when
  the doc is healthy (observed live on #619, which is not in
  TOPICS-INVENTORY). Same-code parity is correct; the FE should treat
  `groupingWarning` on per-topic responses as advisory. Flagged for
  #1637/#1638.
- GraphQL-typed logical errors (`RATE_LIMITED` in `errors[]`) map to
  `internal` not `resource-exhausted` — pre-existing transport
  behavior, all callables share it. Defer.
- `groupOrder` carries all inventory groups on a single-topic
  response — shared contract, FE merges. Defer.
- Double-count edge (root also listed as a vanished child) inflates
  `truncatedNodes` only in the error message. Defer.
- `callables.ts` at 301 lines — next callable is the split point. Defer.
- Verify script hardcodes #697 as the non-topic guard — fails only if
  that issue is retitled `Topic:`. Acceptable.

## Test results

- `npm run test:gh-lifecycle` — **101/101 pass** (post-remediation)
- `npm run build` (functions) — esbuild clean
- Full jest suite — **6,126/6,126** (this task's diff is BE-only;
  suite re-run pre-review)
- Live verify `dev-tools-gh-lifecycle-1636-topic-tree.ts` — **ALL
  CHECKS PASSED** post-remediation: 4.1s for #619 (61 descendants),
  all guard paths (`invalid-argument` / `not-found` /
  `unauthenticated`) correct.

## Verdict

**PASS** — one major (file split) remediated in-gate with spec-pinned
green; remaining items are nits or documented deferrals.
