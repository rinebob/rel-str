# Verify — task #916: auto-paper shared contracts (stamps, scope ids, dedupe keys)

Thread #904 SHARED Blueprint. Two scripts: a credential-free contract check
and a read-only prod audit of the ingest's input data.

## `paper-trading-auto-paper-916-contracts.ts` (no credentials)

Exercises the new shared surface for real: `signalTradeDesc` → `EQ{V}{L|S}`
descs, `signalDedupeKey`, tradeId build/parse round-trip, all six
`statsScope*` builders + slug edge cases, `AUTO_PAPER_USER_ID` →
`acct-auto-paper`.

```bash
npx tsx scripts/verify/paper-trading-auto-paper-916-contracts.ts
```

Pass: all checks print `OK`, exits 0. Fail: `FAIL` line shows actual vs
expected, exits 1.

## `paper-trading-auto-paper-916-inputs.ts` (needs ADC)

Read-only prod audit of the data the ingest consumes. Finds the most recent
run with `createdOpportunity == true` jobs, reads a signaled symbol's
`run-ids/{runId}` doc and `symbols/{sym}` overview fields, checks the
user-scoped `symbol-lists/{uid}_PRIMARY` doc, and prints the derived
tradeId / signalId / scope ids.

```bash
cd functions && npx tsx scripts/verify/paper-trading-auto-paper-916-inputs.ts [runId]
```

Optional `runId` arg audits a specific run instead of auto-finding one.
Requires ADC. **No writes.**

Pass: all checks `OK` + derived ids print; exits 0. Fail: `FAIL` lines, or
"none in last 10 runs" if no signaling run is found — re-run after a
signaling day.

**Prod caveats this script caught during development** (encoded in the
IMPL doc): run-ids docs store entries as literal flattened `signals.{type}`
top-level keys (no nested `signals` map); overview fields live on the
`symbols` doc, not `symbol-meta`; symbol lists are user-scoped with
`key`/`symbols[]` fields.
