**Topic:** Options Backtest  
**Topic Slug:** options-backtest  
**Thread:** Multi-leg Templates  
**Thread Slug:** multi-leg-templates  
**Issue:** #1587  
**Thread Parent:** #1270  
**Topic Parent:** #1238  
**Task:** #1494  
**Domain:** MULTI-LEG-SPREAD  
**Type:** UAT  
**Status:** Complete  
**Created:** 2026-11-17  
**Last Updated:** 2026-11-17  

# UAT — #1494 SHARED Task: Registry validator (QA #1587)

## Surface

`validateVariantRegistry()` in `shared/options-replay-templates.ts` — a
pure function returning `string[]` violation messages (empty = clean).
Called with no args it validates the shipped `REPLAY_TEMPLATE_SHAPES` +
`REPLAY_VARIANTS`; injected registries are the test seam. The #1492
prod audit `functions/scripts/verify/options-replay-template-registries-1492.ts`
now delegates its field/grid/id checks to it. No UI surface — every
check below is a CLI command.

## Results log

| # | Scenario | Result | Evidence |
|---|---|---|---|
| S1 | Spec suite — validator block + drift tripwire | PASS | `npx jest shared/options-replay-templates.spec.ts` — **51/51** (92/92 incl. contracts spec) |
| S2 | Clean real registry returns `[]` | PASS | `validateVariantRegistry()` → `[]` (18 shapes, 4 variants) |
| S3 | Every violation class fires with a named, actionable message | PASS | verbatim output below — dup id indexed, missing name, structure typo, off-grid Δ (with "rounds to"), off-menu dte, invalid side, unknown kind, dup leg naming prior index |
| S4 | Verify script delegates + audits prod clean | PASS | `npx tsx scripts/verify/options-replay-template-registries-1492.ts` → `AUDIT PASS` (18 shapes, 4 variants, 6 run docs, 0 FAIL / 0 WARN) |
| S5 | Consumer compile | PASS | `cd functions && npx tsc --noEmit` — clean |
| S6 | Legal-but-unusual shapes pinned | PASS | stock-only variant → `[]`; same-coordinate legs w/ different sides → `[]`; `targetDelta: -0.249` → `[]` (rounds to the 25Δ cell, same as the wire derivation) |
| S7 | Sibling specs unaffected | PASS | `options-replay-contracts.spec.ts` + `options-analysis-registry.spec.ts` — **104/104** total |

## S3 — violation-class evidence (verbatim)

Command (from `functions/`):

```
npx tsx ../.devin/tmp/qa-1494-violations.ts
```

The script injects one variant carrying every violation class — id
`csp-30-30` (collides with the real shipped variant), empty `name`,
`structure: 'short-putt'` (typo of real shape `short-put`), two identical
`-0.22Δ / 40dte` put legs (off-grid + duplicated), a stock leg with
`side: 'sideways'`, and a `kind: 'future'` leg — alongside the real
`REPLAY_VARIANTS`. Actual output:

```
=== clean real registry ===
[]
=== real variants + injected bad variant ===
duplicate id 'csp-30-30' (variant[1] + variant[4])
variant 'csp-30-30': missing/empty name
variant 'csp-30-30': structure 'short-putt' resolves to no shape
variant 'csp-30-30' leg 0: targetDelta -0.22 is off-grid (rounds to 22; |Δ| must be a 5-step multiple in [5, 95])
variant 'csp-30-30' leg 0: dte 40 is not on the pick-grid menu
variant 'csp-30-30' leg 1: targetDelta -0.22 is off-grid (rounds to 22; |Δ| must be a 5-step multiple in [5, 95])
variant 'csp-30-30' leg 1: dte 40 is not on the pick-grid menu
variant 'csp-30-30' leg 2: invalid side sideways
variant 'csp-30-30' leg 3: unknown kind future
variant 'csp-30-30' leg 1: duplicate of leg 0
```

Classes not exercised by the fixture but pinned by spec: missing/empty id
(`variant[0] has a missing/empty id`), ≥1 leg (`must declare ≥1 leg`),
non-finite Δ (`missing/invalid targetDelta`), stock leg carrying option
fields, shape-leg violations (`deltaBand` off-grid/inverted/wrong length,
`dteBand` empty/off-menu/duplicates, concrete `targetDelta`/`dte`,
missing `role`), shape structure not a `TemplateStructure` member,
non-array registry args (`shapes argument is not an array`), and the
crash-guards (null leg, malformed entry — collect, never throw).

## Refinement pass

N/A — shared contracts + verify script, no UI surface.

## Findings

None — zero QA-found defects. Review remediations (delegation, structure
integrity, locator indices, spec dedup collapse) re-verified end-to-end.

## Verdict: **QA PASS** — #1494 ship-eligible.
