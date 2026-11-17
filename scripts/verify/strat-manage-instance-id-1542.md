# Verification Guide — Manage Instance ID Generator (#1542)

Task [#1542](https://github.com/rinebob/rel-str/issues/1542) — SHARED
instance ID generator for the OpsStrat Manage Page Overhaul (Topic #137,
Thread #1510): `shared/manage-instance-id.ts`, the `{SYM}-{SPREAD}-
{DTE}-{ΔLEGS}-{STOP}` ALL-CAPS id builder + `STOP_CODES` vocabulary,
consumed as `@manage/instance-id` by the BE instance-create path.

## Scripts

| Script | Stage | Purpose |
|---|---|---|
| `strat-manage-instance-id-1542.ts` | id grammar | Asserts `@manage/instance-id` + `@manage/variant-catalog` alias resolution under tsx, grammar shape and normalization, template-order ΔLEGS, CUSTOM segment for ad hoc variants, seeded-variant uniqueness, mode⇒stop enforcement, and every fail-closed reject (multi-expiry, mismatched dte/template, hyphen smuggling, empty legs) |

### Usage

```bash
npx tsx scripts/verify/strat-manage-instance-id-1542.ts
```

No arguments, no environment variables, no Firestore access — a pure
generator over the seeded catalog.

**Pass:** every check prints `OK   name: value` and the script ends with
`=== ALL CHECKS PASSED ===` (exit 0).

**Fail:** the offending line prints `FAIL name: value` + an `expected:`
line; the script ends with `=== N CHECK(S) FAILED ===` (exit 1).

## Setup / teardown

None — read-only, no side effects.
