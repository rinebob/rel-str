# Verify guide — strat-manage-variant-identity-1711

**Task:** #1711 — SHARED-IMPL: canonical variant ID grammar + display-name gen + CDS fix
**Pipeline stage:** canonical variant identity — `{SYM}-{SPREAD}-{DTE}-{ΔLEGS}-{STOP}` parse + structure-derived display name (the CDS name-segment shuffle fix)
**Credentials:** none — pure functions over the seeded catalog

## Scripts

| Script | What it proves |
|---|---|
| `strat-manage-variant-identity-1711.ts` | `parseManageInstanceId` recovers typed segments; generate→parse→name round-trips for every catalog variant; `variantDisplayName` derives the dte-first name from structure (stale stored `50-40 30` names render `30 50-40`); every derived name equals the stored catalog name; no duplicate names; malformed/dishonest inputs fail closed |

## Usage

```powershell
npx tsx scripts/verify/strat-manage-variant-identity-1711.ts
```

No arguments, no env vars, no Firestore, no credentials.

**Pass:** every line prints `OK`, footer prints `=== ALL CHECKS PASSED ===`, exit 0.
**Fail:** the offending check prints `FAIL` with actual + expected, footer prints the failure count, exit 1.

## Coverage notes

- The parse↔generate round-trip covers every seeded variant (40 entries at writing) across all six template families — CDS, PDS, CCS, PCS, NS, IC.
- The shuffle regression is pinned two ways: `variantDisplayName('SPY-CDS-30-50-40-ALL')` → `'call debit spread 30 50-40'`, and derived === stored for every catalog variant.
- Honest-failure checks: too few segments, non-integer DTE, unknown spread/stop codes, non-delta/zero/out-of-range ΔLEGS pieces, lowercase, CUSTOM-spread ids, STK-only ΔLEGS, unrenderable (NaN) deltas.
