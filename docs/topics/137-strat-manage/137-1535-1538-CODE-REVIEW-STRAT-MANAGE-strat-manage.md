**Topic:** Strategy Builder UI  
**Topic Slug:** strat-manage  
**Thread:** OpsStrat Manage Page Overhaul  
**Thread Slug:** page-overhaul  
**Issue:** #1535  
**Thread Parent:** #1510  
**Topic Parent:** #137  
**Task:** #1538  
**Domain:** STRAT-MANAGE  
**Type:** CODE-REVIEW  
**Status:** Complete  
**Created:** 2026-11-15  
**Last Updated:** 2026-11-15  

# CODE-REVIEW — #1538 SHARED: Manage instance + variant contracts

## Verdict: **PASS** (two passes)

All critical/major findings either fixed in-review or answered with
documented rationale. No remaining blocker.

## Second pass (2026-11-15 — user-requested re-review)

All three axes re-ran on the post-fix code. One **real defect** plus
doc-level items, all fixed:

- **Real bug (all 3 axes converged) — `isValidModeStopType` normalization
  hole:** `'all'`/`' ALL '`/`'All'` passed as valid real stop codes, then
  normalized into `…-ALL` by the ALL-CAPS ID layer — colliding with paper's
  reserved segment. Predicate now compares on `trim().toUpperCase()` form;
  3 new spec cases + 4 new verify checks cover the matrix.
- **"Unique by construction" gap (medium, flagged forward):** the ID
  grammar carries ONE DTE (near leg's) — two variants differing only in
  far-leg expiry (calendars/diagonals) collide on ID. Not an S1 fix — the
  grammar is #1542's spec — flagged in the module header so it can't
  ossify.
- **Fixture stop codes `STOP-200` → `T8`** — hyphenated codes inside a
  hyphen-delimited grammar pre-committed a parse-ambiguous shape; `T8`
  matches the PRD example and the no-hyphen constraint is now documented
  on `StopType`.
- **`templateId` semantics for ad hoc variants** documented (holds the
  composing template's id; `'custom'` for freeform) — it was required-but-
  unspecified.
- **Nits fixed:** `ManageTemplateStockLeg.role` JSDoc asymmetry; `StopType`
  compile-time-illusory note; `variant.dte` derive-or-validate flag for
  #1542.

**Awareness (not this task's defects):** the working tree's CONTEXT.md and
scripts/verify diffs carry unrelated in-flight entries (Section Refresh,
Signal Selection, #1524 retrofit registration) — user edits, keep them out
of the #1538 commit set.

Re-verified after fixes: 14/14 specs, 24/24 verify checks, both tsconfigs
clean, jest moduleNameMapper resolves `@manage/*`.

## Change set

- `shared/manage-instance-contracts.ts` — vocabularies (`InstanceMode`,
  `InstanceTrigger`, `InstanceRunState`, `StopType`), `STOP_TYPE_ALL`,
  `isValidModeStopType`, `MANAGE_ADHOC_VARIANT_REF`, `ManageInstance`
- `shared/manage-variant-contracts.ts` — `ManageTemplate`,
  `ManageTemplateLeg` union, `ManageVariant` + AC-name aliases
- Specs ×2 (13 tests), verify script + guide + README + run-all entry
- `@manage/*` aliases in `tsconfig.json`, `functions/tsconfig.json`,
  `jest.config.js` moduleNameMapper (added in review)
- `CONTEXT.md` — Manage Template / Manage Variant / Manage Instance entries
- IMPL doc §1–2 sketches synced to as-built

## Standards axis

**Fixed in review:**

- **Major** — `jest.config.js` `moduleNameMapper` lacked `@manage/*` twins;
  every tsconfig alias is registered in three places. Added.
- **Minor** — verify-script `filter` didn't narrow to `OptionLeg`
  (`targetDelta` invalid on `StockLeg`; masked by tsx type-stripping).
  Fixed with a type-guard predicate.
- **Minor** — CONTEXT.md overclaim: file headers cited "Vocabulary per
  CONTEXT.md" for nouns that had no glossary entries. Added the three
  entries.

**Answered (no change):**

- Two schemas on `st-strategy-instances` root — deliberate per approved
  IMPL ("reused root, new schema — legacy docs already deleted"). Flagged
  to #1539: the shared reader's malformed-shape warns may see manage docs
  during transition; a `kind` discriminator is their call, premature here.
- `real` vs `live` (`StMode`) vocabulary — PRD decision, documented in the
  type comment.
- Latent `ManageTemplateOptionLeg` vs `TemplateShapeLeg` (#1492)
  duplication — counterpart doesn't exist yet; convergence note added to
  the field doc.

## Spec axis

All four acceptance criteria **MET**:

| Criterion | Verdict |
|---|---|
| Instance contracts + vocabularies + `ManageInstance` | MET |
| `StrategyTemplate`/`NamedVariant`/`VariantLeg` resolve | MET (aliases + re-export) |
| Invariant validator paper⇒`ALL` / real⇒≠`ALL` | MET |
| Unit specs for invariants | MET |
| No S2/S3 scope creep | MET |

Notes: ID order, `UNSTARTED` semantics, template=shape / variant=concrete
all verified against PRD. Stale PRD text (`lifecycleState` in the instance
record section) predates the `runState` blueprint decision — doc-level,
not implementation.

## Thermo-nuclear axis

**Fixed in review:**

- **Major** — jest moduleNameMapper (same finding as Standards).
- **Minor** — `isValidModeStopType('real', '   ')` passed; whitespace
  guard added (+ spec line).
- **Minor** — `paperAccountId` doc overclaim vs optional field; clarified
  ("enforced at the create path, not by this type"). `variantRef`
  precedence documented (`variant` authoritative; ref is provenance).

**Declined with rationale:**

- **Discriminated union on `mode`** (paper⇒`stopType:'ALL'` +
  `paperAccountId` required at type level). Real suggestion — but v1 is
  paper-only, so the `ManageRealInstance` member would be dead code
  (coding-guidelines §3); Firestore docs aren't schema-enforced so the
  persisted read shape must hold malformed docs a union can't represent;
  and TS can't express "string minus 'ALL'" for the real branch anyway.
  The predicate + create-path validation is the proportionate seam.
- **Embedded snapshot drift** — defensible per `VariantSnapshot` precedent
  and required for ad hoc variants; `variantRef` precedence now documented;
  reconcile path is a #1539+ concern.
- **Spec tautologies** (`id.endsWith(stopType)`) — the real ID-format
  contract belongs to #1542's generator + tests.

## Test results

`npx jest` full suite: **312 suites / 5608 tests — all pass**
(teardown warning only, no failures). Verify script:
`strat-manage-contracts-1538.ts` — all checks pass. Both tsconfigs
typecheck clean; `@manage/*` resolution proven under tsx (root +
functions cwd) and jest moduleNameMapper.

## Handoff

`/proj qa 137 1538`
