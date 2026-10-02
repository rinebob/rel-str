**Topic:** Navigation and Workflows  
**Topic Slug:** trading-workflows  
**Thread:** Workflow Foundation  
**Thread Slug:** foundation  
**Issue:** #646  
**Thread Parent:** #626  
**Topic Parent:** #625  
**Task:** #647  
**Domain:** WORKFLOWS  
**Type:** Code Review  
**Status:** Complete  
**Created:** 2026-09-28  
**Last Updated:** 2026-09-28  

# Code Review — #647 Workflow template + conventions doc

**Verdict: PASS** (round 2 — all round-1 findings fixed and re-verified)

Scope: `625-646-647-CONVENTIONS-workflows-trading-workflows.md`, `scripts/verify/workflows-template-647.ts` + `.md`, `run-all.ts`/`README.md` registrations, `CONTEXT.md` glossary additions. Docs-only task — three review axes run in parallel sub-agents; full jest suite green (153 suites / 2089 tests).

## Standards axis

Round-1 findings — all fixed:

- **Major:** `Issue:` header field was `#647` (the task) — corrected to `#646` (the Blueprint stage issue) per REFERENCE.md doc-header rules.
- **Major:** template skeleton's `**Field:**` lines lacked the mandated trailing two-space markdown breaks — every generated workflow doc would have rendered header fields concatenated on GitHub. Fixed; breaks added.
- **Minor:** dead regex alternative `` ``none`` `` in the Feeds check — removed (simplified to a direct `includes`).
- **Minor:** destination heuristic passed any step containing `—` — tightened (time estimate stripped first, then ` — destination` or `(manual)` required).

Clean: header block format, script conventions vs. prior art (`dev-tools-lifecycle-contracts-637.ts`), naming/registration, CONTEXT.md term style, no secrets.

## Spec axis

Every task-#647 acceptance criterion met with evidence; all PRD user-story ACs belonging to this task verified (US1/3/4/6/7/8/10 template+conventions halves; US2/5/9 correctly deferred to #648/#649). IMPL-required contents all present; TEST conformance rules encoded in doc + script.

Round-1 gaps — all fixed:

- **Minor:** verify docstring overstated "non-empty sections" — now actually enforced.
- **Minor:** step-destination heuristic under-enforced — same fix as Standards.

## Thermo-nuclear axis

Round-1 findings — all fixed:

- **Major:** filename convention `625-{stage-issue-#}-WORKFLOW-…` contradicted the real `{topic}-{stage}-{task}` pattern (the doc's own filename and all siblings had two issue slots). Corrected to `625-{stage-issue-#}-{task-#}-WORKFLOW-workflows-{workflow-slug}.md`; PRD + IMPL patterns updated to match.
- **Major:** `- [ ]`-only checkbox check penalized docs used exactly as designed (doc-as-script allows ticking) and scanned the whole doc — now scoped to `## Steps`, accepts `[ ]` and `[x]`.
- **Minor:** `## Steps` block slicing was fence/heading-fragile — fenced code blocks now stripped, exact `## Steps` heading match, sections must be non-empty.
- **Minor:** CONTEXT.md "Workflow Handoff" wording drifted (exit criteria name *what*, `Feeds:` names *whom*) — corrected.
- **Nit:** duplicated `check()` helper across verify scripts — accepted as correct (trivial, local).
- **Nit:** hardcoded paths in the checker — accepted as correct by design (rots loudly).

## Test results

- `npx jest --coverage=false` — **153 suites / 2089 tests, all pass.**
- `npx tsx scripts/verify/workflows-template-647.ts` — **14/14 PASS** (conventions mode).
- Conformance mode exercised against fixtures: conformant doc (mixed `[ ]`/`[x]`, `(manual)` steps) → all pass; non-conformant doc (missing destination, empty sections) → 3 targeted FAILs.

## Advisory notes

- Task #649 should run `workflows-template-647.ts <pilot-path>` as part of its verification.
