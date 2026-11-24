**Topic:** Strategy Manager  
**Topic Slug:** strat-manage  
**Thread:** Live Position Lifecycle  
**Thread Slug:** live-position-lifecycle  
**Issue:** #1723  
**Thread Parent:** #1690  
**Topic Parent:** #137  
**Task:** #1711  
**Domain:** SHARED  
**Type:** UAT  
**Status:** Complete  
**Created:** 2026-11-24  
**Last Updated:** 2026-11-24  

# UAT: #1711 — canonical variant ID grammar + display-name gen + CDS fix

## Scope

The canonical variant-identity contract consumed by the BE passes and
FE manage table: `parseManageInstanceId` (strict typed-segment inverse
of `generateManageInstanceId`) in `shared/manage-instance-id.ts`, and
`variantDisplayName` (the single structure-derived display-name
generator) in `shared/manage-variant-display.ts`. Display names derive
`'{template name} {dte} {Δlegs}'` — the CDS name-segment shuffle
(stale stored `'call debit spread 50-40 30'`) is fixed at the display
seam, no data migration.

Task acceptance criteria:
1. One ID grammar + one display-name generator in `shared/`; manage-variant-catalog is canonical.
2. CDS segment-order fix — `SPY-CDS-30-50-40` renders correctly; round-trip spec-pinned.
3. Every catalog entry id parses + renders; no duplicate display names.

## Prerequisites

- Repo checkout on `prod` with the uncommitted #1711 files present
  (`shared/manage-instance-id.ts`, `shared/manage-variant-display.ts`,
  `shared/manage-instance-id.spec.ts`, `scripts/verify/strat-manage-variant-identity-1711.{ts,md}`,
  `tsconfig.json`, `jest.config.js`).
- `npx jest` and `npx tsx` on PATH (dev dependencies).
- No server, credentials, or Firestore needed — the module is pure.

## Getting to the feature

There is no UI surface. The contract lives at
`shared/manage-instance-id.ts` (generate + parse) and
`shared/manage-variant-display.ts` (display name); consumers will be
the FE manage table + create dialog (#1717) and the backtest (#1692).
All verification is command-line:

```powershell
npx jest shared/manage-instance-id.spec.ts --coverage=false
npx tsx scripts/verify/strat-manage-variant-identity-1711.ts
```

## Automated evidence (executed this session)

- `npx jest shared/manage-instance-id.spec.ts --coverage=false` → **62/62 passed** (2026-11-24)
- `npx tsx scripts/verify/strat-manage-variant-identity-1711.ts` → **33/33 checks OK** (2026-11-24)

## Scenarios

### S1 — parse + display-name spec suite

- Feature: strict parse, display-name derivation, honest fallbacks.
- Steps: run `npx jest shared/manage-instance-id.spec.ts --coverage=false`.
- Expected: 62 tests green — canonical parse, generate→parse round-trips
  for all 40 catalog variants, CDS-shuffle regression, derived===stored
  parity, no dup names, template-shape validation, non-canonical
  encodings, generator encodability, derive-gate fallbacks.
- Result: **PASS** — 62/62 green (2026-11-24)

### S2 — live verify script

- Feature: the contract behaves identically when invoked for real via
  the `@manage/*` aliases.
- Steps: run `npx tsx scripts/verify/strat-manage-variant-identity-1711.ts`.
- Expected: every line `OK`, `=== ALL CHECKS PASSED ===`, exit 0 —
  parse round-trips, shuffle regression, offender-reporting catalog
  loops, honest fails.
- Result: **PASS** — 33/33 checks OK, exit 0 (2026-11-24)

### S3 — the shuffle fix against a stale stored name

- Feature: a variant whose stored `name` carries the old deltas-first
  order still renders the canonical dte-first name.
- Steps: tsx eval — build a `ManageVariant` shaped exactly like catalog
  `cds-30-50-40` but with `name: 'call debit spread 50-40 30'` (the
  stale stored form recorded in the #1510 UAT docs); call
  `variantDisplayName(variant)` and `variantDisplayName('SPY-CDS-30-50-40-ALL')`.
- Expected: both return `'call debit spread 30 50-40'` — the stored
  string is ignored; derivation wins.
- Result: **PASS** — live eval output (`.devin/tmp/qa-1711-eval.ts`):
  ```
  stale-name variant: call debit spread 30 50-40   ← stored shuffle ignored
  instance id:        call debit spread 30 50-40   ← id-derived, dte-first
  authored survives:  call debit spread 50-40 30   ← custom authored name stands
  ```

### S4 — regression: whole suite

- Steps: `npx jest --coverage=false`.
- Expected: all suites green.
- Result: **PASS** — 337 suites / 6438 tests green (2026-11-24; worker-teardown warning pre-existing)

## Manual UI/UX refinement pass

- Not applicable — no user-facing surface (FE binding is #1717).

## Findings

None — all scenarios clean.

## Traceability

| Acceptance criterion | Scenario |
|---|---|
| AC1 — one grammar + one name-gen, catalog canonical | S1, S2 (derived===stored for all 40 entries) |
| AC2 — CDS fix round-trip spec-pinned | S1, S2, S3 |
| AC3 — every catalog entry parses + renders; no dup names | S1, S2 |

## Regression / smoke

- `npx jest --coverage=false` — **337 suites / 6438 tests green**
- `npx tsx scripts/verify/strat-manage-instance-id-1542.ts` — **ALL CHECKS PASSED** — the hardened `dlegsPiece` rejects only sub-0.5% deltas; every seeded variant still mints

## Verdict

**PASS** — S1–S4 green; derivation beats the stale stored name; custom authored names survive.

## Results log

| Date | Task | Executor | Result | Notes |
|---|---|---|---|---|
| 2026-11-24 | #1711 | devin (sess-mg44) | PASS | S1–S4; refinement N/A |
