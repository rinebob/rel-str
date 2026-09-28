# Verification Guide — #637 SHARED lifecycle-tree contract

## Scope

Covers the pure-transform pipeline for the GitHub lifecycle viewer:
`parseInventoryGroups` against the real `docs/dev-notes/TOPICS-INVENTORY.md`,
then `buildTree` + `orderTopics` + `decodeLabels` on a GitHub-shaped payload.
Read-only — no credentials, no network beyond a local file read.

## Scripts

### `dev-tools-lifecycle-contracts-637.ts`

```bash
npx tsx scripts/verify/dev-tools-lifecycle-contracts-637.ts
```

No arguments. No credentials.

**Passing:** all checks print `PASS`, ends with `ALL CHECKS PASSED`, exit 0.
The group list is printed so you can eyeball that the real inventory parsed
(6 groups, ~24 topics at time of writing).

**Failing:** any `FAIL` line names the broken transform step; exit 1.
If `every group has ≥1 topic` fails, the TOPICS-INVENTORY.md row format has
changed — check the doc against the `TOPIC_ROW` regex in
`shared/lifecycle-tree.ts`.
