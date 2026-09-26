**Topic:** Portfolio Allocation  
**Topic Slug:** `portfolio-allocation`  
**Thread Parent:** #577  
**Issue:** #581  
**Task:** #583  
**Topic Parent:** #576  
**Domain:** PORTFOLIO  
**Type:** CODE-REVIEW  
**Status:** Final  
**Created:** 2026-09-26  
**Last Updated:** 2026-09-26  

---

# Code Review — #583 SHARED: Allocation bucket + attribution contracts

**Verdict: PASS** (4 review rounds; final round: no critical/major findings, one minor docblock ambiguity fixed inline)

## Scope

`shared/portfolio-allocation-contracts.ts`, `shared/portfolio-allocation-ids.ts` (+ specs), `shared/common.ts` (EquityCurvePoint hoisted), `shared/paper-trading-contracts.ts` (re-export), `AGENTS.md` (portfolio- prefix row), PRD/IMPL/TEST doc syncs. Contracts-first task — no consumers yet (utils #584, services #586).

## Spec compliance — all task ACs met

- Contracts export `AllocationBucket`/`PositionAttribution`/`AttributionEvent`/`BucketStats`/`BucketStatus`.
- Ids `{account}_{slug}` / `{account}_{instrumentId}` via validated builders.
- No `isCash` — Cash is computed; shape pinned by spec.
- `BucketStatus.RETIRED` terminality + writer rules documented.
- Enum/shape coverage in specs.

## Round history

### Round 1 — remediated (critical/major)

- **CRITICAL — name-derived id broke rename referential integrity** → freeze-at-creation: id minted once, rename updates `name` only; all attribution references stay intact.
- **MAJOR — silent slug collisions** → explicit contract: builder never disambiguates; create must check doc existence.
- **MAJOR — tautological contracts spec** → fixtures derive ids via `buildBucketId`/`buildAttributionId`; assertions pin contract↔format coupling, history invariants, `BucketStats` key set.
- **MAJOR — Unicode mangling in bucketSlug** → ASCII-only slug is the documented contract; specs pin behavior.
- Minor: `EquityCurvePoint` hoisted to `shared/common.ts` (re-exported by paper-trading — no import churn); `BucketStats.asOf` added; id-builder input validation (`[A-Za-z0-9]+` accounts, non-empty/no-`/` instrumentIds); AGENTS.md `portfolio-` row; PRD/IMPL `isCash` staleness fixed.

### Round 2 — remediated (doc-level)

- **Freeze-at-creation shifted collision surface to names** → declared `name` uniqueness among buckets (ticket-resolution key); ticket match scoped to ACTIVE + same account, 0-or->1 → Unassigned.
- Retired buckets keep id/name occupied — documented.
- IMPL `BucketStats` sketch synced (asOf + EquityCurvePoint); PRD "order→bucket map" wording → per-position attribution (lines 130/143/147); story 13 duplicate renumbered (stories 1–27, AC headings resynced); forward reference tagged (#584); `Object.keys` sorted.

### Round 3 — remediated (contract completeness)

- **Retired-name reuse contradiction** → single coherent rule: name comparison is `bucketSlug` equality across ALL buckets; create = occupied-id check (aliases + retired + renamed-away all covered); rename = no other bucket's name-slug equals new name's.
- **Unassigned representation** → documented as absence of an attribution doc (no sentinel `bucketId`).
- `history` non-empty + contiguous chain (`history[i].from === history[i-1].to`, tail `toBucketId === bucketId`); writer check + write in one transaction; `fromBucketId: null` covers fill-time seeds and post-hoc assignment; `toBucketId` never targets RETIRED.
- PRD "trade's attribution record" → "position's".

### Round 4 — clean

- **MINOR (fixed inline):** `bucketSlug` throws on un-slugifiable names — documented: ticket strategyName that can't slugify → 0-match → Unassigned (never an error); create/rename to such a name IS a validation failure.
- All spec fixtures re-verified against every stated invariant — no violations.

## Test results

- `npx jest` full suite: **1884/1884**, 139 suites.
- `npx jest shared/portfolio-allocation`: **19/19**.
- No pipeline/UI surface — contracts compile via ts-jest; no verify script applies.

## Accepted deferrals

- `targetPct` domain validation (≤0, >100, Σ>100 warn-only) — writer-level (#586).
- `history` unbounded embedded array — moves are rare; `PaperTrade` embeds `fills`/`marks` the same way.
- Uniqueness/rename enforcement is contract-documented; behavioral tests land with the writers (#586).
