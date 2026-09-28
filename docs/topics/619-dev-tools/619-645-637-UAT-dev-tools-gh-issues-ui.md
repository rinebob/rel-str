**Topic:** GitHub read-only issue UI  
**Topic Slug:** `gh-issues-ui`  
**Thread:** Lifecycle viewer  
**Thread Slug:** `lifecycle-viewer`  
**Issue:** #645  
**Task:** #637  
**Topic Parent:** #619  
**Domain:** DEV-TOOLS  
**Type:** UAT  
**Area:** SHARED  
**Status:** Complete  
**Created:** 2026-09-28  
**Last Updated:** 2026-09-28  

---

# UAT — #637 SHARED-IMPL: Lifecycle tree contract + transforms

## Scope

The shared contract + pure-transform layer for the lifecycle viewer: `LifecycleNode`/`LifecycleTreeResponse` shapes and `decodeLabels`, `nodeTypeFor`, `buildTree`, `parseInventoryGroups`, `orderTopics` in `shared/`. No user-facing surface — the deliverable is correct, tested library code that BE #639 and FE #642 build on.

## Prerequisites

- Repo cloned, `npm install` done.
- No credentials, emulator, or network needed — the transforms are pure and the verify script reads only `docs/dev-notes/TOPICS-INVENTORY.md`.

## Scenarios

### S1 — Unit specs green

```powershell
npx jest shared/lifecycle --coverage=false
```

Expected: `lifecycle-contracts.spec.ts` + `lifecycle-tree.spec.ts` pass; ~35 tests covering label decode (closed set, lowercase/lookalike rejection, multi-stage → max ordinal), node typing, tree assembly with `updatedAt`/status propagation, dedupe + cycle + root-as-child guards, inventory parse, and section ordering.

**Result:** PASS — 2 suites, 35 tests.

### S2 — Real-doc pipeline verification

```powershell
npx tsx scripts/verify/dev-tools-lifecycle-contracts-637.ts
```

Expected: all checks `PASS`; the real `TOPICS-INVENTORY.md` parses to its named groups (currently 6, ~24 topics); fixture assertions exercise typing, `updatedAt` propagation, status mapping, closed-state normalization, stage-label decode on emitted nodes, exact topic count across sections, an inventory-listed topic (#594) landing in a named section, and the `groups: null` → single `Ungrouped` fallback. Exit code 0, ends `ALL CHECKS PASSED`.

**Result:** PASS — all checks green, 6 groups parsed.

### S3 — Registered in the verify index

```powershell
npx tsx scripts/verify/run-all.ts
```

Expected: the `lifecycle-tree contract` entry runs (no account/ADC needed) and reports PASS.

**Result:** PASS — entry present in `run-all.ts` and `README.md`; runs credential-free.

## Traceability

| Acceptance criterion | Scenario |
|---|---|
| contracts.ts exports request/response/node/section shapes | S1 (contract-shape specs) |
| lifecycle-tree.ts exports all five transforms | S1 |
| Specs cover decode/typing/assembly/propagation/status/parse/order | S1 |
| Zero I/O, no project-config dependency | S1 + S2 (runs with no credentials) |
| Prod-verifiable pipeline coverage | S2 + S3 |

## Regression / smoke

- [x] Full suite: `npx jest --coverage=false` — 153 suites, 2089 tests, all pass

## Refinement pass

Not applicable — no user-facing surface.
