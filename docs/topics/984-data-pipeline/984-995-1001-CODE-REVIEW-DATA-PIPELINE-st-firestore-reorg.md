**Topic:** ST Firestore Reorg  
**Topic Slug:** st-firestore-reorg  
**Thread:** Data Plane Consolidation  
**Thread Slug:** data-plane-consolidation  
**Issue:** #995  
**Thread Parent:** #985  
**Topic Parent:** #984  
**Task:** #1001  
**Domain:** DATA-PIPELINE  
**Type:** CODE-REVIEW  
**Status:** Complete  
**Created:** 2026-10-16  
**Last Updated:** 2026-10-16  

# CODE REVIEW — BE-IMPL: st-signals backfill from signal-history + run-ids, with parity audit (#1001)

## Change set

- `functions/scripts/backfill-st-signals-1001.ts` — one-shot migration folding legacy `signal-history` + `run-ids` subcollections into canonical `st-signals/{SYM}_{barDate}_{signalType}` occurrence docs. Pure exported core (`aggregateOccurrences`, `payloadForNew`, `payloadForExisting`, `updateForExisting`, `droppedSignalTypes`); chunked `getAll` existence reads (100/chunk); batch writes capped at 400; `--dry-run` / `--symbol` flags; per-symbol failure isolation; header warns to run outside live-run windows.
- `functions/scripts/verify/data-pipeline-st-signals-backfill-1001.ts` — read-only parity audit across ALL dates: missing/extra/mismatched/malformed per symbol, runIds ⊆/⊇ both directions + no dupes, status rules, direction, field identity, provenance checks.
- `tests/functions/st-signals-backfill-1001.test.ts` — 17 specs (31 total in `test:st-signals`).
- Registrations: `functions/package.json` (`test:st-signals`), `functions/scripts/verify/README.md` (table + run-order #24), `scripts/verify/run-all.ts`, `scripts/verify/README.md`.

## Standards

PASS after fixes. Canonical builders/readers reused (`stSignalOccurrenceId`, `normalizeStSignalDirection`, `signalEntriesFromDoc`, `ST_*` constants); no duplicated logic; upgrade-only merge semantics provenance-safe; per-symbol try/catch matches sibling `backfill-signal-history.ts`.

| Finding | Disposition |
|---|---|
| **Major** — `FieldValue.arrayUnion(...newRuns)` throws on zero elements when a status-only upgrade lands with no new runIds (reachable via the writer's fail-soft path); deterministic mid-run crash | **Fixed** — merge decision extracted to pure `updateForExisting`; `runIds` only emitted when non-empty; spec pins the empty-newRuns upgrade branch |
| History `sourceRunId` union loss — multiple history docs mapping to one bucket (weekly re-dating) kept only the last entry's `sourceRunId` | **Fixed** — `historyRunIds` set unions every recorded nightly run; spec added |
| No-`startedAt` provenance fallback picked the alphabetically-smallest runId over the recorded nightly `sourceRunId` | **Fixed** — recorded `sourceRunId` preferred when no run carries `startedAt`; spec added |
| No per-symbol failure isolation (sibling script wraps each symbol) | **Fixed** — try/catch per symbol, FAILED tally, non-zero exit |
| Merge-diff logic untested | **Fixed** — `updateForExisting` exported; spec covers all four branches |
| `--symbol` with no value silently ran all symbols | **Fixed** — exits 1 with an error |
| Vacuous test assertion (`createdAtIso` can never appear in a write payload) | **Fixed** — payload key-set pinned to `{status}`/`{}` |
| Audit let a garbage status pass on expected-INTERIM docs | **Fixed** — `status ∈ {INTERIM, CONFIRMED}` asserted |

## Spec

PASS. All issue criteria and IMPL Phase 1 §2 delivered:

- signal-history occurrences → `CONFIRMED`; run-ids-only occurrences → `INTERIM`; one canonical doc per `{symbol, barDate, signalType}` with runIds unioned across every detecting run.
- History payload wins for indicators/direction; `sourceRunId`/`marketDate`/`createdAt` from earliest first-detection; existing-doc provenance never overwritten.
- Verify reports per-symbol expected/missing/mismatched/extra/malformed; zero-dupes and zero-missing enforced via exit code.
- Dual-write compatibility verified field-by-field against `signal-date-writer.ts` (occurrence id from `entry.barDate`, status semantics, `arrayUnion` union, create-only provenance).

## Thermo-nuclear (adversarial)

PASS after fixes.

| Finding | Disposition |
|---|---|
| **F1 Major** — `b.history` presence forced CONFIRMED even when the entry itself is INTERIM. Verified real: `writeSignalHistoryDoc` writes every nightly entry unfiltered, so a W/M signal re-detected on an open bar lands in signal-history INTERIM; the audit shared the aggregator so it structurally could not see the corruption | **Fixed** — status now requires `history.status !== 'INTERIM'` (absent status on older generated docs still counts as confirmed — they carry the history doc's EOD semantics). Spec added |
| **F2 Major** — create-path race: literal `runIds` array, `ticketIds:[]`/`positionGroupIds:[]`, and literal `status` could clobber a racing dual-write create between `getAll` and commit | **Partially fixed** — `runIds` now written via `arrayUnion` (creates-if-absent, never drops a racing union). Residual: `status`/`ticketIds`/`provenance` remain merge-writes with a TOCTOU window — mitigation stays procedural (header warning: run outside live-run windows). Accepted: one-shot migration; nothing writes ticketIds/positionGroupIds yet |
| **F3 Major** — zero-arg `arrayUnion` crash | **Fixed** (same as Standards Major) |
| **F4 Major** — occurrence id minted from the signals-map key, not `entry.signalType`; key≠field drift mints a duplicate that never merges | **Fixed** — `e.signalType ?? key` matches the writer exactly |
| **F5 Major** — non-entry-shaped `signals.*` values silently dropped by the shared reader → unmigrated data with a clean audit | **Fixed** — `droppedSignalTypes` surfaces them as malformed in both backfill and audit; spec added |
| **F6 Major-conditional** — cross-source barDate divergence (run-ids week-open vs history fire-day) mints a permanent duplicate pair that passes audit | **Accepted residual** — no reliable in-code signal distinguishes divergence from legitimately different occurrences; dry-run + audit inspection is the operational check |
| **F7** — audit never compared `marketDate`/`sourceRunId`/`barDate`/`signalType`/`timeframe` values and missed `runIds` extras | **Fixed** — all added; sourceRunId/marketDate divergence reported (the F2-race signal); unexpected runIds flagged |
| **F8** — EXTRA false-positives if legacy docs are TTL-deleted or a live run intervenes | **Accepted/documented** — no TTL policy found in repo; audit is read-only and rerun-safe |
| **F9** — non-string `startedAt`/`marketDate` crash or verbatim write | **Fixed** — `str()` coercion at load + at use sites |
| **F10** — unnormalizable direction written as `null`; `sourceRunId:''` written for run-less occurrences | **Fixed** — both route to malformed instead of writing |
| Minor — `signals.ts:59,76` doc comments cite stale `symbol-meta` path | **Not fixed** — pre-existing, outside #1001 scope |

## Verification

- `cd functions && npm run test:st-signals` — 31/31
- `cd functions && npm run typecheck` — clean
- `cd functions && npm run build` — green (lib/index.js 1.8mb)
- Prod dry-run `--symbol ADPT` — 4 occurrences would create, malformed=0 (unchanged pre/post review fixes)
- Prod audit `ADPT` — expected=4 missing=4 mismatched=0 (missing is correct pre-backfill)
- Prod audit `AAPL` — expected=7 missing=7 incl. `AAPL_2026-08-26_W_ST_TREND_RIDER_V1_LONG` (weekly entry-level barDate path exercised)
- `--symbol` with no value — exits 1 (verified via flag guard)

## Round 2 (post-fix re-review)

Spec: **PASS** — all criteria still trace; the INTERIM-history gate adjudicated as the correct spec reading (writeSignalHistoryDoc writes unfiltered; gate verified against `stSignalStatusFromBarStatus`). Standards: **PASS** — all round-1 fixes verified, minors only. Thermo: **FAIL** — two must-fix plus minors:

| Finding | Disposition |
|---|---|
| **N1 Major** — create path still clobbered via literal status/ticketIds/positionGroupIds/provenance on a racing dual-write create | **Fixed (partial)** — existence reads interleaved per ~100-doc chunk with writes (TOCTOU shrinks from whole-symbol to one chunk + commit). Literal create fields remain — merge can't express set-if-absent; nothing writes ticketIds/positionGroupIds yet; freeze-window stays the operative mitigation |
| **N2 Medium** — status gate consulted only the last-wins history entry; a trailing INTERIM hid an earlier CONFIRMED | **Fixed** — `historyConfirmed` any-wins accumulator; spec added |
| **N3 Major** — audit guaranteed false-failures on legitimately live-created docs (provenance/runIds-extras/payload divergence) → couldn't certify post-backfill | **Fixed** — WARN/FAIL tiers: divergence consistent with live-created provenance + runIds extras report as warnings; only missing/dupes/bad-status/field-identity/missing-fields/EXTRA/malformed fail |
| **N4** — indicators never compared | **Fixed** — WARN tier |
| **N5** — unparseable `startedAt` won alphabetical first-detection | **Fixed** — `ts()` requires Date.parse-able; unparseable reported via new `notes` channel |
| **N6** — non-array `prior.runIds`/`doc.runIds` threw | **Fixed** — `Array.isArray` guards both files |
| **N7/N8** — `--symbol --dry-run` consumed a flag as value; `--symbol=X` silently ran all; audit positional arg had no validation | **Fixed** — `=` form supported, `--`/missing values rejected exit 1; audit mirrors + keeps positional compat |
| **N9** — EXTRA detection blind to docs missing/miscased `symbol` field | **Fixed** — added `FieldPath.documentId()` prefix scan unioned with the field query |
| **N10** — audit lacked per-symbol isolation | **Fixed** — try/catch → FAILED, exit 1 |
| **N11** — shared-aggregation blindness (audit reuses aggregator) | **Accepted** — certifies write fidelity, not aggregation correctness; documented in header |
| **N12** — live dual-write writes `status` literally every upsert → can downgrade post-backfill | **Out of scope** — flagged for #1013 (upgrade-only status in the live writer) |
| **N13** — scalar/array `signals` value dropped unreported | **Fixed** — `droppedSignalTypes` flags `(signals field itself)` |
| **N14** — doc-id vs entry.barDate divergence produced no signal | **Fixed** — `notes` channel prints re-dating info (non-failing — weekly re-dating is expected) |
| Standards minors — stale JSDoc on payloadForNew/payloadForExisting; missing specs for runIds-empty + coercion branches | **Fixed** — JSDoc corrected; +3 specs (34 total) |

## Round 3 (convergence check)

Adversarial pass on the delta: **PASS, no must-fix.** All round-2 fixes verified internally consistent (chunk flush/stats/dry-run, notes plumbing, WARN/FAIL classification, arg parsing, FieldPath usage). Remaining items cosmetic-only: stale header JSDoc line (**fixed**), `(minted undefined)` note phrasing when bucketFor fails, array-valued `signals` message quirk, non-string vs unparseable startedAt asymmetry in notes, no spec for the notes channel — all declined per scope discipline for a one-shot migration.

## Verdict

**PASS** — three review rounds converge: standards PASS, spec PASS, adversarial PASS with no must-fix findings. The actual prod backfill remains a deliberate post-QA step run outside live-run windows; nothing here writes to prod on its own.
