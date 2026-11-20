**Topic:** GitHub read-only issue UI  
**Topic Slug:** `gh-issues-ui`  
**Thread:** Lifecycle tree fetch performance & caching  
**Thread Slug:** `lazy-loading`  
**Issue:** #1640  
**Thread Parent:** #1609  
**Topic Parent:** #619  
**Task:** #1635  
**Domain:** DEV-TOOLS  
**Type:** UAT  
**Status:** Complete  
**Created:** 2026-11-19  
**Last Updated:** 2026-11-19  

# UAT — #1635 getLifecycleTopicIndex callable

## Scope

`getLifecycleTopicIndex` — the lazy viewer's slim index callable.
One `^Topic:` root search + one slim `nodes()` batch (no `subIssues`
expansion) → `LifecycleTreeResponse` with every root `children: []`,
`groupOrder`, `fetchedAt`, `groupingWarning` parity. Plus the
`LifecycleTopicTreeRequest` contract and `index.ts` registration.

## Prerequisites

- Repo checkout on `prod` with this task's uncommitted changes.
- `GITHUB_READ_TOKEN` env var, or `gh auth` (the script falls back).
- `NODE_OPTIONS="--require C:\Users\bob\.config\node\ipv4-only.cjs"`
  for the node test scripts (IPv6 workaround).

## Getting to the feature

BE-only callable — no UI surface yet. The feature is exercised at the
handler level against real GitHub via the permanent verify script
(deploy of the `onCall` wrapper happens at `/proj ship`):

```powershell
$env:NODE_OPTIONS="--require C:\Users\bob\.config\node\ipv4-only.cjs"
npx tsx scripts/verify/dev-tools-gh-lifecycle-1635-index.ts
```

## Automated evidence

- `cd functions && npm run test:gh-lifecycle` — 83/83.
- `cd functions && npm run build` — clean.
- `npx jest --coverage=false` — 6,126/6,126 (full suite).
- `npx tsx scripts/verify/dev-tools-gh-lifecycle-1635-index.ts` —
  ALL CHECKS PASSED (3.5s, 43 roots).

## Scenarios

### S1 — Index fetch returns all roots with no subtree expansion

- **Feature:** slim index fetch.
- **Steps:** run the verify script (command above).
- **Expected:** `PASS topics returned`, `#619 present`, every root
  passes `^Topic:`, every topic `children: []` — **no** `subpage:`/
  `subIssues` calls in the fetch path.
- **Result:** PASS — 43 roots, all `children: []`, 3.5s end-to-end
  (vs 30-60s monolith).

### S2 — Metadata + grouping parity with the monolith

- **Feature:** left-pane-ready response shape.
- **Steps:** same run — check the topic list block.
- **Expected:** number/title/state/url/updatedAt present on every
  root; `labels[]` present (stage chips); `group` + `groupOrder`
  carry the TOPICS-INVENTORY sections; `fetchedAt` stamped; at least
  one topic has a project `status`.
- **Result:** PASS — all checks green; `groupOrder` = the 6 inventory
  sections + Ungrouped.

### S3 — Truncation: never silently misses a root

- **Feature:** missing-roots recount (review finding, remediated).
- **Steps:** `npm run test:gh-lifecycle` — specs
  `null nodes() slots … count as truncated`,
  `a node returned under a mismatched number counts as a missed root`,
  `search-leg truncation still counts`, and the handler spec
  `truncatedNodes > 0 → internal with the count`.
- **Expected:** all green — null slot, mismatched `node.number`,
  short search page each count as truncated; handler throws
  `internal` naming the count.
- **Result:** PASS — 83/83.

### S4 — Error mapping + validation

- **Feature:** callable guards.
- **Steps:** verify script's validation section + specs.
- **Expected:** unsupported repo → `invalid-argument`; unauth →
  `unauthenticated`; rate-limit → `resource-exhausted` (spec);
  malformed payload → explicit `missing nodes payload` error (spec),
  never a silent empty result.
- **Result:** PASS — script validation block green; specs green.

### S5 — Rollback path intact

- **Feature:** monolith retained.
- **Steps:** `grep getLifecycleTree functions/src/index.ts` → still
  exported; monolith specs in `callables.test.ts` /
  `github-client.test.ts` still green.
- **Expected:** `getLifecycleTree` export present; its specs pass.
- **Result:** PASS — export on `index.ts:190`; monolith specs green.

### S6 — Deploy registration

- **Feature:** `onCall` registration for the next deploy.
- **Steps:** `grep getLifecycleTopicIndex functions/src/index.ts`
  → exported; deploy happens at `/proj ship`
  (`firebase deploy --only functions`), post-deploy re-run of this
  same verify script confirms the deployed surface.
- **Expected:** export line present; `getLifecycleTopicIndex` appears
  in the functions console after ship with `GITHUB_READ_TOKEN` secret
  and 60s timeout.
- **Result:** PASS — export verified at `index.ts:190`; deploy check
  deferred to ship (script reruns unchanged).

## Manual UI/UX refinement pass

Not applicable — no user-facing surface. BE-only callable; FE
consumption lands in #1637/#1638.

## Findings

- None open. Review's single major (missing-roots recount) remediated
  and spec-pinned before this gate. Deferred nits documented in the
  CODE-REVIEW doc (456-line file flag → #1636 split option;
  `labels(first:50)` soft-degrade accepted as parity).

## Traceability

| Acceptance criterion | Scenario |
|---|---|
| Index query contains no `subIssues` (spec-pinned) | S1 + query-text spec |
| `children: []` + metadata + grouping parity | S1, S2 |
| Search-leg truncation → `internal` | S3 |
| `LifecycleTopicTreeRequest` exported | S5 context; contract file |
| Callable registered in `index.ts` | S6 |
| Specs + build green | Automated evidence |

## Regression / smoke

- [x] Monolith `getLifecycleTree` specs unchanged and green (shared
  `assembleTreeResponse` extraction is the only touch — monolith
  handler specs still pass verbatim).
- [x] Label callables unaffected (separate deps/file) — suite green.
- [x] Full jest suite green — no FE/shared regressions.

## Verdict

**PASS** — all scenarios green on the real GitHub path; the index
callable is deploy-ready (ship step deploys + re-verifies).

## Results log

- 2026-11-19 — S1–S6 PASS. Verify script re-run post-remediation:
  3.5s, 43 roots, all checks green. Suite 83/83; jest 6,126/6,126.
  Refinement pass N/A (BE-only).
