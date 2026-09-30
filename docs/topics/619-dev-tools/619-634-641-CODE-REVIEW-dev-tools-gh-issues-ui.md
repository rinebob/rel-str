**Topic:** GitHub read-only issue UI  
**Topic Slug:** `gh-issues-ui`  
**Thread:** Lifecycle viewer  
**Thread Slug:** `lifecycle-viewer`  
**Blueprint:** #634  
**Task:** #641  
**Domain:** DEV-TOOLS  
**Type:** Code Review  
**Status:** Complete  
**Created:** 2026-09-29  

# Code Review — Deploy + prod verify (`GITHUB_READ_TOKEN`, second repo)

## Files changed

- `functions/src/gh-lifecycle/config.ts` — `SUPPORTED_REPOS` gains `{ owner: 'rinebob', repo: 'av-proxy-api' }` (no `projectNumber` — no board → nodes carry no `status`)
- `src/app/features/topic-viewer/topic-viewer.service.ts` — `TOPIC_VIEWER_REPOS` mirror gains `av-proxy-api` (per the sync requirement in the service doc comment)
- `scripts/verify/dev-tools-gh-lifecycle-640-callable.ts` — the verify script (from #640)

## Review axes

**Standards + spec:** PASS. Config entries are data — correct shape, comment explains absent `projectNumber`. FE/BE mirrors consistent (same owners/repos). Secret binding validated at deploy time.

## Decisions

- Classic PAT (`repo` + `read:project`) — fine-grained PATs cannot access user-owned Projects v2; the account-permissions dropdown hides "Projects" for user-owned resource. Documented in #638.
- `av-proxy-api` has no `projectNumber` — status chips absent for its nodes by design.
- Hosting deploy out of scope — FE ships through the normal app-deploy path, not this task.

## Evidence

| Check | Result |
|---|---|
| `firebase deploy --only functions` | clean; `getLifecycleTree` + all functions live |
| `dev-tools-gh-lifecycle-640-callable.ts` (real GitHub) | 10/10 — shape, truncation, #619→#621 hierarchy, stage labels, error mapping |
| `npm run build` (functions) | clean |
| `jest src/app/features/topic-viewer` | 30/30 |

## Verdict

**PASS**
