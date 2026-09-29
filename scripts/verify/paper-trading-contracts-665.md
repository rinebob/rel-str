# Verify guide — #665 SHARED Trade Exits contracts

One credential-free script covering the #652 contract surface: status enum,
seeding defaults, terminal-family classification, callable shapes.

## Scripts

| Script | Covers | Credentials |
|---|---|---|
| `paper-trading-contracts-665.ts` | `CANCELLED` status, `trailing-8` defaults, `TERMINAL_VARIANT_FAMILIES`, close/cancel request/response shapes | none |

## Usage

```powershell
npx tsx scripts/verify/paper-trading-contracts-665.ts
```

**Pass:** all checks print `OK`, script exits 0 (`All checks passed.`).
**Fail:** offending check prints `FAIL` with detail; exit 1.

## Notes

- No Firestore/RH calls — pure contract assertions through the real shared
  modules (proving alias resolution + export shape).
- The stats-pass `CANCELLED` exclusion is covered by the node:test spec
  `tests/functions/paper-trading/paper-stats-pass.test.ts`, not by this
  script (it needs a Firestore seam).
