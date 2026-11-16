**Topic:** Options Backtest  
**Topic Slug:** options-backtest  
**Thread:** Multi-leg Templates  
**Thread Slug:** multi-leg-templates  
**Issue:** #1488  
**Thread Parent:** #1270  
**Topic Parent:** #1238  
**Task:** #1492  
**Domain:** MULTI-LEG-SPREAD  
**Type:** CODE-REVIEW  
**Status:** Complete  
**Created:** 2026-11-15  
**Last Updated:** 2026-11-15  

# Code Review — SHARED Task: Template-shape + named-variant registries (#1492)

Deliverable: the two-registry model in `shared/options-replay-templates.ts` — `REPLAY_TEMPLATE_SHAPES` (18 generic shapes with delta/DTE bands across all six catalog families) and `REPLAY_VARIANTS` (the four legacy templates migrated verbatim as 1-leg variants) — plus `PICK_GRID_*` grid constants, `getReplayVariant`/`getTemplateShape` accessors, and the derived `REPLAY_TEMPLATES`/`getReplayTemplate` legacy read surface.

## Standards

Blocking items fixed in-code before this verdict.

- **Fixed (major)** — `TemplateShapeLeg` was a bag-of-optionals (`type?`/`deltaBand?`/`dteBand?`) where illegal states (`{kind:'option'}` without bands, `{kind:'stock', type:PUT}`) typechecked. Both sibling models — `VariantLeg` (#1491) and `ManageTemplateLeg` — use discriminated unions; `TemplateShapeLeg` is now `TemplateShapeOptionLeg | TemplateShapeStockLeg` with bands required on the option arm and unrepresentable on the stock arm. Runtime `in`-checks remain in spec/audit for literals that bypass authoring.
- **Fixed** — spec covered bands/membership but not the defining "bands, not values" semantic, variant-leg on-grid/sign-parity, role/dteBand/display-field sanity, or the `PICK_GRID_*` literals themselves (circular validation hole). Five new spec blocks pin all of them; the legacy-parity expectation now includes name + description verbatim.
- **Fixed** — the verify audit claimed verbatim `description` parity in its docblock but never asserted it; `LEGACY` now carries `description` and checks it. `PASS registry structure` no longer prints under recorded FAILs. A mistyped `--run` id now reports "matched no run doc" instead of "collection empty".
- **Fixed** — stale comment pointer: `OptionLeg.targetDelta` doc attributed the registry validator to #1492; corrected to #1494. Grid constants moved under a dedicated `// Pick-doc grid` section header. `TemplateShape.legs`/`ReplayVariant.legs` are `readonly` — the curated arrays can't be mutated by importers.
- **Fixed** — misleading spec fixture: `options-replay-contracts.spec.ts` used `structure: 'vertical-credit'` (a `TemplateStructure` vocabulary value) where the field holds a shape *id* — corrected to `'put-credit-spread'` so the fixture doesn't teach the wrong semantic.
- **Fixed** — `'custom'` in `TemplateStructure` documented as the escape hatch (no seeded shape uses it), and the `deltaBand` JSDoc now records the deliberate magnitude-vs-signed divergence from the manage domain's `deltaMin`/`deltaMax` (copy across registries = silently wrong by sign ×100).

### Advisory (non-blocking)

- Credit-spread bands overlap at exactly 15Δ (`[15,35]` short / `[5,15]` long) — catalog-authored values; a 15/15 pin yields a degenerate zero-width spread but bands are authoring guidance, not validation. Flagged, not changed.
- `templates.ts` is ~400 lines — at the size-guideline boundary; #1495's catalog variants will push past it. Splitting then is cheap.
- `manage-variant-contracts.ts` carries a stale "TemplateShapeLeg hasn't landed yet" convergence note — foreign-session file; documented divergence on our side (deltaBand JSDoc), the stale note is theirs to update.
- `coordEqual` is now duplicated across the #1491/#1492 audit scripts — acceptable for audit tooling; consolidate if a third script copies it.

## Spec

All four acceptance criteria MET, verified against the IMPL plan (modules 2+3), TEST plan, and the catalog doc row-by-row:

- Seed shapes cover the catalog families — **MET**: 18/18 shapes match the catalog exactly (singles ×4, verticals ×4, condors ×2, calendar/diagonals ×4, volatility ×3, hybrid ×1); every leg's side, delta band, and DTE subset verified by hand against the catalog tables.
- All four legacy ids resolve via `getReplayVariant` — **MET**: legs reproduce the legacy coordinate/side verbatim; `git show` confirmed descriptions unchanged.
- Bands bound FE controls; BE validates concrete legs only — **MET**: shapes carry bands-only data (spec pins `'targetDelta' in leg === false`); no server-side band validation exists anywhere, per the plan's authoring-guidance decision.
- Spec covers accessors + migration parity — **MET**: hit/miss/round-trip on all three accessors; parity pinned at leg-coordinate, side, name, and description level.

One INFO note: `REPLAY_TEMPLATES` is *derived* from `REPLAY_VARIANTS` rather than `getReplayTemplate` delegating per-call — semantically equivalent, preserves the array the v1 picker binds to.

## Thermo-nuclear

Three majors; all fixed in-code.

- **Fixed (M1)** — the union refactor above.
- **Fixed (M2)** — variant legs had no generic on-grid/sign-parity check; a malformed future entry (`dte: 32`, `put` with `+0.2`) would pass every gate. The spec now pins per-variant-leg grid membership + sign-vs-type parity — registry-data validation, distinct from #1494's validator function which handles cross-leg invariants.
- **Fixed (M3)** — `resolveTemplate: getReplayTemplate` in `permutation.ts` is a documented-deferral landmine for #1498 (multi-leg runs have no `ReplayTemplate` form). Marker comment added at the wiring site. **#1498 note:** both audits' Leg-3 assertions (`verify-1491` + `verify-1492`, every prod run's templateId resolves via `getReplayTemplate`) encode an invariant that goes false the day a multi-leg run exists — revisit them there.

Deferred with rationale:

- Cross-leg invariants (short-|Δ| > long-|Δ| ordering, near < far expiry, `structure` ↔ leg-inventory consistency) — #1494 validator scope; recorded so it isn't lost.
- `ReplayVariant.structure` vs `TemplateShape.structure` same-name/different-domain (shape id vs vocabulary value) — renaming to `shapeId` kills the ambiguity; #1498 surface, field predates this task.
- Adding grid cells leaves band subsets silently stale — editorial; the shrink direction is already tripwired.
- A shape tagged `structure:'custom'` typechecks — semantic oddity, unpinned, deferred to the validator.

## Pass 2 — re-review of the pass-1 fix state

All three axes re-run on the post-fix code. Spec came back clean PASS (18/18 shapes re-verified against the catalog after the union refactor — zero drift). Standards + Thermo-nuclear found defects the pass-1 fixes left behind:

- **Fixed (major)** — the audit's `PASS` gating was incomplete in two places: `structureFindingsBefore` was captured *after* the registry-level fails (empty registries / duplicate ids still printed `PASS registry structure`), and the per-id `PASS ${id}` in the parity leg printed unconditionally under same-id FAILs. Both are now gated on the findings delta.
- **Fixed (major)** — the spec's parity test iterated `REPLAY_VARIANTS` → expected-map, which crashes opaquely (`undefined.name`) the moment #1495 adds the first non-legacy variant. Reversed to iterate `Object.entries(expected)` → resolve by id, matching the audit's direction.
- **Fixed** — audit reached spec-parity on the invariants the spec added in pass 1: every variant leg (not just the pinned four) now gets the on-grid/sign-parity check; shape legs are checked for smuggled concrete `targetDelta`/`dte`; the `kind` discriminant itself is validated (`else if 'stock' / else fail` — a mistyped literal no longer satisfies the stock branch vacuously); `deltaBand` arity, `dteBand` non-empty/no-duplicates, and `side`/`type` enum membership are pinned on both surfaces.
- **Fixed** — `structure` resolution and variant display fields were unpinned anywhere: spec now FAILs on a variant `structure` that resolves to no shape (curated data → data bug) and requires name/description on every variant.
- **Fixed** — `VariantSnapshot.legs` and `OptionsReplayStartLegsRequest.legs` were mutable while `ReplayVariant.legs` went readonly — a compile trap pre-loaded for #1498's `legs: variant.legs` stamp. Both are readonly now.
- **Fixed** — shallow readonly: leg *fields* were still mutable. The registries are `Object.freeze`d at module load (legs arrays, leg objects, band arrays) — the docblock's "importer can't mutate the curated array" is now runtime-true, not just compile-time.
- **Fixed** — `--run` with no value silently audited the whole collection; now a usage FAIL. Stale `:186` line-pointer corrected. The IMPL doc §2 code block was re-synced to the shipped union (+readonly).
- **Deferred** — variant↔shape positional conformance (a `structure:'put-credit-spread'` with wrong leg inventory) and near/far DTE disjointness on calendar shapes — #1494 validator scope, same class as pass-1 deferrals.

## Test results

- Shared specs: `options-replay-templates.spec.ts` **23/23** + `options-replay-contracts.spec.ts` **29/29** = 52/52
- options-replay node suite: **93/93** · full jest: **313 suites / 5,664 tests — all pass** (post-pass-2 state)
- app + spec + functions tsc: clean in-scope (foreign session files carry pre-existing errors, untouched)
- Prod audit `options-replay-template-registries-1492.ts`: **AUDIT PASS** — 18 shapes on-grid, 4 variants verbatim (incl. description), 6/6 prod run docs resolve via both surfaces, 0 FAIL / 0 WARN
- Re-pinned probes re-verified: `…-1276` **ALL CHECKS PASSED** (stale 2-id seed expectation → all 4), `…-1491` **AUDIT PASS**

## Verdict: **PASS** (two passes)

Pass 1's majors (bag-of-optionals vs discriminated union) were fixed with the codebase's own pattern; pass 2 caught the holes those fixes left — and every fix across both passes is pinned by a dedicated spec assertion or audit check.
