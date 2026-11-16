**Topic:** Strategy Builder UI  
**Topic Slug:** strat-manage  
**Thread:** OpsStrat Manage Page Overhaul  
**Thread Slug:** page-overhaul  
**Issue:** #1535  
**Thread Parent:** #1510  
**Topic Parent:** #137  
**Task:** #1541  
**Domain:** STRAT-MANAGE  
**Type:** CODE-REVIEW  
**Status:** Complete  
**Created:** 2026-11-15  
**Last Updated:** 2026-11-15  

# Code Review — #1541 SHARED: Variant catalog module

## Scope reviewed

`shared/manage-variant-catalog.ts` (seed registry + lookups) ·
`shared/manage-variant-catalog.spec.ts` ·
`scripts/verify/strat-manage-variant-catalog-1541.ts` + `.md` guide ·
`@manage/variant-catalog` alias registrations (tsconfig ×2, jest) ·
README/run-all registry entries.

## Axis results

### Spec — PASS-WITH-FINDINGS

All three ACs MET: seeds present (1 template `cds`, 2 PRD-example
variants), lookups exist (named `getManage*` per the CONTEXT.md
overload-avoidance convention — documented deviation from the literal AC
names, same precedent as #1538's `ManageTemplate`/`ManageVariant`), spec
coverage complete. Module mirrors the external JSON artifact (pure
literals; string enums serialize naturally). No scope creep into #1542.

Findings: stale "25–35 DTE" example in CONTEXT.md + contracts header
(seed ships 25–45, required by `cds-45-40-30`) — **fixed in review**;
README diff bundles another session's #637/639/640 rows — ship-time
hunk staging, already planned.

### Standards — PASS-WITH-FINDINGS

No critical/major violations. Naming, headers, file size, jest-native
specs, three-place alias registration, four-part verify convention all
conform. Minors fixed in review: missing JSDoc on `MANAGE_TEMPLATES`/
`MANAGE_VARIANTS`, missing section banners. Deferred-nit: `template!`
non-null asserts, `unknown` guard helpers (harmless, mirror the verify
script).

### Thermo-nuclear — PASS-WITH-FINDINGS

- **F1 MAJOR — overlapping bands admit credit-inverted "debit" variants**
  (long 0.38/short 0.42 fits [0.35,0.55]/[0.25,0.45] but is a credit
  spread wearing a CDS name). Resolved in review: documented that debit
  character comes from cross-leg **delta ordering** (bands are per-leg
  authoring bounds), and an ordering assertion (`|Δ|long > |Δ|short`)
  added to spec + verify. Machine-readable structure semantics flagged
  to the artifact-schema workstream.
- **F2 MAJOR — `templateId: 'custom'` was a documented dangling ref.**
  Resolved: `MANAGE_CUSTOM_TEMPLATE_ID` sentinel exported (same pattern
  as `MANAGE_ADHOC_VARIANT_REF`); contract docstring updated to point at
  it; spec + verify assert it never resolves.
- **F3 — conformance check lived only in tests.** Resolved:
  `variantMatchesTemplate` shipped on the module — single implementation
  for spec, verify, and the BE create path.
- **F5 — no code-surface lookup.** Resolved: `getManageTemplateByCode`
  added (the ID grammar's SPREAD segment is `code`; #1542 resolves
  template-from-ID through it).
- Minors fixed: stock-leg `side` conformance (now inside
  `variantMatchesTemplate`), cross-namespace + name uniqueness checks,
  code regex relaxed to `[A-Z0-9]+` (digits are legitimate), primary-dte
  asserted as `min(leg dtes)` (the near-leg rule).
- Deferred (documented, not blockers): registry mutability (matches
  precedent; in-process curated module), multi-expiry id/`dte`
  ambiguity → #1542, per-template credit/debit direction map →
  artifact-schema, `ReplayVariant`'s inherited 'custom' hole → #1492's
  session.

## Verification

- 22 catalog spec tests green (36 across all manage specs)
- Verify script: 24 checks, all `OK`, exit 0
- `npx tsc --noEmit -p tsconfig.app.json` — exit 0
- `cd functions && npm run build` — clean
- Full suite: **313 suites / 5650 tests** — all pass

## Pass 2 — re-review of the pass-1 fix state

All three axes re-run on the post-fix code. Spec axis verified every
pass-1 fix correct by independent trace (ordering check catches the
0.38/0.42 inversion; helper narrowing, signed-band comparisons,
positional contract all sound) — no majors on any axis.

- **Fixed (medium)** — registries were `readonly`-typed but not frozen;
  the deferral rationale "matches replay precedent" was factually wrong
  (the replay registries were `Object.freeze`d in the #1492 review).
  Freeze loop added, mirroring that fix verbatim.
- **Fixed** — `variantMatchesTemplate` doc now disclaims its two real
  gaps (denormalized `variant.dte`, `templateId===template.id`) so the
  "single implementation" claim can't be over-read; `Array.isArray`
  guard added for non-array input.
- **Fixed** — ordering assertion now iterates unordered `{long,short}`
  role pairs with a length guard (a short-first template previously
  no-op'd silently).
- **Fixed** — sentinel pins on all three surfaces: literal pins
  (`'custom'`/`'adhoc'`), `code !== 'CUSTOM'` (the ad hoc SPREAD
  segment), variant ids disjoint from `MANAGE_ADHOC_VARIANT_REF`.
- **Fixed** — "lowercase code" test now actually asserts
  `getManageTemplateByCode('cds') === undefined`.
- **Fixed** — tautological stringify round-trip replaced: spec uses
  type-aware `toEqual` (catches Date→string), verify uses a leaf-walk
  (string | finite number | boolean | array | plain object).
- **Fixed** — seed whole-percent Δ guard (`targetDelta*100` integer)
  matching the ΔLEGS encoding; band sanity (`deltaMin<=deltaMax`,
  `dteMin>0`) + non-empty id/name checks added to verify.
- **Fixed** — stale guide text (module surface), spec index coupling
  (`MANAGE_VARIANTS[0]` → select-by-id), verify banner/footer aligned to
  sibling convention, "PRD examples" overstatement corrected.

### Still deferred (owned downstream, reconfirmed live)

- Multi-expiry/diagonal ID collision — concrete case recorded: CDS's
  identical 25–45 bands on both legs admit `{long@45-DTE, short@30-DTE}`
  passing conformance + ordering, colliding on the same instance ID.
  **→ #1542** (ID grammar), with F3's ΔLEGS rounding policy.
- Per-template credit/debit direction map + machine-readable structure
  → artifact-schema workstream.
- `ReplayVariant` 'custom' hole → #1492 session.
- `variantRef` 'adhoc' ambiguity is provenance-only (never dereferenced).

## Verdict: **PASS** (two passes)

Both majors resolved in-review (ordering invariant + custom sentinel);
pass-2's medium (missing runtime freeze) was a precedent-mismatch fix,
not a design defect. Findings decayed to documented deferrals with
owners — no further pass warranted.
