**Topic:** ST Firestore Reorg  
**Topic Slug:** st-firestore-reorg  
**Thread:** Data Plane Consolidation  
**Thread Slug:** data-plane-consolidation  
**Issue:** #995  
**Thread Parent:** #985  
**Topic Parent:** #984  
**Task:** #1000  
**Domain:** DATA-PIPELINE  
**Type:** CODE-REVIEW  
**Status:** Complete  
**Created:** 2026-10-15  
**Last Updated:** 2026-10-15  

# CODE REVIEW — BE-IMPL: st-signals upsert in SignalDateWriter, dual-write (#1000)

## Change set

- `functions/src/st-cloud-function/signal-date-writer.ts` — `persistBarDate` now upserts `st-signals/{SYM}_{barDate}_{signalType}` occurrence docs in the same batch as the legacy run-ids / signal-history / gate-date writes. Optional `{db, fieldValue, logger}` deps seam; symbol normalized to uppercase once in the constructor.
- `tests/functions/signal-date-writer.test.ts` — 8 specs: create shape, runIds append, same-runId dedupe, INTERIM→CONFIRMED upgrade with create-only provenance held, direction normalization, per-type fan-out, and two fail-soft pins (malformed entry skipped, failed existence read logged — legacy writes commit either way).
- `functions/scripts/verify/data-pipeline-st-signals-dual-write-1000.ts` — read-only prod parity audit; registered in `functions/scripts/verify/README.md`, `scripts/verify/run-all.ts` (`cwd: functions`, `needsAdc`), and `scripts/verify/README.md`.
- `functions/src/st-cloud-function/README.md` — three stale "legacy-only" descriptions + run-order list updated to mention `st-signals`.
- `functions/package.json` — spec registered under `test:st-signals` (14 specs total).

## Standards

PASS after fixes. `stSignalOccurrenceId`/`normalizeStSignalDirection` reused from `@st/ids`/`@st/signals` (no dup); symbol uppercased once in the ctor so the legacy subcollection path and canonical doc id can't diverge on case; batch stays atomic for everything that gets queued. The `fieldValue` seam is honored uniformly (legacy timestamp writes route through `this.fv`).

| Finding | Disposition |
|---|---|
| Verify script minted one expectation per run-id entry — intraday `INTERIM` + nightly `CONFIRMED` for the same occurrence guaranteed a false `MISMATCH` | **Fixed** — expectations collapse by occurrence id; `CONFIRMED` wins; runIds asserted as a set. Prod rerun: 775 entries → 247 unique occurrences |
| `st-cloud-function/README.md` still described the writer as legacy-only (3 spots + run-order list) | **Fixed** |
| `SignalDateWriterDeps` lacked JSDoc; `WriterDb` test type was an unreadable conditional; stray double blank line; missing `@topic` header tag; no root `scripts/verify/README.md` row | **Fixed** |

## Spec

PASS. All three issue criteria and IMPL §1 item 1 delivered:

- `st-signals/{SYM}_{barDate}_{signalType}` upserted alongside legacy writes — same batch.
- `runIds: arrayUnion(runId)` on re-detection; same-runId rewrite dedupes (spec-pinned).
- `INTERIM`/`CONFIRMED` resolved upstream via `stSignalStatusFromBarStatus` (`barStatus === 1` → CONFIRMED); writer carries `entry.status` through.
- `marketDate`/`sourceRunId`/`ticketIds`/`positionGroupIds`/`createdAt` create-only via pre-read (merge can't express set-if-absent).
- Canonical `StSignal` shape preserved; direction normalized `LONG`/`SHORT` → `TradeSide`.
- Legacy paths untouched and operational; no backfill / reader cutover / st-symbols gate mirror pulled in.
- Read-only prod parity audit delivered and exercised against prod.

## Thermo-nuclear

No Critical. Dispositions:

| Finding | Severity | Disposition |
|---|---|---|
| Fail-loud coupling — any throw in `writeStSignalDocs` (id validation on a malformed `barDate`/`_` symbol, or a transient `docRef.get()` failure) discarded the whole batch, zeroing run-ids/signal-history/gate-date writes for the group; Cloud Tasks retries would deterministically re-fail on bad input | Major | **Fixed** — per-entry fail-soft in `buildStSignalData` (bad entry logged + skipped, siblings unaffected) plus a wholesale try/catch around the st-signals path so legacy commits regardless; two new specs pin both failure modes |
| Verify script: correct `INTERIM → CONFIRMED` upgrade flagged as parity failure (same finding as Standards) | Major | **Fixed** — per-occurrence aggregation, most-resolved status wins |
| Concurrent-create TOCTOU — two overlapping runs can both take the create branch; last commit wins `marketDate`/`sourceRunId`/`status` (a late `INTERIM` commit could downgrade a `CONFIRMED` doc permanently) | Major | **Documented/accepted** — requires genuine run overlap on the same symbol+bar; callers are effectively serialized per symbol today, nothing reads `st-signals` during the dual-write window, and a transaction would trade away same-batch atomicity with legacy. JSDoc records the race; revisit at reader cutover (#1013 range) |
| Symbol case inconsistency — run-ids `symbol` field used raw `this.symbol`; canonical doc used `toUpperCase()` | Minor | **Fixed** — normalized once in the constructor |
| Weekly occurrence identity churn — SA re-dates the incomplete weekly bar each trading day, so a mid-week W signal's `barDate` is the fire-day and the occurrence can never reach `CONFIRMED` (state machine latches until delta<0; a re-fire mints a different `barDate`) | Minor | **Accepted/follow-up** — inherited from legacy signal-history, not introduced by #1000; flagged for a #984 follow-up (barDate normalization for W). Also noted: `signals.ts:67` claims the history doc id is "the week-open" — contradicts re-dating, worth correcting |
| Verify aborts unhandled on a malformed legacy entry | Minor | **Fixed** — per-entry try/catch → `MALFORMED` rows, counted in the verdict |
| `sourceRunId` marketDate cross-check silently skipped for W occurrences created earlier in the week | Nit | **Accepted** — by design (the source run's run-ids doc isn't in the audited date); audit is slightly weaker for W, noted in script intent |
| `normalizeStSignalDirection` can return `null` for out-of-enum input — writes `direction: null`, violating `StSignal` | Nit | **Accepted** — type-checked upstream; the audit flags it |
| `triggeredBy as any` in `signal-persister.ts` | Nit | Pre-existing, out of scope |

## Test results

- `test:st-signals` — **14/14** (8 writer specs incl. 2 new fail-soft pins, 6 `signalEntriesFromDoc` specs)
- `test:sds` — **81/81**
- `cd functions && npm run build` — green (`lib/index.js` ~1.8 MB)
- Prod audit (read-only, `2026-10-15`): 775 legacy entries → 247 unique occurrences, all `MISSING` — correct pre-deploy; flips to `PARITY OK` after deploy + one run

## Verdict

**PASS** — the original fail-loud defect (a canonical-path throw dropping the
entire legacy batch) is closed and spec-pinned, the verifier's guaranteed
false positive on the standard intraday→nightly lifecycle is closed, and the
remaining findings are documented/accepted at dual-write-window scope.
Ready for `/proj qa 984 1000`.
