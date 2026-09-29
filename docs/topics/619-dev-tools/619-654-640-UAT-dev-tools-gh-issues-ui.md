**Topic:** GitHub read-only issue UI  
**Topic Slug:** `gh-issues-ui`  
**Thread:** Lifecycle viewer  
**Thread Slug:** `lifecycle-viewer`  
**Issue:** #654  
**Task:** #640  
**Topic Parent:** #619  
**Domain:** DEV-TOOLS  
**Type:** UAT  
**Area:** BE  
**Status:** Complete  
**Created:** 2026-09-28  
**Last Updated:** 2026-09-28  

---

# UAT — #640 BE-IMPL: getLifecycleTree callable endpoint

## Scope

`functions/src/gh-lifecycle/callables.ts` — onCall endpoint: auth gate, `SUPPORTED_REPOS` validation, fetch → shared transforms → `LifecycleTreeResponse`, `truncatedNodes > 0` → internal, grouping degrade (404 flat / error → `groupingWarning`), error mapping. `index.ts` export, test wiring, real-deps verify script.

## Prerequisites

- `npm install` done; `gh` CLI authenticated (or `GITHUB_READ_TOKEN` set).
- Deployed-callable coverage is task #641 — this UAT covers the handler + real deps.

## Scenarios

### S1 — Fixture specs (both gh-lifecycle files)

```powershell
cd functions; npm run test:gh-lifecycle
```

Expected: 29/29 — validation ×4, happy path ×2, truncation/grouping ×4, error mapping ×5, plus the 15 fetch-shell specs.

**Result:** PASS — 29/29.

### S2 — Real GitHub end-to-end (handler + real deps)

```powershell
npx tsx scripts/verify/dev-tools-gh-lifecycle-640-callable.ts
```

Expected: `ALL CHECKS PASSED` — response parses to `LifecycleTreeResponse`; `truncatedNodes === 0`; `fetchedAt` fresh; #619→#621 nested; every node recursively has number/title/state/url; `stageLabel` present; grouped sections from the real inventory doc; unsupported repo → `invalid-argument`; missing auth → `unauthenticated`.

**Result:** PASS — all checks.

### S3 — Registry + build

```powershell
cd functions; npm run build
```

Expected: esbuild bundle clean; `getLifecycleTree` exported from `index.ts`; run-all entry registered with `needsGh` gate.

**Result:** PASS.

### S4 — Security reads

- `secrets: ['GITHUB_READ_TOKEN']` on the onCall options; token read per-invocation via `ghLifecycleDeps()`.
- `groupingWarning` carries only `GitHub {status}` — raw upstream body never reaches the client.
- No raw-error passthrough: non-HttpsError → `internal` via `internalGuard`.

**Result:** PASS — inspected in review; assertion in spec (`raw-body-blob` absent from warning).

## Traceability

| Acceptance criterion | Scenario |
|---|---|
| onCall getLifecycleTree, secrets/timeout/cors/memory | S3 |
| invalid-argument on unsupported/missing repo | S1, S2 |
| truncatedNodes > 0 → internal with count | S1 |
| 404 doc → flat Ungrouped; other → groupingWarning | S1 |
| GitHub 401/403/rate-limit → unauthenticated/permission-denied/resource-exhausted | S1 |
| missing GITHUB_READ_TOKEN → failed-precondition | S1 |
| ghLifecycleDeps exported; index.ts export | S2, S3 |
| Registered verify coverage | S2 |

## Refinement pass

Not applicable — no user-facing surface (FE consumes in #642+).
