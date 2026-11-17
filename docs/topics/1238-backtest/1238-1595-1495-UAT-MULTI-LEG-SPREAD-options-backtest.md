**Topic:** Options Backtest  
**Topic Slug:** options-backtest  
**Thread:** Multi-leg Templates  
**Thread Slug:** multi-leg-templates  
**Issue:** #1595  
**Thread Parent:** #1270  
**Topic Parent:** #1238  
**Task:** #1495  
**Domain:** MULTI-LEG-SPREAD  
**Type:** UAT  
**Status:** Complete  
**Created:** 2026-11-17  
**Last Updated:** 2026-11-17  

# UAT — #1495 SHARED Task: Seed named variants from catalog

## Scope

`REPLAY_VARIANTS` seeded 4 → 21 curated entries — one per base template
plus the catalog's four example points verbatim. Deepened runtime freeze
(entry objects + arrays). #1276 verify script re-pinned to legacy-first
`slice(0,4)` smoke. All checks are CLI-executable; every scenario ran
with real output.

## Scenarios

### S1 — Spec suite green

`npx jest shared/options-replay --runInBand`

```
Test Suites: 2 passed, 2 total
Tests:       95 passed, 95 total
```

**Result:** PASS

### S2 — Real registry validates clean

`validateVariantRegistry()` over the shipped 18 shapes + 21 variants:

```
S2 — validateVariantRegistry() over real registries:
  violations: []
```

**Result:** PASS — every seeded entry validates (grid, sign parity,
per-kind fields, unique ids, structure resolution, no dup legs).

### S3 — Coverage: 18/18 shapes + band containment + catalog examples

```
short-put          csp-45-20, csp-30-30
long-call          lc-30-20, lc-45-15, lc-365-75
long-put           lp-45-30
short-call         sc-45-20
put-credit-spread  pcs-45-20-5
call-credit-spread ccs-45-20-5
put-debit-spread   pds-45-40-15
call-debit-spread  cds-45-40-15
iron-condor        ic-45-20-10
iron-butterfly     ib-45-50-20
call-calendar      ccal-30-60-20
put-calendar       pcal-30-60-20
call-diagonal      cdiag-180-21-70-20
put-diagonal       pdiag-180-21-70-20
long-straddle      lst-45-50
long-strangle      lng-45-20
short-strangle     sng-45-20
covered-call       cov-45-20
```

Every leg position-matched inside its shape's `deltaBand`/`dteBand`
(spec-pinned, stricter than the validator's on-grid floor). The four
catalog examples are asserted verbatim: `pcs-45-20-5` (−0.20s/−0.05l put
@45), `lc-365-75` (+0.75 call @365), `ccal-30-60-20` (+0.20 call 30→60),
`cov-45-20` (stock + +0.20 call @45).

**Result:** PASS — zero gaps.

### S4 — Live delegated audit against prod

`npx tsx functions/scripts/verify/options-replay-template-registries-1492.ts`

```
0 FAIL / 0 WARN — 18 shapes, 21 variants, 6 new-model run(s), 0 legacy
AUDIT PASS
```

**Result:** PASS

### S5 — #1276 alias-smoke script (the thermo M1 fix)

`npx tsx scripts/verify/options-backtest-selection-replay-1276-registry-collections.ts`

```
OK   registry seeds (legacy four): ["csp-45-20","csp-30-30","lc-30-20","lc-45-15"]
OK   getReplayTemplate hit coordinate: {"type":"put","targetDelta":-0.2,...}
OK   getReplayTemplate hit side: "short"
OK   getReplayTemplate miss: undefined
OK   replay runs root: "st-options-replay-runs"
OK   contract lists root: "st-options-contract-lists"
OK   list doc id IS the runId (#1430): "or-abc_QQQ"
=== ALL CHECKS PASSED ===
```

The previously hard-pinned 4-id check would have gone red on this change;
the `slice(0,4)` smoke is resilient to future single-leg seeds (the
spec pins legacy-first ordering).

**Result:** PASS

### S6 — Consumer compile

`cd functions && npx tsc --noEmit` — clean (no output).

**Result:** PASS

### S7 — Legacy surface growth is the intended 7

`REPLAY_TEMPLATES` (derived = single-option-leg variants only):

```
csp-45-20, csp-30-30, lc-30-20, lc-45-15, lc-365-75, lp-45-30, sc-45-20
```

The three new single-leg seeds join the v1 picker surface; every
multi-leg variant correctly does not.

**Result:** PASS

## Manual UI/UX refinement pass

Not applicable — pure registry data + specs. The variant menu reaches the
UI via the existing `REPLAY_TEMPLATES` picker surface (S7) until the
builder dialog lands (#1507); no new UI was added.

## Findings

None.

## Traceability

| Criterion | Scenario |
|---|---|
| Registry covers the curated common-case set per base template | S3 |
| Every entry validates clean | S2, S4 |
| Names display-stable ('45DTE 20/5Δ put credit spread') | S3 (pinned verbatim), S2 |
| No regression to existing consumers | S1, S4, S5, S6, S7 |

## Verdict

**QA PASS** — 7/7 scenarios green. Ship-eligible.
