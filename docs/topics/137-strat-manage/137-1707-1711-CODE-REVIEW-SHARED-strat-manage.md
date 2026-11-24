**Topic:** Strategy Manager  
**Topic Slug:** strat-manage  
**Thread:** Live Position Lifecycle  
**Thread Slug:** live-position-lifecycle  
**Issue:** #1707  
**Thread Parent:** #1690  
**Topic Parent:** #137  
**Task:** #1711  
**Domain:** SHARED  
**Type:** CODE-REVIEW  
**Status:** Complete  
**Created:** 2026-11-24  
**Last Updated:** 2026-11-24  

# CODE-REVIEW: SHARED canonical variant identity (#1711)

## Verdict

**PASS** — three axes run; all critical/major findings fixed in-gate and spec-pinned.

Pass sequence:

```text
First pass complete — Standards clean (file-size smell → module split in-gate); Spec: 5 findings (id-path shape gap, unvalidated variant.dte, string-coerced delta, generator 0-encode hole, leading zeros); Thermo: 3 majors converging on the same gaps + minors (direction gate, null input, missing specs)
Second pass complete — every finding verified fixed + spec-pinned (62/62 spec, 33/33 verify, full suite green); axes' coverage union checked — no unreviewed surface
Convergence: PASS — contract is small and pure; all findings in-gate; one documented deferral (suggestedName → #1717)
```

## Scope reviewed

- `shared/manage-instance-id.ts` — added `parseManageInstanceId` (strict typed-segment inverse of `generateManageInstanceId`), hardened `dlegsPiece` (sub-0.5% deltas now throw at mint instead of minting an unparseable `'0'` segment)
- `shared/manage-variant-display.ts` (new) — `variantDisplayName`, the single display-name generator; extracted from the id module when the file crossed the 400-line guideline
- `shared/manage-instance-id.spec.ts` — 30 new specs across parse, encodability, display-name, and honest-failure gates
- `scripts/verify/strat-manage-variant-identity-1711.ts` + `.md` — 33-check no-credentials verify (offender-reporting catalog loops), `run-all.ts` + `README.md` registration
- `tsconfig.json` / `jest.config.js` — `@manage/variant-display` alias
- IMPL-SHARED doc typo fix (`'30-50 40'` → `'30 50-40'` pinned example); IMPL-FE doc `suggestedName` adoption-site note

## Standards axis

No violations. Judgement calls recorded:

- **File size** — the initial single-module implementation reached 473 lines (guideline smell at 400). Resolved in-gate: `variantDisplayName` extracted to `manage-variant-display.ts` (94 lines); `manage-instance-id.ts` stays 395 lines as the grammar's generate/parse pair. Placement rationale is documented in both file headers (catalog would close an import cycle).
- **Smell baseline** — no duplicated code (parse reuses `assertSegment` + centralizes numeric-piece validation in `parseNumericSegment`), no mysterious names, no speculative generality. `(number | 'STK')[]` is a fair union for the ΔLEGS contract.
- **Conventions** — spec style matches the file's existing patterns (real enum values, `it.each` matrices, no type-erased fixtures except one deliberate `as unknown as number` simulating wire data, documented inline). Verify script mirrors `strat-manage-instance-id-1542.ts` conventions exactly.

## Spec axis

All task ACs met; contract lines from IMPL-SHARED/TEST-SHARED verified against code.

- `variantDisplayName(idOrVariant)` — met; `'SPY-CDS-30-50-40-ALL'` → `'call debit spread 30 50-40'` spec-pinned.
- Round-trips, honest malformed failure, no-duplicate-names, catalog contract — met (whole-catalog loops in both spec and verify script).
- AC 1 "one display-name generator" — met as contract with a **documented deferral**: `manage-create-strategy.component.ts` `suggestedName` still privately re-implements the formula; rebinding it is an FE adoption task (#1717) — flagged via issue comment + IMPL-FE doc line (the naive rebind would cycle through `name()`'s suggestion effect).
- IMPL-SHARED's own pinned example had a third wrong format (`'30-50 40'`) — corrected in the same diff, noted here for transparency.

## Thermo-nuclear axis

Three majors, all fixed in-gate:

1. **Parse accepted ΔLEGS shapes the generator can't emit for known spreads** — arity (`QQQ-CDS-30-50-ALL`) and per-slot kind (`QQQ-CDS-30-STK-40-ALL`) violations now throw; `CUSTOM` correctly skips shape checks.
2. **Generate→parse round-trip broke on sub-0.5Δ legs** — `Math.round(0.004*100)=0` minted a segment parse rejects; `dlegsPiece` now throws at mint. Pre-existing #1542 hole closed.
3. **`variantDisplayName(variant)` trusted `variant.dte` blindly** — non-integer/zero/NaN dtes, diagonal legs, and leg-vs-variant dte mismatches now fall back to the authored name (same uniformity the id grammar demands).

Minors fixed: leading-zero encodings rejected (`'030'`/`'050'`), string-coerced `targetDelta` (`'0.5'`) falls back, credit-ordered legs under a debit template fall back (`variantDirectionHolds` in the gate — 'call debit spread 30 20-50' would lie), `null` input gets a friendly `Error` not a `TypeError`, boundary deltas 1/100 spec'd, spec-file `@task` header added, verify script loops report offenders.

Deferred (accepted, not findings): CUSTOM-id input throws by design — the docstring directs callers to pass `instance.variant` (the only truthful name for a custom instance); flagged on #1717 for the FE binding.

## Test results

- `npx jest shared/manage-instance-id.spec.ts` — 62/62 green
- `npx jest --coverage=false` (full suite) — 337 suites / 6423 tests green
- `npx tsx scripts/verify/strat-manage-variant-identity-1711.ts` — 33/33 OK
- `tsc --noEmit` — 15 pre-existing foreign errors (`scripts/bulk-swing-sweep.ts`, `portfolio-dashboard.store.spec.ts`); none in review scope
