# options-replay-position-rows-1493

Verification guide for **#1493 — SHARED Task: Position-row v2 schema + v1
narrowing shim** (Topic #1238 Options Backtest, Thread #1270 Multi-leg
Templates).

## What it verifies

The task's runtime-visible change: `shared/options-replay-contracts.ts`
gained the v2 row union (`ContractListPositionRow` +
`ContractListNoSelectionRow` with required `legMisses`), `schemaVersion: 2`
+ `legMetas` on `OptionsContractListDoc`, and the narrowing shim
(`v1PickToPosition` / `v1RowsToPositionRows` / `v1ListDocToV2`) that lets
readers see one schema while prod docs stay v1 until the writer task
lands. Three legs, all read-only:

1. **Doc narrow** — every `st-options-contract-lists` doc carrying
   `pickDocMeta` (the v1 marker) is narrowed via `v1ListDocToV2` and
   checked field-for-field: `schemaVersion` stamped 2, `legMetas` ===
   `[pickDocMeta]` verbatim, row count + kind mapping preserved, each
   position row's `legs[0]` carries all 12 `PickDocDay` fields + `side`
   verbatim with the doc's recorded coordinate stamped, each
   no-selection row gains `legMisses` naming leg 0's coordinate (+reason
   when known), and the passthrough fields (`runId`/`symbol`/`templateId`/
   `status`/`generatedAt`/`error`) survive untouched.
2. **Repeat normalization** — `repeatsPrevious` on a narrowed position is
   true iff the v1 row claimed it AND the previous output row is a
   position AND the legs still match — a gap, first row, or contractId
   change can never repeat.
3. **V2-aware** — a doc already carrying `schemaVersion: 2` is counted
   and skipped (already-v2); the shim must not re-mangle it.

## Usage

```powershell
cd functions
npx tsx scripts/verify/options-replay-position-rows-1493.ts [--run <runId>]
```

Needs ADC. Read-only — never writes.

## Flags

- `--run <runId>` — audit only the list doc with that id (docId IS the
  runId under single-symbol runs). A mistyped id warns "matched no list
  doc" instead of auditing everything; `--run` with no value is a usage
  FAIL.

## Pass

```
st-options-contract-lists audit: N list doc(s)
0 FAIL / 0 WARN — N v1 doc(s) narrowed (...), M already-v2
AUDIT PASS
```

Exit code 0.

## Fail

Any `FAIL {docId}: {detail}` line — e.g. a day field that doesn't survive
the narrowing, `legMetas` != `[pickDocMeta]`, a `repeatsPrevious` flag
that survived a gap or contract change. Exit code 1.
