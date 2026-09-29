**Topic:** GitHub read-only issue UI  
**Topic Slug:** `gh-issues-ui`  
**Thread:** Lifecycle viewer  
**Thread Slug:** `lifecycle-viewer`  
**Blueprint:** #634  
**Task:** #640  
**Domain:** DEV-TOOLS  
**Type:** Code Review  
**Status:** Complete  
**Created:** 2026-09-28  

# Code Review — BE `getLifecycleTree` callable

## Files changed

- `functions/src/gh-lifecycle/callables.ts` — onCall + `handleGetLifecycleTree` + `ghLifecycleDeps` + `mapGitHubError` + `internalGuard`
- `functions/src/index.ts` — re-export
- `tests/functions/gh-lifecycle/callables.test.ts` — 14 handler specs
- `functions/package.json` — `test:gh-lifecycle` covers both spec files
- `tsconfig.json` — root `@lifecycle/*` aliases (tsx path resolution)
- `scripts/verify/dev-tools-gh-lifecycle-640-callable.ts` + guide — real-deps handler verify
- `scripts/verify/README.md`, `run-all.ts` — registration (`needsGh`)
- `shared/lifecycle-tree.ts` + spec — sections-never-empty guarantee
- `functions/src/gh-lifecycle/github-client.ts` — GraphQL comment fix + bounded error body

## Review axes

**Standards:** APPROVE — matches `read-callables.ts` pattern; no `as any` in prod code; missing secret → `failed-precondition` naming it; deps called per-request (correct secret timing).
**Spec:** PASS — every IMPL §5 bullet implemented; request validation, error mapping, grouping degrade, truncation throw all spec'd and tested.
**Deep review:** no crash bugs; produced the fixes below plus confirmed error-mapping coverage, HttpsError passthrough, fails-closed validation.

## Iterations and fixes

**Pre-review (self-caught by real verify):** `/* */` comment inside the GraphQL template is invalid GraphQL syntax (shipped in #639 — fixture transport couldn't see it; real run failed instantly). Moved to a TS comment.

**Round 1:**
- `groupingWarning` forwarded the raw upstream REST body into the client payload → sanitized to `GitHub {status}`; `fetchFileText` error body now bounded to 200 chars; spec asserts the blob never leaks
- `orderTopics` could return `[]` (groups non-empty, zero topic roots) → always returns ≥1 section; new spec covers both branches
- 403 message lacked the token hint required by IMPL §5 → added scope hint
- `fetchedAt` captured after the BFS walk → moved before `fetchData` (stamps fetch time)
- Validation spec widened (missing owner, non-string, null/undefined data); `as any` → typed `CallableRequest` factory
- Verify script: recursive node-field check, `stageLabel` presence, grouped-sections check tolerates a legitimate 404 doc

**Iteration 2** — CLEAN; only a misleading comment fixed.

## Deliberate decisions (kept)

- `401 → unauthenticated` for a bad backend token — spec-required (TEST doc error-mapping bullet); message carries the remediation hint.
- `truncatedNodes: 0` constant in response — guaranteed by the preceding throw; ceremonial per contract.
- `internalGuard` duplicated locally — the established `read-callables` pattern; a third copy would justify extraction.

## Evidence

| Check | Result |
|---|---|
| `npm run test:gh-lifecycle` | 29/29 pass |
| `jest shared/lifecycle-tree.spec.ts` | 31/31 pass |
| `dev-tools-gh-lifecycle-640-callable.ts` (real GitHub) | ALL CHECKS PASSED |
| `functions` esbuild + tsc | clean |

## Verdict

**PASS**
