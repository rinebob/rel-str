**Topic:** GitHub read-only issue UI  
**Topic Slug:** `gh-issues-ui`  
**Thread:** Lifecycle viewer  
**Thread Slug:** `lifecycle-viewer`  
**Issue:** #633  
**Task:** #637  
**Topic Parent:** #619  
**Domain:** DEV-TOOLS  
**Type:** CODE-REVIEW  
**Area:** SHARED  
**Status:** Resolved  
**Created:** 2026-09-28  
**Last Updated:** 2026-09-28  

---

# Code Review — #637 SHARED-IMPL: Lifecycle tree contract + transforms

## Scope reviewed

`shared/lifecycle-contracts.ts`, `shared/lifecycle-tree.ts`, both spec files, `scripts/verify/dev-tools-lifecycle-contracts-637.{ts,md}`, and the `README.md`/`run-all.ts` registrations.

## Standards

Clean overall: files well under size limits, pure functions with no I/O, no `any`/type-erasure, no dead code, naming matches neighbors. Two minor findings — `parseInventoryGroups` returns `null` over an empty array (the flag semantics are intentional and consistent with the docs), and `LifecycleRepoRequest` had no shape assertion (addressed: contract spec now asserts shapes on real `buildTree`/`orderTopics` output instead of literals). Nits: cwd-dependent verify path (consistent with run-all convention), non-null assertion in `orderTopics`/`parseInventoryGroups` spec (safe — guarded by `.filter`/`.has`).

## Spec

All four task AC checkboxes MET at the implementation level; ~20/25 enumerated test-plan targets covered initially. Gaps found and closed in-cycle: lowercase `1_idea` non-match (explicit AC bullet), multi-stage-label determinism, closed-issue stage decode, cycle termination, root-as-child dedup.

## Thermo-nuclear

Four majors, all resolved in this cycle:

1. **Root-as-child double emission** — `buildTree` filtered roots against `expanded` eagerly (filter evaluated before expansion). Fixed: sequential loop skips a root already expanded as a descendant; spec added.
2. **`decodeLabels` loose regex + multi-stage silence** — repo has real issues carrying two stage labels (TOPICS-INVENTORY "Known drift"). Fixed: closed `STAGE_LABELS` const (`1_IDEA`…`8_LIVE`); highest ordinal wins, stale label dropped; specs added.
3. **Contract/doc drift** — BE test doc asserted `truncatedNodes === 0` but the contract lacked the field; PRD listed `category?`/`domain?` on the node. Fixed: `truncatedNodes: number` added to `LifecycleTreeResponse` (callable throws on nonzero — the field makes the invariant assertable); docs updated to drop `category?`/`domain?` (labels carry through as tag chips).
4. **Contract spec was test theater** — asserted the shape of its own literal. Fixed: rewritten to assert keys/optional-field omission on real `buildTree`/`orderTopics` output.

Minors accepted with documentation: `nodeType` is a title-convention presentation hint (noted in IMPL); `parseInventoryGroups` collapses parse-failure modes into `null` — BE distinguishes "doc missing (404)" from "doc parsed to zero groups" via `groupingWarning` (IMPL updated); `updatedAt` lexical ordering documented as ISO-8601 contract on `LifecycleRawIssue`.

## Test results

`npx jest --coverage=false` — **153 suites, 2087 tests, all pass** (33 lifecycle tests).

## Findings

- **Critical:** none
- **Major:** 4 — all resolved in-cycle and re-verified
- **Minor:** 4 — resolved or documented
- **Nit:** 6 — no action needed

## Verdict

**PASS**

---

## Re-review iterations (post-verdict refinement pass)

### Iteration 2 — three axes re-run on post-fix code

- Doc drift fixed: TEST doc stage-label bullets (closed set, max-ordinal), `statusOf` param name; IMPL `stageLabel` field comment; PRD detection rule; demoted-topic group-placement note added to IMPL.
- New specs: `[9,1]` root-order direction (root-first wins), 4-level deep nesting.
- Verify script: tautological stage check → direct `stageLabel` assertion on emitted node.
- Comments added: stage-title vs label vocabulary divergence, state normalization, caller-order dedup.
- No new majors.

### Iteration 3 — convergence sweep

- Deduped children now contribute `updatedAt` to the parent's max (subissue relationship is real regardless of render placement); propagated value is the emitted node's subtree max via `emittedUpdatedAt` map (cycle-ancestor mid-expansion falls back to raw timestamp — inherently unresolvable).
- `orderTopics` guards `!grouped.has(n)` — a topic listed in two groups can no longer duplicate across sections even for non-parser inputs.
- Verify script: vacuous section check replaced with exact-count (`flatMap length === trees.length`) + real-doc assertion (#594 must land in a named section).
- `TOPIC_ROW` accepts en-dash; `orderTopics` comparator unified to code-unit ordering with `buildTree`'s max propagation; empty-string `status` no longer emitted; `BLUEPRINT_TITLE_PATTERN` accepts hyphenated area prefixes.

### Iteration 4 — final sweep: converged

No remaining defects beyond documented trade-offs. **35 lifecycle specs, 2089-suite-wide tests green; verify script passes against the real TOPICS-INVENTORY.md.**
