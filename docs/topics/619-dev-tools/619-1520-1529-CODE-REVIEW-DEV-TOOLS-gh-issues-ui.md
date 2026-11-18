**Topic:** GitHub read-only issue UI  
**Topic Slug:** gh-issues-ui  
**Thread:** Topic Viewer UI polish & misc fixes  
**Thread Slug:** topic-viewer-polish  
**Issue:** #1520  
**Thread Parent:** #697  
**Topic Parent:** #619  
**Task:** #1529  
**Domain:** DEV-TOOLS  
**Type:** CODE-REVIEW  
**Status:** Complete  
**Created:** 2026-11-17  
**Last Updated:** 2026-11-17  

# Code Review — #1529 BE label write callables

## Verdict

**PASS — with one deploy-time sequencing gate (M1).**

The code is correct, guarded, tested, and live-verified. The single
gate is sequencing, not code: this task's `index.ts` export makes
`updateIssueLabels`/`manageRepoLabel` deployable, and both declare
`secrets: ['GITHUB_WRITE_TOKEN']`, which is not yet minted (#1526 —
pending user action). Any `firebase deploy --only functions` of the
tree after this commit will fail the whole deploy until the secret
exists. Ship the code; **do not deploy before #1526** (or hold the
two export lines back, same slice discipline as #1528).

## Scope reviewed

Worktree delta vs the committed #1528 read slice (`8a21f0bb`):

- `functions/src/gh-lifecycle/label-callables.ts` — write sections:
  `ghLabelWriteDeps`, `issueLabelsPath`, `validateUpdate` +
  `handleUpdateIssueLabels`, `validateManage` + `handleManageRepoLabel`,
  `DEFAULT_LABEL_COLOR`, write-type imports, both onCall exports.
- `functions/src/index.ts` — export widened to all three label callables.
- `tests/functions/gh-lifecycle/label-callables.test.ts` — write specs
  (validation, handleUpdateIssueLabels, handleManageRepoLabel).
- `scripts/verify/dev-tools-gh-lifecycle-1529-labels-write.{ts,md}` —
  live verify (scratch issue, self-cleaning).
- `scripts/verify/run-all.ts`, `README.md` — #1529 registry entries.
- `docs/topics/619-dev-tools/619-697-1513-IMPL-DEV-TOOLS-BE-*.md` —
  as-built guards/endpoint-correction hunk.

The committed read slice (listRepoLabels + shared machinery) was the
base, not the diff.

## Axes

| Axis | Verdict | Findings |
|---|---|---|
| Standards | PASS | 3 MINOR (422-scope, validateManage fields, run-all gate) + 5 NIT |
| Spec | PASS | 1 MINOR (finally-throw) + 4 NIT; every AC + plan bullet traced |
| Thermo-nuclear | PASS-conditional | 1 MAJOR (M1 deploy gate) + 8 minor/nit clusters |

## First-pass findings and dispositions

### Majors

- **M1 — Deploy coupling (thermo):** `index.ts` now exports the write
  callables; `GITHUB_WRITE_TOKEN` unminted → the *next* `firebase
  deploy` fails entirely. **Disposition:** sequencing gate —
  remediated-by-procedure, not code. Carried into the ship summary
  and QA doc; `firebase deploy` must wait for #1526.

### Minors remediated in-round

1. **Blanket 422→already-exists (thermo m3 + standards MINOR-1):**
   `mapLabelError` gained `conflictOn422` — `already-exists` only on
   the two label-create POSTs; PATCH/attach 422 → `invalid-argument`
   (a rejected payload, not a name conflict). New spec pins it.
2. **Empty/whitespace names (thermo m2):** `remove:['']` would
   silently no-op (trailing-slash DELETE → swallowed 404);
   `add:['']` minted a whitespace label → misreported 422.
   `validateUpdate` now requires non-empty trimmed names in both
   arrays. New spec ×4 cases.
3. **`validateManage` optional-field types (thermo m5 + standards
   MINOR-2):** non-string `newName` TypeError'd inside `isSystemLabel`
   → `internal` instead of `invalid-argument`; non-string
   `color`/`description` rode the cast onto the wire. Type+emptiness
   checks added for all three. New spec covers newName.
