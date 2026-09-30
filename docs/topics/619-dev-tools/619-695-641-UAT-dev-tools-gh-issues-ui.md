**Topic:** GitHub read-only issue UI  
**Topic Slug:** `gh-issues-ui`  
**Thread:** Lifecycle viewer  
**Thread Slug:** `lifecycle-viewer`  
**Issue:** #695  
**Task:** #641  
**Topic Parent:** #619  
**Domain:** DEV-TOOLS  
**Type:** UAT  
**Area:** BE  
**Status:** Complete  
**Created:** 2026-09-29  
**Last Updated:** 2026-09-29  

---

# UAT — #641 BE-IMPL: Prod verify + deploy

## Scope

Deploy `getLifecycleTree` to prod with `GITHUB_READ_TOKEN` secret bound; add `av-proxy-api` to `SUPPORTED_REPOS` + `TOPIC_VIEWER_REPOS` mirror; prod verify via real GitHub.

## Scenarios

### S1 — Functions deploy + secret binding

`firebase deploy --only functions` — expected clean deploy; `getLifecycleTree` listed among live functions; secret binding validated (deploy fails when a declared secret is inaccessible).

**Result:** PASS — deploy complete, no secret-access errors.

### S2 — Real GitHub fetch via handler

```powershell
npx tsx scripts/verify/dev-tools-gh-lifecycle-640-callable.ts
```

Expected: 10/10 — response shape, `truncatedNodes === 0`, fresh `fetchedAt`, sections non-empty, #619 as `topic` containing thread #621, stage labels present, `invalid-argument`/`unauthenticated` mapping.

**Result:** PASS — 10/10 (uses `gh auth` locally; deployed function uses `GITHUB_READ_TOKEN` — same code path, different credential).

### S3 — Repo whitelist

`av-proxy-api` accepted by the callable; unsupported repos → `invalid-argument`. Picker shows rel-str + av-proxy-api.

**Result:** PASS — config entries on both sides; unsupported-repo check covered in S2.

### S4 — Live page smoke (user)

Open `/tools/topic-viewer` in the app once the FE deploys through the normal path: tree renders, status chips populated for rel-str, av-proxy-api nodes lack status chips (no project), error banner absent.

**Result:** DEFERRED — FE deploys through the app's normal hosting path (not this task); first-call secret exercise will confirm binding at that point.

## Traceability

| Acceptance criterion | Scenario |
|---|---|
| Callable deployed + secret bound | S1 |
| Real GitHub data round-trips | S2 |
| Second repo supported | S3 |
| Page live in prod | S4 (deferred to app deploy) |

## Refinement pass

N/A — operational task.
