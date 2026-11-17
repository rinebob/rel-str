**Topic:** Options Backtest  
**Topic Slug:** options-backtest  
**Thread:** Multi-leg Templates  
**Thread Slug:** multi-leg-templates  
**Issue:** #1488  
**Thread Parent:** #1270  
**Topic Parent:** #1238  
**Task:** #1495  
**Domain:** MULTI-LEG-SPREAD  
**Type:** CODE-REVIEW  
**Status:** Complete  
**Created:** 2026-11-17  
**Last Updated:** 2026-11-17  

# CODE REVIEW — #1495 SHARED Task: Seed named variants from catalog

## Scope

`shared/options-replay-templates.ts` (+180): `REPLAY_VARIANTS` seeded from
4 legacy migrations to 21 curated entries — one per base template plus the
catalog's four example points verbatim. Registry header rewritten; runtime
freeze deepened (see Remediation).  
`shared/options-replay-templates.spec.ts` (+76): curated-set pins — legacy-
first ordering, one-variant-per-shape coverage, inside-bands containment
(position-matched), catalog examples verbatim.  
`scripts/verify/options-backtest-selection-replay-1276-registry-collections.ts`
(±3): stale exact-4-id pin replaced with a legacy-first `slice(0,4)` smoke
(thermo M1).  
`docs/topics/1238-backtest/1238-1270-1485-IMPL-MULTI-LEG-SPREAD-SHARED-…md`:
§3 as-built note.

## Axes — three in parallel

| Axis | Verdict | Findings |
|---|---|---|
| Standards | PASS | 2 MINOR (missing `@task #1495` tag, stale "verbatim" in `REPLAY_TEMPLATES` JSDoc) + 5 NITs — all remediated in-cycle |
| Spec | PASS | Exhaustive arithmetic audit — all 18 shapes covered, all 4 catalog examples verbatim, every leg inside its position-matched band, sign parity, no dup legs, all on-grid. 3 NITs (cross-family DTE-ordering cosmetics, abbreviation clarity) — no changes |
| Thermo | CHANGES REQUESTED → PASS | M1 (registered verify script hard-pins 4 ids → would go red), N1 (freeze shallower than comment claims), N2 (confirm-intent: naked LEAP/short-call reach the v1 picker), 4 tripwire NITs |

## What pass-1 found and got fixed

- **M1 — `…-1276-registry-collections.ts:46` hard-pinned the 4-id surface**
  in a registered verify script (`run-all` sweep, `needsAccount: false`).
  Landing this change red-lit the sweep. The script's own docstring says
  registry hygiene is not its job — the pin was a stale tripwire. Fixed:
  `REPLAY_TEMPLATES.slice(0,4)` — the spec now pins legacy-first ordering,
  so the smoke survives future single-leg seeds.
- **N1 — freeze gap closed while the file was open.** Entry objects and
  the registry arrays themselves were unfrozen (legs/legs-entries were).
  Added `Object.freeze(s)`/`Object.freeze(v)` in the existing loops +
  freezes on `REPLAY_TEMPLATE_SHAPES`/`REPLAY_VARIANTS`. `REPLAY_TEMPLATES`
  is a fresh derived array per import — freeze skipped deliberately
  (callers may sort it for pickers; it isn't a curated source).
- **T1/T2 — band-containment spec sharpened.** "validator gap" mislabeled
  a legal-validator state (`structure: 'custom'`); message now names the
  curated-set rule. `toHaveLength` doesn't abort iteration — a mismatched
  variant would TypeError past the end; now throws a clean named error.
- **Standards minors** — `@task #1495` tag added; `REPLAY_TEMPLATES` JSDoc
  now says new single-leg variants join the surface automatically;
  describe relabeled `#1492/#1495`; `180/21DTE` → `180→21DTE` for glyph
  consistency with `30→60DTE`; stray blank line removed; "one per base
  template" comment tightened (legacy entries count).
- **T4 — id grammar documented on the registry header:**
  positional `{abbr}-{dte(s)}-{delta(s)}` in leg order.

## Confirm-intent items (thermo N2) — resolved, no code change

- **`sc-45-20` + `sng-45-20` are naked sells** — the shapes themselves are
  flagged "naked; deferred live-blocking". `REPLAY_VARIANTS` feeds the
  *backtest* replay picker only (`options-replay-new-run-dialog`); nothing
  routes these to live orders, so the deferred gate is not bypassed. Both
  descriptions carry the caveat verbatim.
- **`lc-365-75` is a LEAP point** — mandated verbatim by the catalog's
  example row. Pick docs are SA year-shards; a missing 365 cell yields a
  loud `NOT_FOUND` at fetch (never silent). If SA hasn't materialized 365-
  DTE cells for a symbol, runs on `lc-365-75` fail named per leg — the
  grid menu includes 365 by design.

## Tripwires left in place (deliberate)

- Band-containment is position-matched (`variant.legs[i] ↔ shape.legs[i]`);
  every current shape's slots discriminate kind/side/type, so a permuted
  variant fails loudly. A future shape with two interchangeable slots could
  admit a silent permutation — the spec comment flags the assumption.
- `lc-365-75`, `lp-45-30`, `sc-45-20` are single-option-leg variants → they
  join `REPLAY_TEMPLATES` automatically (7 total). Intended; JSDoc +
  migration-parity comments updated.

## Evidence

- `npx jest shared/options-replay --runInBand` — **95/95 pass**
- `cd functions && npx tsc --noEmit` — clean
- `npx tsx functions/scripts/verify/options-replay-template-registries-1492.ts`
  — **AUDIT PASS: 18 shapes, 21 variants, 6 run docs, 0 FAIL/0 WARN**
- `npx tsx scripts/verify/options-backtest-selection-replay-1276-registry-collections.ts`
  — **ALL CHECKS PASSED** (was red on the stale 4-id pin; now resilient)
- `validateVariantRegistry()` over the real registries → `[]` (spec-pinned)

## Verdict

**PASS** — pure data seeding with one real cross-file find (the stale
verify pin) remediated in-cycle. Every acceptance criterion met: 18/18
shape coverage, `validateVariantRegistry()` clean, display-stable names.
