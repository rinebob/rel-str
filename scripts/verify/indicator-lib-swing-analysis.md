# Verification Guide: Task #334 — Swing Analysis Store

## Overview

Verifies that `SwingAnalysisService` constructs valid Firestore paths and
that save → load round-trips preserve data. This is the test that the
store unit tests could not catch because they mocked
`@angular/fire/firestore` (see the mock-blindness lesson from the #334
code review).

## Scripts

| Script | Pipeline Stage | What it verifies |
|--------|---------------|-----------------|
| `indicator-lib-swing-analysis-store.ts` | Firestore path construction + round-trip | Collection path (3 segments), doc path (4 segments), save → getDoc → getDocs round-trip, cleanup |

## Usage

```bash
$env:NODE_PATH="functions/node_modules"
npx tsx scripts/verify/indicator-lib-swing-analysis-store.ts
```

No arguments needed. Uses Application Default Credentials — run
`gcloud auth application-default login` first if not already signed in.
`NODE_PATH` is required because `firebase-admin` lives in
`functions/node_modules`, not at the repo root.

## What a passing result looks like

```
=== SwingAnalysisService Firestore Round-Trip Verification ===
Project: rel-str
Test path: zig-zags/VERIFY-TEST/analyses/dev5-l5-r5-a1-p1

1. Verifying collection path construction...
   OK: zig-zags/VERIFY-TEST/analyses (3 segments — valid CollectionReference)
2. Verifying document path construction...
   OK: zig-zags/VERIFY-TEST/analyses/dev5-l5-r5-a1-p1 (4 segments — valid DocumentReference)
3. Verifying save → load round-trip...
   OK: wrote doc to zig-zags/VERIFY-TEST/analyses/dev5-l5-r5-a1-p1
   OK: getDoc round-trip preserves all fields
   OK: getDocs found 1 doc(s) in collection, test doc present
4. Cleaning up test document...
   OK: deleted zig-zags/VERIFY-TEST/analyses/dev5-l5-r5-a1-p1

=== ALL CHECKS PASSED ===
```

## What a failing result looks like

- **Path construction error:** `ASSERT FAILED: collection(): expected 3
  path segments, got 2` — the service is building an invalid path.
- **Round-trip mismatch:** `ASSERT FAILED: round-trip: symbol mismatch`
  — the data written doesn't match what was read back.
- **Permission error:** `7 PERMISSION_DENIED` — Firestore security rules
  block the write (expected if rules aren't deployed yet; see task #335).

## Notes

- The script uses a test symbol `VERIFY-TEST` and cleans up after itself.
- It writes to the **production** Firestore (no emulator). The test doc
  is deleted after verification, even on failure.
- This script is NOT part of the unit test suite — it hits real
  Firestore and must be run deliberately.
