**Topic:** Strategy Builder UI  
**Topic Slug:** strat-manage  
**Thread:** OpsStrat Manage Page Overhaul  
**Thread Slug:** page-overhaul  
**Issue:** #1570  
**Thread Parent:** #1510  
**Topic Parent:** #137  
**Task:** #1542  
**Domain:** STRAT-MANAGE  
**Type:** UAT  
**Status:** Complete  
**Created:** 2026-11-15  
**Last Updated:** 2026-11-15  

# UAT — #1542 SHARED: Manage instance ID generator

## Scope

`shared/manage-instance-id.ts` mints `{SYM}-{SPREAD}-{DTE}-{ΔLEGS}-{STOP}`
instance ids — the Firestore doc id **and** dedup key for strategy
instances (one per variant × symbol). `QQQ-CDS-30-50-40-ALL`,
`SPY-CDS-45-40-30-T8`, `QQQ-CUSTOM-30-50-40-ALL`. Review-pass hardening:
mode gate, finite-delta guard, **shape** conformance (`variantMatchesTemplateShape`
— kind/type/side/count; bands are authoring policy, not identity),
per-segment charsets, whole-id net, frozen `STOP_CODES`.

**Acceptance criteria (issue body):**

1. `shared/manage-instance-id.ts` generates ALL-CAPS IDs per spec
   (spread code, leg-order deltas, `ALL`|stop suffix)
2. `STOP_CODES` map seeded with `ALL` + placeholder real codes
3. Specs: multi-leg codes, delta ordering, caps, empty-leg throw

## Prerequisites

- Repo at `C:\aa\projects\rel-str`, prod branch, `node_modules` installed
- No credentials needed — pure shared module, no Firestore/BE surface

## Getting to the feature

- **Route:** N/A — pure shared module, no UI surface this task
- **Entry point:** N/A — consumed later by the BE instance-create path
  (FE/BE tasks downstream of blueprint #1535)
- **Surface:** TypeScript module `shared/manage-instance-id.ts`;
  observable via the Jest spec and the standalone verify script

## Test scenarios

### S1 — Verify script passes standalone

1. `npx tsx scripts/verify/strat-manage-instance-id-1542.ts`
2. **Expect:** every check prints `OK   name: value` (26 checks —
   alias resolution, seeded-unique ids, `STOP_CODES` frozen +
   ALL-CAPS-alnum keys, every fail-closed reject, seeds still conform);
   script ends `=== ALL CHECKS PASSED ===`, exit 0.
3. **Result:** PASS — 26/26 checks `OK`, `=== ALL CHECKS PASSED ===`,
   exit 0 (2026-11-15). Includes `ad hoc out-of-band deltas mints:
   "QQQ-CDS-60-60-50-ALL"` (shape ≠ bands), `put legs under cds throws`,
   `garbage mode throws`, `NaN delta throws`, `dotted symbol BRK.B`,
   `STOP_CODES frozen`, `constructor/toString/valueOf/hasOwnProperty`
   stop keys all rejected.

### S2 — Focused specs pass

1. `npx jest shared/manage-instance-id.spec.ts --coverage=false`
2. **Expect:** 26 tests pass — grammar shape/normalization, per-leg and
   multi-leg ΔLEGS ordering, STK marker, CUSTOM segment, out-of-band
   ad hoc mint (shape ≠ bands), and every guard-reject regression.
3. **Result:** PASS — 26/26 tests, suite green in ~4 s (2026-11-15).

### S3 — Both TypeScript surfaces compile

1. `npx tsc --noEmit` (app tsconfig, covers `shared/`)
2. `cd functions && npm run build` (functions tsc)
3. **Expect:** zero errors in `manage-*` files (pre-existing foreign
   WIP errors in `bulk-swing-sweep`/`portfolio-dashboard`/contract-list
   files are out of scope).
4. **Result:** PASS — app `tsc` emitted zero `manage-*` diagnostics;
   functions `npm run build` emitted `lib\index.js` cleanly
   (2026-11-15).

### S4 — `@manage/instance-id` resolves in all three runtimes

1. Root tsconfig: proven by S1 (the verify script imports the alias).
2. Functions tsconfig: probe file importing `@manage/instance-id`,
   run `npx tsx` from `functions/` — must generate a real id.
3. Jest `moduleNameMapper`: proven by S2 (the spec imports the alias).
4. **Result:** PASS — all three runtimes resolve. Functions-side tsx
   probe printed `fn-alias-ok QQQ-CDS-30-50-40-ALL` — generated from
   seeds through `@manage/instance-id` + `@manage/variant-catalog`
   under `functions/tsconfig.json` (2026-11-15).

### S5 — Frozen vocabularies + registries hold

1. Probe: `STOP_CODES.ZZ9='x'` must throw (strict-mode) / stay absent;
   `INSTANCE_MODES.push('live')` must throw; `MANAGE_TEMPLATES[0].code
   ='CUSTOM'` must throw or no-op (parent freeze added pass 2);
   `MANAGE_VARIANTS.push({})` must throw.
2. **Expect:** `FROZEN-OK` — every mutation vector blocked.
3. **Result:** PASS — `FROZEN-OK`, exit 0 (2026-11-15). Verified by
   post-write value comparison (tsx's CJS transform silently no-ops
   frozen writes rather than throwing): `ZZ9` absent from
   `STOP_CODES`, `INSTANCE_MODES.length === 2`,
   `MANAGE_TEMPLATES[0].code === 'CDS'`.

### S6 — Shared suite regression

1. `npx jest shared/ --coverage=false`
2. **Expect:** all shared suites pass (52+ suites / 960+ tests) — no
   regressions in catalog/contracts consumers from the
   `variantMatchesTemplateShape` split or the added freezes.
3. **Result:** PASS — 53 suites / 1082 tests, all green (2026-11-15).

### S7 — Refinement pass (visual/UX)

- N/A — no UI surface this task; deferred to the FE manage-page tasks.

## Traceability

| Acceptance criterion | Scenario(s) |
|---|---|
| AC1 — ALL-CAPS ids per spec | S1, S2 |
| AC2 — STOP_CODES seeded + placeholder | S1, S2, S5 |
| AC3 — multi-leg codes, ordering, caps, empty-leg throw | S1, S2 |
| Alias resolves (tsc ×2 + jest) | S3, S4 |
| Registries/vocabularies frozen | S5 |
| No regressions | S6 |
| Manual UI/UX refinement | S7 — N/A |

## Regression / smoke checklist

- [ ] `variantMatchesTemplate` (full band check) still exported for
      seed/create-path consumers — catalog spec covers it
- [ ] `generateInstanceId` (legacy strategy-instance-id.ts) untouched
- [ ] No callers of the new module outside spec/verify yet — dedup-key
      semantics land with the BE create path

## Findings

- None — all six applicable scenarios passed on first execution. No
  QA-found defects this task (the shallow-freeze and `in`-operator
  issues were caught and fixed during review, before QA).

## Results log

- 2026-11-15 — UAT drafted for QA issue #1570.
- 2026-11-15 — S1–S6 executed, all PASS; S7 N/A (no UI surface).
  Status → Complete; QA issue #1570 → RESOLVED.
