# Verification Guide — Options Pct Change Config Rules

## Task
Task #369 — Add Firestore rules for configs collection

## Scripts

### `options-pct-change-config-rules.ts`

Verifies the Firestore path `configs/option-chain-pct-change/configs/{configId}` is a valid 4-segment document path and that save → load → delete round-trips work against the real Firestore using the Admin SDK.

**Note:** This script uses the Firebase Admin SDK, which bypasses security rules. It verifies path construction and data round-trip only — not rule enforcement. Security rules are verified by deployment and manual testing against the client SDK.

**Command:**
```powershell
$env:NODE_OPTIONS="--require C:\Users\bob\.config\node\ipv4-only.cjs"
$env:NODE_PATH="functions/node_modules"
npx tsx scripts/verify/options-pct-change-config-rules.ts
```

**Arguments:** None.

**Setup:**
- Requires Application Default Credentials: `gcloud auth application-default login`
- Uses a test config ID `VERIFY-TEST-QQQ-2025-04-07-3-pct-change-abc123`
- Cleans up after itself (deletes the test document)

**Passing result:**
```
PASS: doc path has 4 segments (got 4): configs/option-chain-pct-change/configs/VERIFY-TEST-...
PASS: setDoc succeeded
PASS: getDoc returns the saved document
PASS: symbol round-trips: QQQ
PASS: targetType round-trips: pct-change
PASS: targetDates round-trips
PASS: pctValues round-trips
PASS: filter.type round-trips: call
PASS: collection list returns at least one document
PASS: document is gone after delete

All verification checks passed.
```

**Failing result:**
- Non-zero exit code with `FAIL:` or `Verification failed:` message.
- If path has wrong segment count: `FAIL: doc path has 4 segments (got N)`.
- If Firestore denies access: `Verification failed: 7 PERMISSION_DENIED`.