4. **Run-all credential gate (thermo m7 + standards MINOR-3):**
   `needsGh` checked read creds for a write script — a read-token-only
   env would execute it instead of skipping. New `needsGhWrite` flag +
   `hasGhWriteAuth()` (`GITHUB_WRITE_TOKEN` or gh CLI); the 1529 entry
   uses it.
5. **`gh issue close` inside `finally` (spec MINOR-1):** a thrown
   close masked the real error path. Now try/catch + manual-cleanup
   WARN line.
6. **Spec coverage gaps (thermo m6 + spec NIT-4):** added
   remove-success (`finalLabels` from DELETE response, no trailing
   GET) and combined add+remove (remove-first ordering, attach
   response wins) specs.

### Accepted / documented (not remediated)

- **m4 — mint-before-issue-validation:** a nonexistent `issueNumber`
  can mint an orphan repo label before the attach 404s. Cosmetic
  litter only; the FE always passes real issues. Scope discipline —
  accepted.
- **m6 — fxRest substring matching:** load-bearing on fixture order
  (mirrors call order convention); verified call-by-call in every
  spec. Accepted, same as #1528.
- **m8 — `usageCount` counts PRs:** semantically correct — GitHub
  detaches from PRs on delete too; IMPL doc updated to say so.
- **Nits:** file ~345 lines (cohesive, over the 300 target — noted,
  not split); redundant `?? []` after `validateUpdate` normalization;
  `ureq`/`mreq` near-dup; create-vs-update body-style asymmetry;
  `git reset`-style `Status: Draft` on the IMPL doc (pre-existing).

## Test + verification evidence

- `npm run test:gh-lifecycle` — **65/65** (was 60; +5 specs: empty-name
  ×2, newName malformed, remove-success, combined add+remove,
  non-create 422).
- `npx jest --coverage=false` — **317 suites / 5,885 tests** all green.
- `npx tsx scripts/verify/dev-tools-gh-lifecycle-1529-labels-write.ts`
  — **ALL CHECKS PASSED** on the live repo: scratch issue #1596
  created → `add` minted + attached `uat-verify-1529` (`created`
  listed it) → in-use delete returned `usageCount === 1` → recreate +
  remove detached → create→rename→delete round-trip `usageCount === 0`
  → scratch labels deleted, issue closed. Self-cleaning confirmed.
- `cd functions && npm run build` — clean (esbuild 2.0mb).

## Second pass

Serial coverage check over the same diff — every axis finding
re-checked for disposition, every error path walked (all three
`finalLabels` sources now spec-proven), all `call()` 422 paths
audited after the `conflictOn422` change (the swallow at the mint
site still sees `already-exists`; attach/PATCH see
`invalid-argument`). No new findings; the union of axes covers the
whole change. Converged — no third pass needed.

## Traceability

| Acceptance criterion | Evidence |
|---|---|
| Attach/detach round-trips on a real issue; create-new-name flow | Live verify on #1596 (mint+attach, detach, rename+delete); specs `249-297` |
| `add` containing `5_IMPLEMENT` → `invalid-argument` (server-enforced) | `validateUpdate` stage guard both directions + specs `115-146`, `calls.length===0` |
| Delete returns usage count; 422→`already-exists`, 404→`not-found` | `usageCount` live (1 and 0); `conflictOn422` create-scoped mapping + specs |
| Specs via injected `githubRest` — no network | `fxRest` transport; 22-spec file, zero fetch mocking |

## Deploy gate (M1) — carry-forward

- `updateIssueLabels` + `manageRepoLabel` export live after this
  ship; both declare `secrets: ['GITHUB_WRITE_TOKEN']`.
- `#1526` (user action: mint `GITHUB_WRITE_TOKEN` in Secret Manager)
  must complete before the next `firebase deploy --only functions`.
- Alternative: withhold the two export lines at ship (same slice
  discipline as #1528's `listRepoLabels`-only commit) and land them
  with #1526. Decision belongs to the ship step.
