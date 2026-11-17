**Topic:** Options Backtest  
**Topic Slug:** options-backtest  
**Thread:** Multi-leg Templates  
**Thread Slug:** multi-leg-templates  
**Issue:** #1488  
**Thread Parent:** #1270  
**Topic Parent:** #1238  
**Task:** #1494  
**Domain:** MULTI-LEG-SPREAD  
**Type:** CODE-REVIEW  
**Status:** Complete  
**Created:** 2026-11-17  
**Last Updated:** 2026-11-17  

# Code Review — #1494 SHARED Task: Registry validator

## Scope

`git diff` (uncommitted working tree at review time):

- `shared/options-replay-templates.ts` — `validateVariantRegistry()` +
  private helpers, `TemplateStructure` re-derived from a runtime member
  list, header doc.
- `shared/options-replay-templates.spec.ts` — validator describe block
  (~20 cases); 9 pre-#1494 hand-rolled data-check tests collapsed (the
  validator's `toEqual([])` is now the single canonical data guard).
- `functions/scripts/verify/options-replay-template-registries-1492.ts`
  — Leg-1 field/grid/id checks delegated to `validateVariantRegistry()`
  (~120 lines of hand-rolled validation deleted); header doc updated.

## Test results

- `npx jest shared/options-replay-templates.spec.ts
  shared/options-replay-contracts.spec.ts` — **92/92 PASS**.
- `cd functions && npx tsc --noEmit` — clean.
- `npx tsx scripts/verify/options-replay-template-registries-1492.ts`
  (live prod audit) — **AUDIT PASS**: 18 shapes, 4 variants, 6 run docs,
  0 FAIL / 0 WARN after delegation.
- Full suite not run; the known foreign-session failure
  (`shared/paper-trading-contracts.spec.ts`) is unrelated to this diff.

## Axis summaries

### Standards — PASS

Clean of critical/major. `as unknown as Record<string, unknown>` casts
are the established runtime-narrowing idiom for suspect data (matches
`strategy-instance-repository.ts:183`); membership checks, immutability,
spec conventions, and plan-name conformance all verified.

| # | Sev | Finding | Disposition |
|---|---|---|---|
| M1 | minor | File now ~700 lines (>400 "strong smell") | **Deferred, documented** — cohesive with the guarded data; mostly literal data not logic density. Revisit when #1495 lands multi-leg variants. |
| M2 | minor | missing-id violation lacked a locator | **Fixed** — `claimId` carries the registry index (`shape[3]`, `variant[0]`). |
| M3 | minor | several documented branches untested | **Fixed** — sweep cases added (shape-leg concrete fields, empty id, invalid side, both sign directions, non-array args, stray fields). |
| N1–N4 | nit | conflating fixture, misplaced doc, dead casts, stray-field asymmetry | **All fixed**. |

### Spec — PASS

Every task/plan bullet verified implemented: unique ids across
shapes+variants, |Δ| 5-step in [5,95] + dte menu, per-kind
required/forbidden fields, ≥1 leg, dup legs (type+Δ+DTE+side), named
actionable messages, empty-on-clean, drift-fails-the-suite. Sign-vs-type
parity (assigned to this validator by the `OptionLeg` contract note) is
implemented and tested in both directions. Stock-only variant decided
LEGAL and pinned (structural validity, per the "BE doesn't police real
spreads" decision).

| # | Sev | Finding | Disposition |
|---|---|---|---|
| F1 | low | round-then-check lets -0.249 pass | **Pinned deliberately** — `pickDocDeltaPct` derives the wire key by the same `round(|Δ|×100)`, so -0.249 resolves to the 25Δ cell; flagging it would diverge from the grid the pick docs key on. Test + doc added. |
| F2–F4 | low | locator gaps (missing-id index, dup-leg prior index, missing-vs-invalid dte) | **All fixed**. |
| F5 | low | variant legs not checked for shape-domain fields | **Fixed** — symmetric checks both ways. |
| F6–F7 | info | defensive classes / one sign direction untested | **Fixed** via the sweep. |
| F8 | low | missing-fields test used bare `includes('bad')` | **Fixed** — per-class regex pins. |

### Thermo-nuclear — PASS (after remediation)

Crash-vs-collect audit found no throw paths inside the contract; helpers
take `unknown` (honest malformed-data contract). Three majors:

| # | Sev | Finding | Disposition |
|---|---|---|---|
| M1 | major | verify script hand-rolled ~90% of the same rules — two copies already diverging | **Fixed** — Leg-1 delegates to `validateVariantRegistry()`; script keeps zero-evidence guards, round-trip, migration parity, prod audit. Verified live: AUDIT PASS. |
| M2 | major | validator ignored `structure` referential integrity + name/description | **Fixed** — `s.structure` ∈ `TEMPLATE_STRUCTURES` (type now derived from the const — one source of truth); `v.structure` must resolve to a shape id / 'custom' / absent (upgrades the script's WARN → FAIL, matching the spec's FAIL-worthy semantics); name/description non-empty. |
| M3 | major | spec double-audited the shipped registries (4th copy of `round(\|Δ\|×100)`) | **Fixed** — 9 hand-rolled data-check tests deleted; `toEqual([])` is the single drift tripwire. Behavioral tests (derivation, migration parity, accessors, constants pin) retained. |
| m1 | minor | `deltaMagnitude` duplicates `pickDocDeltaPct` (functions/) | **Deferred** — consolidating needs a cross-package move; noted for the shared-helper follow-up. |
| m2–m6 | minor | round-vs-strict, unpinned branches, stray fields, `unknown` params, id-less locator | **All fixed/pinned**. |
| n1–n4 | nit | non-array params, naming, role trim, default-arg subtlety | n1 fixed; n2 kept (plan-prescribed name); n3/n4 skipped (cosmetic). |

## Second pass (serial coverage check)

After the fixes above: re-verified the fix surface compiles (tsc clean),
spec 92/92, the delegated audit passes live. Checked the new code's own
edge paths — `shapeIds` snapshot taken after the shapes loop (a variant
can't self-resolve as a shape), `displayFields` locates by id not name,
`Array.isArray` narrowing restored via annotations, `TEMPLATE_STRUCTURES`
derivation keeps the exported type identical for existing consumers.
One new surface bug was caught mid-fix (stray-field check initially
nested inside the valid-targetDelta branch — moved to the option branch
proper). Converged — no third pass needed.

## Findings ledger

- **Critical:** none. **Major:** 3 (thermo M1–M3) — all remediated and
  re-verified. **Minor:** 12 — 10 fixed, 2 deferred (file size;
  `pickDocDeltaPct` consolidation). **Nit:** 8 — 5 fixed, 3 skipped.

## Verdict: **PASS**

Next: `/proj qa 1238 1494`.
