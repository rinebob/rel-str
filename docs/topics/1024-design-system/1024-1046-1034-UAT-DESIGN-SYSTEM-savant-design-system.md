**Topic:** Savant Design System  
**Topic Slug:** savant-design-system  
**Thread:** Design System Foundation  
**Thread Slug:** ds-foundation  
**Issue:** #1046  
**Thread Parent:** #1025  
**Topic Parent:** #1024  
**Task:** #1034  
**Domain:** DESIGN-SYSTEM  
**Type:** UAT  
**Status:** Complete  
**Created:** 2026-10-15  
**Last Updated:** 2026-10-15  

# UAT — #1034: savant-ds repo + package skeleton

## Scope

Acceptance criteria from Task #1034 (SHARED blueprint, Phase #1032):

- AC1 — `C:\aa\projects\savant-ds` is a git repo with package.json,
  .gitignore, README
- AC2 — `styles/` and `scripts/` directories exist (with real content)
- AC3 — README documents the `file:../savant-ds` install +
  `stylePreprocessorOptions.includePaths` consumption path for both apps
- AC4 — the skeleton is actually consumable: `npm install` of the `file:`
  dependency links the package into a consumer's `node_modules`

## Prerequisites

- Repo `C:\aa\projects\rel-str` checked out (any branch; verification is
  cwd-independent — the script anchors to its own location)
- Node.js + npm on PATH
- No credentials, no Firebase, no dev server needed
- The sibling package lives at `C:\aa\projects\savant-ds` (one level up
  from the repo root). On a machine without that checkout, `run-all.ts`
  reports this script as SKIPPED via `needsPath` — that is the intended
  behavior, not a failure.

## Scenarios

### S1 — Package skeleton exists and is a repo

1. `ls C:\aa\projects\savant-ds` — expect `package.json`, `README.md`,
   `.gitignore`, `styles/`, `scripts/`, `package-lock.json`, `.git/`
2. `cd C:\aa\projects\savant-ds && git rev-parse --is-inside-work-tree` —
   expect `true`
3. `cat package.json` — expect `"name": "savant-ds"`, `"version":
   "0.1.0"`, `"private": true`, `scripts.verify` → `node
   scripts/verify.mjs`, `devDependencies.sass`

**Expected:** all files present, git repo, metadata correct.  
**Result:** PASS — verified by `design-system-package-1034.ts` checks
1–9 (all OK).

### S2 — `file:` dependency resolves and links into a consumer

Run the task verification script:

```bash
npx tsx scripts/verify/design-system-package-1034.ts
```

It performs: `npm install --dry-run savant-ds@file:../savant-ds` from the
repo root (the exact specifier ST/SA will declare), then a REAL
`npm install` in a scratch consumer at `.devin/tmp/ds-consumer-1034`,
then asserts `node_modules/savant-ds` exists and is a junction/link with
a readable `package.json` inside.

**Expected:** `=== ALL CHECKS PASSED ===`, exit 0.  
**Result:** PASS — 14/14 checks, `installed entry is a link/junction —
junction`.

### S3 — Package's own verify runs

```bash
cd C:\aa\projects\savant-ds && npm run verify
```

**Expected:** stub checks pass — `styles/_index.scss exists`,
`styles/ is populated`, `no @import directive in styles/` — then `All
checks passed. (stub — full mixin/token surface lands in #1038)`.  
**Result:** PASS.

### S4 — README consumption contract is documented and honest

Read `C:\aa\projects\savant-ds\README.md`. Confirm it contains: the
`"savant-ds": "file:../savant-ds"` dependency snippet, the
`stylePreprocessorOptions.includePaths` snippet, the junction warning
("edit this repo, not node_modules"), single-emission rule for tokens in
`src/styles.scss`, and explicit "lands in #1035–#1038" scaffold notes so
a consumer isn't pointed at files that don't exist yet.

**Expected:** all documented; scaffold status disclosed.  
**Result:** PASS.

### S5 — Run-all integration skips cleanly without the sibling

On a checkout where `../savant-ds` does not exist,
`npx tsx scripts/verify/run-all.ts` reports `design-system package
skeleton — SKIPPED (needs ../savant-ds checkout)` rather than FAIL.

**Expected:** SKIPPED line, not a failure.  
**Result:** PASS by construction — `needsPath` gate added to
`VerifyScript` in this task's review remediation; verified the SKIP
branch compiles (`tsc --noEmit` clean). Not executed against a missing
sibling on this machine.

## Refinement pass

Not applicable — no user-facing surface (package skeleton + offline
verification tooling only).

## Traceability

| Criterion | Scenario |
|---|---|
| AC1 git repo + package.json + .gitignore + README | S1 |
| AC2 styles/ + scripts/ dirs exist | S1, S3 |
| AC3 README consumption docs for both apps | S4 |
| AC4 `file:` install links into node_modules | S2 |
| Scripts registered in run-all + README index | S5 + `scripts/verify/README.md` row |

## Regression / smoke

- `npx tsc --noEmit` on `scripts/verify/run-all.ts` +
  `design-system-package-1034.ts`: clean
- Full jest suite unaffected — task touched zero app code (baseline
  failures unchanged)

## Results log

- 2026-10-15 — S1–S5 PASS. QA evidence: verify script output above;
  README scaffold markers confirmed post-review-remediation.
