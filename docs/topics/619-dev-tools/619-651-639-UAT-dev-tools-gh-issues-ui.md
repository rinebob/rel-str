**Topic:** GitHub read-only issue UI  
**Topic Slug:** `gh-issues-ui`  
**Thread:** Lifecycle viewer  
**Thread Slug:** `lifecycle-viewer`  
**Issue:** #651  
**Task:** #639  
**Topic Parent:** #619  
**Domain:** DEV-TOOLS  
**Type:** UAT  
**Area:** BE  
**Status:** Complete  
**Created:** 2026-09-28  
**Last Updated:** 2026-09-28  

---

# UAT — #639 BE-IMPL: Lifecycle GraphQL fetch shell + config

## Scope

`functions/src/gh-lifecycle/`: `SUPPORTED_REPOS` config and the `github-client.ts` fetch shell — topic-root search, level-batched `nodes()` expansion, per-node `subIssues` pagination, `truncatedNodes` counting, `Status` decode, `fetchFileText`. No user-facing surface; the callable endpoint is task #640, deploy/verify is #641.

## Prerequisites

- `npm install` done; `gh` CLI authenticated (or `GITHUB_READ_TOKEN` set).
- No emulator/Firestore — all checks are read-only GitHub + local code.

## Scenarios

### S1 — Fixture specs

```powershell
cd functions; npm run test:gh-lifecycle
```

Expected: 15/15 specs pass — search paging, BFS dedup, level batching, subIssues pagination, three truncation paths (lie-about-totalCount, null nodes() slot, vanished mid-walk issue, stuck search cursor, null subIssues slot), status decode (all four branches).

**Result:** PASS — 15/15.

### S2 — Real GitHub end-to-end

```powershell
npx tsx scripts/verify/dev-tools-gh-lifecycle-639-fetch.ts
```

Expected: `ALL CHECKS PASSED`, exit 0 — SUPPORTED_REPOS resolves rel-str; real BFS finds topic roots with `truncatedNodes === 0`; #619 has #621; every root has number/title/state/url; `statusOf` non-empty; inventory doc fetched; transforms emit non-empty sections.

**Result:** PASS — 27 roots, 480 nodes, 465 statuses, 0 truncation.

### S3 — Registry + build

```powershell
npx tsx scripts/verify/run-all.ts   # gh-lifecycle entry runs under gh auth
cd functions; npm run build
```

Expected: `gh-lifecycle fetch shell` entry executes and passes (scripts needing account/ADC may skip); esbuild bundle builds clean.

**Result:** PASS — entry registered (needsGh gate), build clean.

### S4 — No Octokit / read-only guarantee

Grep the module: `Select-String -Path functions/src/gh-lifecycle/*.ts -Pattern 'octokit|POST.*issues|graphql.*mutation'` — expect zero matches beyond the single graphql POST transport.

**Result:** PASS — read-only; only `api.github.com/graphql` POST + contents GET.

## Traceability

| Acceptance criterion | Scenario |
|---|---|
| SUPPORTED_REPOS {owner, repo, projectNumber?} incl. rel-str | S2 |
| BFS: roots + descendants, per-node subIssues pagination | S1, S2 |
| truncatedNodes > 0 surfaces (never partial) | S1 (truncation specs), S2 (=== 0 asserted) |
| Status read from configured project's Status field by name | S1, S2 (statusOf populated) |
| Specs: pagination, truncation, seen-set, status, search paging | S1 |
| Native fetch — no Octokit | S4 |
| Registered verify coverage | S3 |

## Refinement pass

Not applicable — no user-facing surface.
