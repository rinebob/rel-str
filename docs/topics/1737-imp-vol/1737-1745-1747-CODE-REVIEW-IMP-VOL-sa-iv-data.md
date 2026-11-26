**Topic:** SA IV Data  
**Topic Slug:** sa-iv-data  
**Thread:** IV Metrics Consumer  
**Thread Slug:** iv-metrics-consumer  
**Issue:** #1745  
**Thread Parent:** #1738  
**Topic Parent:** #1737  
**Task:** #1747  
**Domain:** IMP-VOL  
**Type:** CODE-REVIEW  
**Status:** Complete  
**Created:** 2026-11-25  
**Last Updated:** 2026-11-25  

# Code Review — SHARED-IMPL: @iv-metrics/contracts types + alias registration

Scope: `shared/iv-metrics-contracts.ts`, `shared/iv-metrics-contracts.spec.ts`,
and one-line `@iv-metrics/contracts` registrations in `tsconfig.json`,
`functions/tsconfig.json`, `jest.config.js`.

## Pass log

```text
First pass complete — 3 axes: 1 major (echo fields widened to string), 1 hard doc-comment defect (calendar vs trading days), minors (tautological expects, empty-interface aliases, import order, fixture-name overclaim), 1 spec gap (field-name constants) — remediated in-gate
Second pass complete — remediations verified against the diff; residual open items recorded below; no new findings
Convergence: PASS — no remaining critical/major findings
```

## Standards

- **Hard (remediated):** `IvRankWindow` doc comment said "(trading days)" —
  the discovery docs specify **calendar-day** windows
  (iv-metrics-discovery.md "trailing {30,60,180,360}-calendar-day window").
  Fixed: comment now says calendar days and notes 360 cal ≈ ~247 trading days.
- **Judgement (remediated):** `interface GetXRequest extends X {}` empty
  interfaces — no prior art in `shared/`; `type X = Y` is the idiomatic
  form (`@typescript-eslint/no-empty-interface` also warns). Converted to
  type aliases.
- **Nit (remediated):** spec import list placed `Get*` aliases out of
  alphabetical order. Fixed.
- **Judgement (accepted):** the 12 windowed fields are spelled out in
  `IvMetricsRow`, `IvRankRow`, and the `IvRankSortField` union — matches
  the flat-enumeration style of sibling contract files; the
  template-literal unions already drive the names from `IvRankWindow`.
- **Echo optionality (accepted, flagged):** `IvRankResponse.sort/dir/minN`
  and `IvMetricsResponse.metrics` are optional — "present only when
  supplied". The discovery docs call these echoes "the effective
  parameters applied", which may mean always-present including defaults.
  Optional is consumer-safe either way; the BE task's live verify leg can
  confirm actual behavior and tighten the type if the server always echoes.

## Spec

- Every task AC accounted for: typed request/rows/envelopes for both
  endpoints (met, matches IMPL verbatim spec field-for-field); absent-key
  optionality (met — `ivN{W}` optional on `IvMetricsRow`, required on
  `IvRankRow`); three alias registrations (met); companion spec pinning
  contract shapes (met); tsc/jest (see Test results).
- **Gap (remediated):** IMPL/TEST docs said "field-name constants" twice
  but the file exported none (doc self-contradicted — the verbatim type
  spec lists no constants). Added `IV_RANK_WINDOWS` const and pinned its
  contents in the spec.
- **Trivial deviation (accepted):** TEST doc's negative fixture was
  `{symbol: 'AAPL'}` as `IvMetricsRow`; spec uses `{iv30: 0.2}` — a
  cleaner missing-`date` pin since `symbol` isn't a row field.
- Fixture-name overclaim fixed: test renamed from "mirroring the
  discovery-doc QQQ example" (values diverged) to "accepts a
  fully-populated rank row".

## Thermo-nuclear

- **Major (remediated):** echo fields widened to `string` —
  `IvMetricsResponse.metrics?: string[]` → `IvMetricField[]`,
  `IvRankResponse.sort?: string` → `IvRankSortField`,
  `dir?: string` → `IvRankDirection`. The wire-side unions now hold.
- **Minor (remediated):** ~15 lines of tautological `expect(bad).toBe(...)`
  after `@ts-expect-error` — replaced with `void bad;` per the repo
  precedent from review 1238-1488-1493.
- **Nit (accepted):** template-literal unions cost greppability but one
  window list drives 12 names and the spec pins all expansions — kept.
- **Nit (accepted):** `Get*` request aliases ship before their consumers
  (the callables are task #1749 in the same thread) — deliberate per the
  blueprint, not speculative.

## Test results

- `npx jest shared/iv-metrics-contracts.spec.ts` — 22/22 green.
- `cd functions && npx tsc --noEmit` — clean.
- `npx tsc --noEmit` (root) — 15 errors, all pre-existing implicit-any
  issues in `portfolio-dashboard.store.spec.ts` (another session's live
  work); none touch the iv-metrics files.
- Full `npx jest` suite — **343/343 suites, 21,912 tests green.**

## Notes

- Root-tsc noise traces to concurrent-session worktree state, not this
  task's diff. An earlier session-side worktree incident (a foreign
  stash pop) briefly broke the `lifecycle-grouping-removed.spec.ts`
  TOPICS-INVENTORY deletion pin; repaired and the suite is green.

## Verdict

**PASS** — no critical or major findings remaining.
