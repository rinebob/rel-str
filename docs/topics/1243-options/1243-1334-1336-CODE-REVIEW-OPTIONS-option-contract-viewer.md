**Topic:** Option Contract Time-Series Viewer  
**Topic Slug:** option-contract-viewer  
**Thread:** OCC Contract String Group Generator  
**Issue:** #1334  
**Thread Parent:** #1325  
**Topic Parent:** #1243  
**Task:** #1336  
**Domain:** BE  
**Type:** CODE-REVIEW  
**Status:** Complete  
**Created:** 2026-10-31  
**Last Updated:** 2026-10-31  

## Verdict: PASS

All three axes returned **zero critical and zero major findings**. Six nit/minor
items were **remediated in the same review cycle** before this verdict was
recorded; the remaining minors are pre-existing/systemic and recorded for a
future refactor.

## Scope reviewed

- `shared/options-contract-contracts.ts` — `ContractAvailability*` types
  (landed earlier under FE task #1338; verified verbatim against IMPL)
- `functions/src/types/partner.ts` — `CONTRACT_AVAILABILITY_V1` enum + type re-exports
- `functions/src/options-contract-proxy.ts` — `callPartnerContractAvailabilityV1` (new, ~110 lines)
- `functions/src/options-contract.callables.ts` — `queryContractAvailability` callable
- `functions/src/index.ts` — export
- `tests/functions/options-contract-availability.test.ts` — 15 route-level specs
- `scripts/verify/options-contract-availability-1336.ts` + `.md` — 16-check live script
- `scripts/verify/run-all.ts` + `README.md` — registration

## Standards axis

**Clean.** Exact sibling match to the catalog-V2/historical-options proxy:
OIDC + Bearer + `fetchWithRetry`, `{endpoint}_request/_upstream_error/_parse_error/_response`
log family, `PartnerHttpError` + `extractPartnerCode`, env-var URL/audience
pattern. The base-host `aud` deviation is deliberate, correct, and documented
in three places (code comment, IMPL as-built note, verify-guide fail section).
No secrets, `cors: ST_ALLOWED_ORIGINS`, error mapping via
`partnerHttpErrorToCallableCode` (the newer convention shared with
`getHistoricalOptionsChain`).

## Spec axis

**Every IMPL checklist item met.** Shared types verbatim; enum + env vars;
pre-OIDC BAD_REQUEST validation (symbol + 3 inverted ranges — superset of
spec); verbatim param pass-through incl. `expirations[]` → comma-join;
unreshaped response; catalog-mirror error/parse handling; route-level specs
at the designated seam. FE contract verified end-to-end: `CallableName`,
request shape, response shape all match `ContractAvailabilityService` with
zero FE changes.

TEST-plan coverage: every journey met or covered-by-construction. One
documented deferral: non-numeric-strike / malformed-date client-side
validation left to SA (its 400 propagates to `invalid-argument` through the
same path) — consistent with the thin-pass-through charter.

## Thermo-nuclear axis

Confirmed the copy-of-proven-pattern is the right call at this size; the
test seam (`globalThis.fetch` + IAM-URL discriminator) mirrors
`spread-proxy.test.ts` correctly; no tautological or assert-less specs.

## Findings

### Critical / Major
None on any axis.

### Fixed in this review cycle

1. ~~**`!== undefined` / `!= null` guard asymmetry**~~ — FIXED. Validation used
   `!== undefined` while serialization used `!= null`; a runtime `null` bound
   could produce a spurious BAD_REQUEST. All six range guards now `!= null`.
2. ~~**`data` shadowing in callable**~~ — FIXED. Inner `const data = await …`
   shadowed the request `data`; renamed to `result` (sibling convention).
3. ~~**IMPL-mandated `duration` missing from response log**~~ — FIXED. Added
   `durationMs` around the upstream call.
4. ~~**Zero-bound / empty-list pins absent**~~ — FIXED. New spec: `strikeGte:0`
   serializes as `'0'`; `expirations:[]` does not reach the wire.
5. ~~**`corpusDateCount: 0` over-strict verify check**~~ — FIXED. The check now
   tolerates a legitimately-zero advertised count.
6. ~~**IMPL doc drift**~~ — FIXED. Enum name updated to the as-built
   `CONTRACT_AVAILABILITY_V1` (the aud deviation was already corrected in a
   prior pass).

### Deferred (pre-existing / systemic — recorded for future work)

- **5× duplicated fetch/parse/error core** in `options-contract-proxy.ts`
  (~225 lines of invariant skeleton) — real drift already exists
  (`extractPartnerCode` missing in 2 of 5 siblings). Refactoring four working
  sibling handlers is beyond this task's blast radius; recommended as a
  dedicated refactor that extracts only the fetch/parse/error core and keeps
  per-endpoint param serialization explicit.
- **Full upstream body embedded in thrown `PartnerHttpError` message** →
  propagates verbatim to the client payload. Same pattern in all 5 handlers;
  house-consistent. Bundle with the shared-helper refactor (truncate once).
- **No `fetchWithRetry` timeout/deadline** — affects all endpoints equally.
- **Callable has no `req.auth` check** — consistent with all 5 sibling
  partner callables (auth is enforced elsewhere in this app's posture);
  pre-existing, not introduced here.
- **`badRequest()` helper name is generic with a hardcoded endpoint prefix** —
  single consumer today; parametrize if a 6th endpoint reuses it.
- **Upstream 401/403/405 + `type:'call'/'put'` + network-failure paths**
  exercised only by-construction (shared `!resp.ok` branch + verbatim
  `search.set`); convention tests pin the mapping table.

## Second pass (post-remediation)

Re-verified all six fixes compile and pin correctly: `tsc --noEmit` clean,
**15/15** route specs green. No new issues introduced.

## Verification evidence

- `npm run test:options-availability` → 15/15 pass
- `npx tsc --noEmit` (functions) → clean
- `npx tsx scripts/verify/options-contract-availability-1336.ts` (live SA,
  impersonated caller SA) → **16/16** checks incl. bounded QQQ query
  (step/type/expiration-sort honored, `truncated`, `corpusDates`), all
  validation rejects, `OPTIONS_NOT_ENABLED` propagation on unknown symbols
- `eslint` → 0 errors (21 pre-existing warnings, none in this change)
- Full `tests/functions` suite → one unrelated failure in
  `paper-trading/analysis-dataset-writer.test.ts` caused by concurrent
  uncommitted paper-trading work (deps fixture vs modified source); not this
  change's surface

## Ship notes

- **Callable is code-complete but NOT deployed.** `firebase deploy --only
  functions` ships the entire bundle (including concurrent uncommitted
  functions work) — deployment is a ship-time decision.
- QA #1349 (drawer component) unblocks on deploy; the drawer's `view lines`
  / count row render only on a successful Run.
