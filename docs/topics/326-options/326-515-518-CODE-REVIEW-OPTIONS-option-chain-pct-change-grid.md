**Topic:** Option chain percent change grid  
**Topic Slug:** option-chain-pct-change-grid<br>
**Thread:** Corpus-backed chain data
**Thread Slug:** corpus-chain-data<br>
**Issue:** #515  
**Task:** #518  
**Topic Parent:** #326  
**Domain:** OPTIONS  
**Type:** CODE-REVIEW  
**Status:** Complete  
**Created:** 2026-09-22  
**Last Updated:** 2026-09-22  

---

# Code Review — SA corpus handoff spec (Task #518)

Docs-only task — the deliverable is `326-504-518-SPEC-OPTIONS-sa-corpus-platform-corpus-chain-data.md`. The three axes reduce to doc accuracy vs. the agreed design.

## Standards

- Doc follows the per-topic directory + header conventions; linked from
  Thread #504 and task #518.
- No code, no external SDK calls — nothing to verify against SDK contracts.

## Spec (vs. PRD #505 acceptance criteria)

- PRD "SA contract" items all carried: unchanged endpoint shape, `source`
  field, distinguishable non-enabled-symbol error → `failed-precondition`,
  no-data-vs-transient distinction.
- Thread decisions correctly reflected: fetch-on-miss **rejected** (pivot
  seeding + curated backfill only); `optionable`/`optionsEnabled` two-flag
  model; 4 canonical configs with exact params; ported `deriveParamsId`;
  no st-swing-sets migration (fresh SA generation).
- One wording nit found and fixed during review — "may still serve live
  for gaps" read like fetch-on-miss; clarified to state it explicitly as
  SA's internal choice against the PRD's no-fetch-on-miss assumption.

## Thermo-nuclear

- Scope discipline is the main quality axis for a handoff doc — SA
  internals are specced (the platform work SA owns) while ST stays
  consumer; no accidental ST-side commitments leaked in.

## Test results

Full suite green (1690 tests, 123 suites) — doc-only change, no code paths
affected.

## Findings

- **minor** — fixed in place: live-for-gaps wording (above).

## Verdict: PASS
