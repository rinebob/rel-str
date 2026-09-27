# Verify — #605 st-swing-configs config library

Exercises the real (prod) Firestore round-trip for the new slim config
documents (`st-swing-configs/{paramsId}`) that `SwingAnalysisService` now
writes. Admin SDK bypasses security rules — this verifies the data contract
and path validity, not auth (rules are reviewed by inspection + unit specs).

## Script

### `swing-analysis-misc-fixes-605-config-library.ts`

```powershell
NODE_PATH=functions/node_modules npx tsx scripts/verify/swing-analysis-misc-fixes-605-config-library.ts
```

**Requires:** Application Default Credentials (`gcloud auth application-default login`).
**Args/env:** none. Writes under paramsId `dev42_L2_R3_1barY_projY_trigN`,
deletes it at the end (self-cleaning).

**Pass output:** four `ok` lines (write, read-back + slim shape, idempotent
overwrite, userId-scoped list, delete + cleanup) ending `ALL CHECKS PASSED`.
**Fail output:** `ASSERT FAILED: {message}` + `VERIFY FAILED:` + exit 1.

Covered: doc-path validity, slim write shape (no snapshot fields), paramsId
dedupe/idempotent overwrite, name omission, userId-constrained list query,
delete. Not covered: security rules (admin bypasses) — verified by the rules
block mirroring `st-swing-sets` and by unit specs.
