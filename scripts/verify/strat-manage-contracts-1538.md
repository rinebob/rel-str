# Verification Guide — Manage Instance + Variant Contracts (#1538)

Task [#1538](https://github.com/rinebob/rel-str/issues/1538) — SHARED
contracts for the OpsStrat Manage Page Overhaul (Topic #137, Thread #1510):
`shared/manage-instance-contracts.ts` and `shared/manage-variant-contracts.ts`,
consumed as `@manage/instance-contracts` / `@manage/variant-contracts` by both
BE and FE.

## Scripts

| Script | Stage | Purpose |
|---|---|---|
| `strat-manage-contracts-1538.ts` | contracts | Asserts `@manage/*` alias resolution under tsx, the `INSTANCE_MODES`/`INSTANCE_TRIGGERS`/`INSTANCE_RUN_STATES` vocabularies, the paper⇒`ALL` / real⇒concrete stop-type invariant (`isValidModeStopType`), the template band-shape keys, variant concrete-leg ordering, and the `ManageInstance` doc shape + JSON round-trip |

### Usage

```bash
npx tsx scripts/verify/strat-manage-contracts-1538.ts
```

No arguments, no environment variables, no Firestore access — the modules are
contracts and a pure invariant predicate.

**Pass:** every check prints `OK` and the script ends with
`=== ALL CHECKS PASSED ===` (exit 0).

**Fail:** the offending line prints `FAIL` with the expected value; the
script ends with `=== N CHECK(S) FAILED ===` (exit 1).

## Setup / teardown

None — read-only, no side effects.
