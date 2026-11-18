**Topic:** Options Backtest  
**Topic Slug:** options-backtest  
**Thread:** Multi-leg Templates  
**Thread Slug:** multi-leg-templates  
**Issue:** #1602  
**Thread Parent:** #1270  
**Topic Parent:** #1238  
**Task:** #1497  
**Domain:** MULTI-LEG-SPREAD  
**Type:** UAT  
**Status:** Complete  
**Created:** 2026-11-17  
**Last Updated:** 2026-11-17  

# UAT — BE Task: Shared selection fn + parity harness (#1497)

## Scope

Shared pure selection fn `selectContractAtCoordinate` in
`shared/options-common.ts` (SA pick-doc two-stage semantics) plus the live
parity harness — the falsifiable convergence proof between live selection
and the materialized pick corpus. No UI surface; all verification is CLI.

## Prerequisites

- ADC (`GOOGLE_APPLICATION_CREDENTIALS` or
  `GOOGLE_IMPERSONATE_SERVICE_ACCOUNT`) for the live harness.
- **IPv4 preload required on this network** — see Results log.

## Getting to the feature

No app route. The surfaces are:

- Spec: `npx jest shared/options-common.spec.ts`
- Live harness:
  `npx tsx scripts/verify/options-backtest-selection-replay-1497-selection-parity.ts`
  (registered in `scripts/verify/run-all.ts`, `needsAdc`)

## Test scenarios

### S1 — Unit suite covers eligibility / tie-breaks / boundaries (AC3)

- `npx jest shared/options-common.spec.ts --coverage=false`
- Covers: no-candidate → null; all three tie-break levels (equidistant
  DTE → longer; equidistant delta distance → larger |Δ| — pinned with a
  *genuinely* float-equal pair; residual → lowest contractId); dte=0
  boundary eligible / negative rejected; identity-only eligibility gaps;
  signed put/call targets; literal-type requirement ('P'/'Put' rejected);
  mark omitted not fabricated; malformed **and** impossible-calendar
  marketDate throws.
- **Result:** PASS — `Tests: 15 passed, 15 total`

### S2 — Parity harness runs the fixture matrix; divergences are named failures (AC2)

- `npx tsx scripts/verify/options-backtest-selection-replay-1497-selection-parity.ts`
- Fixture: QQQ × {put −0.20Δ @45d, call +0.20Δ @45d, put −0.50Δ @180d} ×
  first/mid/last pick days of the 2026 shard + any miss days carried.
- One chain fetch per day shared across cells (mirrors SA's verbatim
  fan-out). Pick days assert contractId + dte + expiration + strike +
  delta equality; `no_match` → null; `no_chain` → informational;
  chain-fetch failures → named FAIL (never vacuous pass); `checks > 0`
  floor guards the silent-pass path.
- **Result:** PASS — verbatim tail:

```
INFO fetched chains for 3 day(s); 0 fetch failure(s)
OK   put -0.20Δ @45d (csp-45-20) @2026-01-02: pick parity — selected QQQ260213P00580000, corpus picked QQQ260213P00580000
OK   put -0.20Δ @45d (csp-45-20) @2026-01-02: delta parity — sel=-0.20089 doc=-0.20089
OK   put -0.20Δ @45d (csp-45-20) @2026-06-10: pick parity — selected QQQ260724P00635000, corpus picked QQQ260724P00635000
OK   put -0.20Δ @45d (csp-45-20) @2026-06-10: dte parity — sel=44 doc=44
OK   put -0.20Δ @45d (csp-45-20) @2026-11-16: pick parity — selected QQQ261231P00605000, corpus picked QQQ261231P00605000
OK   call +0.20Δ @45d (sc-45-20) @2026-06-10: delta parity — sel=0.19893 doc=0.19893
OK   put -0.50Δ @180d @2026-06-10: pick parity — selected QQQ261218P00720000, corpus picked QQQ261218P00720000
OK   put -0.50Δ @180d @2026-06-10: dte parity — sel=191 doc=191
OK   put -0.50Δ @180d @2026-11-16: pick parity — selected QQQ270617P00690000, corpus picked QQQ270617P00690000
OK   put -0.50Δ @180d @2026-11-16: dte parity — sel=213 doc=213
OK   assertions ran — checks=45

46/46 checks passed
```

  Note the real-world edge behavior verified: the 180d cell lands on
  actual dte 179 / 191 / 213 across the sampled days — nearest-listed-
  expiry semantics tracked SA's pick in every case.

### S3 — Function implements the spike-confirmed spec exactly (AC1)

- Line-exact port verified at review against
  `av-proxy-api/.../options-delta-picker.service.ts` (see
  `1238-1489-1497-CODE-REVIEW-…` "Verified identical" table); live S2
  parity is the executable proof — including exact float delta parity
  (`-0.20089 ≡ -0.20089`, `-0.50224 ≡ -0.50224`).
- **Result:** PASS

### S4 — Consumer compile

- `cd functions && npx tsc --noEmit` → 0 errors (the shared module is
  consumed via `@options/common` alias by functions paths).
- **Result:** PASS

## Traceability

| Acceptance criterion | Scenario |
|---|---|
| Function implements spike-confirmed spec exactly | S3 (+ S2 live proof) |
| Parity harness runs fixture matrix; divergences = named failures | S2 |
| Unit tests: no-candidate, tie-break, boundary | S1 |

## Refinement pass

N/A — no UI. The fn's picker surface is consumed by #1499 (mapper) /
#1501–#1502 (engine re-targets); its contract is the spec + harness.

## Findings

None. One environmental note for operators (not a code finding).

## Results log

- 2026-11-17 — S1 15/15; S4 tsc clean; S2 **46/46** live parity.
- **Environmental:** two harness runs initially failed mid-run with
  `ETIMEDOUT`/`request to oauth2.googleapis.com/token failed` — the
  documented AT&T IPv6 hang (`AGENTS.md` → `docs/dev-notes/IPV6-NODEJS-
  NETWORK-ISSUE.md`). This shell lacked `NODE_OPTIONS=--require
  C:\Users\bob\.config\node\ipv4-only.cjs`; re-running with the preload
  produced the clean 46/46. The harness correctly *named* the infra
  failure as FAIL rather than vacuously passing — validating the
  review-cycle hardening.
