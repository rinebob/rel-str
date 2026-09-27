# Verify: Portfolio Allocation Services (#586)

## `portfolio-allocation-586-roundtrip.ts`

Prod Firestore round-trip for the anchored allocation collections
(`portfolio/buckets/items`, `portfolio/attributions/items`). Admin SDK —
verifies the data contract + composite index coverage, not rules.

**Run:** `NODE_PATH=functions/node_modules npx tsx scripts/verify/portfolio-allocation-586-roundtrip.ts`
(needs `gcloud auth application-default login`)

**Passing:** 9 checks — bucket create/rename/retire, attribution
assign/group-move/unassign, `userId+accountNumber[+status]` composite
queries served (indexes live), linkKey group enumeration, cleanup.

**Failing:** any `ASSERT FAILED: …` prints the broken invariant; cleanup
docs live under account `VERIFY586` if a run dies mid-way (delete
`portfolio/buckets/items/VERIFY586_*` and `portfolio/attributions/items/VERIFY586_*`).
