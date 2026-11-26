# Verification Guide — #637 SHARED lifecycle-tree contract

## Scope

Covers the pure-transform pipeline for the GitHub lifecycle viewer:
`buildTree` + `decodeLabels` on a GitHub-shaped payload (contract v2,
#1522 — flat topic roots; inventory grouping removed in #1667).
Read-only — no credentials, no network.

## Scripts

### `dev-tools-lifecycle-contracts-637.ts`

```bash
npx tsx scripts/verify/dev-tools-lifecycle-contracts-637.ts
```

No arguments. No credentials.

**Passing:** all checks print `PASS`, ends with `ALL CHECKS PASSED`, exit 0.

**Failing:** any `FAIL` line names the broken transform step; exit 1.
