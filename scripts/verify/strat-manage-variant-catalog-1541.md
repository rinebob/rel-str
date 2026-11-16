# Verification Guide — Manage Variant Catalog (#1541)

Task [#1541](https://github.com/rinebob/rel-str/issues/1541) — SHARED
variant catalog module for the OpsStrat Manage Page Overhaul (Topic #137,
Thread #1510): `shared/manage-variant-catalog.ts`, the seeded
`MANAGE_TEMPLATES`/`MANAGE_VARIANTS` registry +
`getManageTemplate`/`getManageTemplateByCode`/`getManageVariant` lookups
+ `variantMatchesTemplate` + `MANAGE_CUSTOM_TEMPLATE_ID`, consumed as
`@manage/variant-catalog` by both BE and FE. Mirrors the external JSON
artifact shape so bulk-authored variants drop in without a shape change.

## Scripts

| Script | Stage | Purpose |
|---|---|---|
| `strat-manage-variant-catalog-1541.ts` | registry | Asserts `@manage/variant-catalog` alias resolution under tsx, seed counts (≥1 template, ≥2 variants), unique ids/codes, template band-shape legs (no pinned Δ/DTE), concrete variant legs, referential integrity (every `templateId` resolves, legs fit template bands positionally), JSON round-trip stability, and lookup hit/miss/round-trip |

### Usage

```bash
npx tsx scripts/verify/strat-manage-variant-catalog-1541.ts
```

No arguments, no environment variables, no Firestore access — the module
is a code-curated registry plus three pure lookups and a conformance
helper.

**Pass:** every check prints `OK   name: value` and the script ends with
`=== ALL CHECKS PASSED ===` (exit 0).

**Fail:** the offending line prints `FAIL name: value` + an `expected:`
line; the script ends with `=== N CHECK(S) FAILED ===` (exit 1).

## Setup / teardown

None — read-only, no side effects.
