**Topic:** ST Firestore Reorg  
**Topic Slug:** st-firestore-reorg  
**Thread:** Data Plane Consolidation  
**Thread Slug:** data-plane-consolidation  
**Issue:** #1045  
**Thread Parent:** #985  
**Topic Parent:** #984  
**Task:** #1000  
**Domain:** DATA-PIPELINE  
**Type:** UAT  
**Status:** Complete  
**Created:** 2026-10-15  
**Last Updated:** 2026-10-15  

# UAT — BE-IMPL: st-signals upsert in SignalDateWriter, dual-write (#1000)

## Scope

Canonical `st-signals` dual-write in `SignalDateWriter.persistBarDate`:

- Upsert `st-signals/{SYM}_{barDate}_{signalType}` alongside the legacy
  run-ids / signal-history / gate-date writes in one Firestore batch
- `runIds: arrayUnion(runId)` on re-detection; `status` carries the upstream
  barStatus resolution; `marketDate`/`sourceRunId`/`createdAt` create-only
- `direction` normalized LONG/SHORT → `TradeSide`; `ticketIds` /
  `positionGroupIds` initialized empty
- Fail-soft: malformed entry or failed existence read is logged + skipped —
  the legacy batch still commits (dual-write window; legacy is source of
  truth until #1013 reader cutover)
- `{db, fieldValue, logger}` dependency seam; symbol uppercased once in ctor
- `functions/scripts/verify/data-pipeline-st-signals-dual-write-1000.ts` —
  read-only prod parity audit (registered: functions README + run-order,
  root `scripts/verify/run-all.ts` + README)

Acceptance criteria (from #1000 + IMPL §1): all of the above, plus no
backfill / reader cutover / st-symbols gate-mirror scope creep, unit tests
covering create / re-detection / dedupe / nightly upgrade / direction /
per-type fan-out, and the parity audit delivered.

## Prerequisites

- Repo at `C:\aa\projects\rel-str`, node_modules installed.
- S5 requires Application Default Credentials (`gcloud auth
  application-default login`) — the audit is read-only.

## Scenarios

### S1 — Dual-write spec suite

**Confirms:** occurrence-doc create shape, runIds append + dedupe,
INTERIM→CONFIRMED upgrade with create-only provenance held, direction
normalization, per-signalType fan-out, and both fail-soft modes (malformed
entry skipped, failed read logged — legacy writes commit either way).

```
cd functions && npm run test:st-signals
```

**Expected:** 14/14 pass (8 writer specs + 6 `signalEntriesFromDoc`).

**Result:** PASS — 14/14.

### S2 — SDS consumer regression

**Confirms:** the writer change doesn't break the SDS pass family that
drives `persistBarDate` upstream.

```
cd functions && npm run test:sds
```

**Expected:** 81/81 pass.

**Result:** PASS — 81/81.

### S3 — Build + typecheck

**Confirms:** BE compiles through the new `@st/ids`/`@st/signals` imports and
the `firebase-functions/v2` logger.

```
cd functions && npm run build && npm run typecheck
```

**Expected:** esbuild bundle green, `tsc --noEmit` clean.

**Result:** PASS — bundle green (`lib/index.js` ~1.8 MB), typecheck clean.

### S4 — Functions-tree sweep

**Confirms:** no regression across the whole `tests/functions` tree.

```
cd functions && npx tsx --test ../tests/functions/**/*.test.ts
```

**Expected:** all pass except documented pre-existing failures.

**Result:** PASS — 399/401. Both failures are in
`tests/functions/options-strategy-engine/stats-repository.test.ts`
(cumulative-P&L assertions `180 !== 120`) — committed code from
`5282a734` (Topic #942 options stats repo), untouched by #1000 and
failing at HEAD; unrelated to this task.

### S5 — Production parity audit (read-only)

**Confirms:** the audit enumerates expected occurrences from `run-ids` for a
marketDate, aggregates per occurrence (intraday `INTERIM` + nightly
`CONFIRMED` collapse to one row, most-resolved wins), and checks existence,
`runIds` membership/dedupe, status, direction, and create-only provenance.

```
cd functions && npx tsx scripts/verify/data-pipeline-st-signals-dual-write-1000.ts 2026-10-15
```

**Expected (pre-deploy):** enumerates run-ids, aggregates to unique
occurrences, reports all `MISSING` — correct since the dual-write isn't
deployed yet; flips to `PARITY OK` after deploy + one run.

**Result:** PASS — `775 legacy entries → 247 unique occurrences`,
`ok=0 missing=247 mismatched=0 malformed=0`. Aggregation correct (775 →
247 collapse shows per-occurrence dedup working); `MISSING` verdict is the
correct pre-deploy state. Exit 1 as designed.

### S6 — Fail-soft behavioral check

**Confirms:** an entry whose id segments fail validation (e.g. a corrupt
upstream `barDate`) does NOT zero the legacy batch — covered by spec in S1
(`fail-soft: a malformed entry is logged and skipped — legacy writes still
commit`, `fail-soft: a failed existence read logs without aborting the
batch`).

**Result:** PASS — both specs green; `logger.error` exercised via the
injected logger seam.

### S7 — Scope check

**Confirms:** no backfill, reader cutover, or `st-symbols` gate-mirror work
crept into the diff.

**Result:** PASS — diff touches only `signal-date-writer.ts`, its test, the
verify script, README registrations, and `package.json` script entry.

## Traceability

| Acceptance criterion | Scenario |
|---|---|
| `st-signals/{SYM}_{barDate}_{signalType}` upserted alongside legacy writes | S1, S5 |
| `runIds` arrayUnion on re-detection; dedupe | S1 |
| `INTERIM`/`CONFIRMED` from barStatus; nightly upgrade | S1 |
| `marketDate`/`sourceRunId`/`createdAt` create-only | S1 |
| `direction` → TradeSide; `ticketIds`/`positionGroupIds` empty init | S1 |
| Legacy paths operational during dual-write (incl. fail-soft) | S1, S4, S6 |
| No backfill / cutover / gate-mirror scope | S7 |
| Read-only prod parity audit delivered + registered | S5 |

## Refinement pass

Not applicable — no user-facing surface (backend writer + audit script).

## Findings

None blocking. Carried forward as documented watch items (not findings):

- TOCTOU on the create-only provenance fields — accepted for the
  dual-write window (no readers yet); revisit at #1013 reader cutover.
- Weekly-bar `barDate` identity churn (inherited from legacy) — W
  occurrences may never reach `CONFIRMED`; flagged for a #984 follow-up.
- `signals.ts:67` comment claims history doc id is "the week-open" —
  contradicts SA re-dating behavior; worth correcting in a follow-up.
