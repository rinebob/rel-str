**Topic:** ST Firestore Reorg  
**Topic Slug:** st-firestore-reorg  
**Thread:** Data Plane Consolidation  
**Thread Slug:** data-plane-consolidation  
**Issue:** #996  
**Thread Parent:** #985  
**Topic Parent:** #984  
**Task:** #1019  
**Domain:** FE  
**Type:** CODE-REVIEW  
**Status:** Complete  
**Created:** 2026-10-28  
**Last Updated:** 2026-10-28  

# CODE REVIEW — #1019 signal readers → st-signals

## Verdict

**PASS** — two review rounds, converged. Round 1 remediated the
wiring/relay gaps; Round 2 (requested re-review) produced only
minors/nits plus judgment calls — all real items remediated and
re-verified (141 suites / 2,745 tests on the touched surface; relays
re-run green). No remaining critical/major findings. No further round
warranted — see Round 2.

## Round 2 — re-review findings and remediation

Re-run of all three axes against the post-r1 state (user-requested
repeat). No critical or major findings.

### Minor (all remediated)

- **`stSignalDocToItem` `symbol` hole** (`signal.service.ts`) — every
  field except `symbol` was strictly validated; a malformed doc
  emitted `undefined`. Now strict-validated like the rest.
- **Mapper comment misdescribed the contract** — claimed "same strict
  contract as the legacy entry parser," but legacy *skipped* malformed
  entries while the new mapper *throws*. Comment corrected to state
  the deliberately-stricter contract (see judgment call below).
- **Relay B floor counted symbols, not entries** — `--symbol X` for a
  symbol absent from the run yielded "1 symbols identical" on zero
  entry evidence. Added an entry-count floor: B fails when zero
  entries were compared.
- **918 relay silent-drop + literal drift** — `if (!dir) continue`
  silently dropped unmappable directions (deployed warns) and compared
  `dir === 'long'` against a string literal. Now warns like the pass
  and compares `TradeSide.LONG`/`SHORT`.
- **signalType-keyed collapse was nondeterministic** — `getSignals`
  (and the 918 mirror) collapse `out[signalType]` last-wins over an
  unordered snapshot; if a run ever produces one signalType on two
  barDates, which survives was unspecified (legacy's last-commit order
  was equally racy, so this is a determinism *improvement*, not a
  regression). Both sides now sort `barDate` asc → last-wins = newest
  occurrence, deterministically.
- **`run-all.ts` ordering nit** — `readers-1019` sat between 1001 and
  1002 in both registries; moved to numeric position after 1013.

### Judgment calls (documented, accepted)

- **Throw-on-malformed vs legacy skip** (Spec). Legacy
  `parseSignalEntry` silently skipped malformed entries; the new
  mapper throws, so one corrupt doc fails the whole read rather than
  returning the good subset. Kept deliberately: `st-signals` is the
  sole record and a malformed doc is a writer bug — the same fail-loud
  posture the writer's fail-hard change adopts. The #1001 audit
  already proves zero malformed docs today.
- **Mixed provenance in `getSymbolSignalsForRun`** (Standards) —
  `runId` = the queried run while `marketDate` = create-only
  first-detection date; a re-detected W signal can report a pair from
  different runs. Correct semantics — `marketDate` is first-detection
  by contract; noted for consumers.
- **`stGetSymbolSignalHistory` `runId: d.sourceRunId` unvalidated**
  (Thermo nit) — can emit `undefined` on a malformed doc, unlike the
  FE reader. Accepted: the callable has no FE caller and `sourceRunId`
  is a required field on `StSignal`.
- **Direction normalization in two patterns** (Thermo nit) —
  `normalizeStSignalDirection` + enum map at the write/ingest sites,
  `.toUpperCase()` + enum validation at the read sites. Both enforce
  their target enum; a shared helper would couple FE/BE for two lines.
- **Relay B compares key sets, not field content** (Spec) — accepted:
  field-level content equivalence is the #1001 audit's job, which is
  green.
- **Rules diff exceeds the named subcollections** (Spec) — also
  strikes `savant-trader/data/runs` + `signal-dates`/`signals` blocks.
  Verified: the `runs` root was deleted at #1159 ship (0 docs
  confirmed post-delete); `signal-dates`/`signals` are unrelated
  rh-agent legacy, already deleted. Intended deny-by-default cleanup.

### Round-2 verification

- `tsc --noEmit` — clean on all touched files (3 pre-existing baseline
  errors in unrelated unmodified files: `bulk-swing-sweep.ts`,
  `indicator-config-dialog.component.ts` — same baseline as #1017).
- Touched-surface suites: **141/141 suites, 2,745 tests** pass
  (`signal-date-writer`, cutover pin, rules/indexes, all of
  `src/app/features/savant-trader`).
- Relays re-run green post-fix: readers-1019 A/B/C (119 symbols, 10
  entry sets, 64 history entries covered, +80 INTERIM) and
  `paper-trading-auto-paper-918` ALL CHECKS PASSED.
- Index coverage confirmed: `(symbol, runIds CONTAINS)` for
  run-scoped reads; `(symbol, barDate DESC)` pre-exists for the
  ordered history read; bare `array-contains` needs no composite.

**Round-3 verdict: not needed.** Round 2 surfaced only minors and
judgment calls; everything real was fixed and re-verified. A further
pass would re-polish the same surface — scope discipline says stop.

## Change surface

Working-tree diff vs `HEAD` (uncommitted at review time). Deployed
code:

- **Writer** — `signal-date-writer.ts` writes `st-signals` occurrences
  + `st-symbols` gate fields only; `run-ids`/`signal-history` legs
  removed; fail-soft → fail-hard (a skipped write is now silent data
  loss, since `st-signals` is the sole record). `signal-persister.ts`
  signature slimmed (dead `runStartedAt`/`triggeredBy` params dropped);
  `worker.ts` call site updated.
- **BE readers** — `dashboard-callables.ts`: `stGetSymbolsWithSignals`
  → `st-signals` (`runIds array-contains runId`) + `st-symbols`
  profiles; `stGetSymbolSignalHistory` → flat `st-signals` by symbol
  (`barDate desc`).
- **Auto-paper** — `auto-paper-ingest-pass.ts` `getSignals` →
  `st-signals` (`symbol` + `runIds array-contains`), canonical
  lowercase direction normalized via `normalizeStSignalDirection` back
  to `StSignalDirection`; unmappable values warn + skip (no guessing).
- **FE readers** — `signal.service.ts`: `getSymbolSignalsForRun` →
  `symbol == X AND runIds array-contains`; history read → `symbol == X
  ORDER BY barDate DESC`; strict canonical mapper validating barDate /
  signalType / marketDate / timeframe / direction / status /
  indicators; `id: barDate` preserved; canonical status carried
  (INTERIM now visible — the intended feature gain).
- **Infra** — `Collection.ST_SYMBOLS` retired from `constants.ts`;
  composite index `st-signals (symbol ASC, runIds CONTAINS)` added;
  legacy rules blocks removed → deny-by-default; legacy subcollection
  constants demoted to scripts-only in `st-collections.ts`.
- **Tests** — `st-runs-symbols-cutover-1159.test.ts` pin rewritten to
  the #1019 end-state (zero legacy-path references in deployed code);
  `signal-date-writer.test.ts` updated to sole-write/fail-hard
  semantics; `firestore-rules-indexes-1012.test.ts` pins the new
  composite index; `st-path-cutover-1014.spec.ts` retired-members list
  updated.
- **Verification** — new relay
  `functions/scripts/verify/data-pipeline-st-signals-readers-1019.ts`
  registered in both `run-all.ts` files and both verify READMEs as a
  pre-delete gate; `paper-trading-auto-paper-916-inputs.ts` and
  `-918-ingest.ts` repointed off `run-ids` to `st-signals` so they
  mirror the path deployed code actually uses.

## Standards

- No hard violations introduced by the diff. Naming, module
  boundaries, batch semantics (one batch for occurrence + gate
  writes), and failure behavior all conform.
- `isSignalTimeframe` strict-throws on canonical `'M'` (canonical
  `StSignalTimeframe` allows `D|W|M`) — **minor/latent**: no `M_`
  signal types exist today (per the signal-type audit), so no doc can
  carry it. Flag; fix if monthly signals are ever introduced.
- `invoker: 'public'` / `cors: true` on the dashboard callables —
  verified **pre-existing** config, not in this diff. Left untouched
  (security-policy change is a separate decision).
- Mojibake (`â€”`) in `signal.service.ts` comments — **pre-existing**,
  not in diff.

## Spec

Clean on coverage. Every AC mapped:

- Writer → `st-signals` + `st-symbols` only; legacy legs gone;
  fail-hard. ✅
- `stGetSymbolsWithSignals` → `runIds array-contains` + `st-symbols`
  profiles. ✅
- `stGetSymbolSignalHistory` → flat `st-signals` by symbol. ✅
- Auto-paper ingest → canonical occurrences, direction mapped back to
  the enum the fill path expects. ✅
- FE readers → `st-signals`; `id` = `barDate` semantics preserved;
  `closePrice` still derived from local bars by `enrichClosePrices`
  (canonical `StSignal` has no close field — by design). ✅
- `Collection.ST_SYMBOLS` retired; composite index added; rules
  deny-by-default; relay registered as pre-delete gate in all four
  places. ✅

No scope creep found. The `#1001` backfill repair (6,476 docs created,
155 merged, 0 malformed — see UAT/results below) was required to make
the reader-equivalence gate truthful; it used the established
merge-only, idempotent tool.

## Thermo-nuclear

Three real findings — all remediated and re-verified:

- **Relay B could pass vacuously.** `--sample <garbage>` →
  `symbols.slice(0, NaN)` → empty sample → "0 identical" green;
  header comment also claimed C reuses only the first symbol while it
  iterated the whole sample. Fixed: sample floor (B fails on an empty
  sample), C iterates all sampled symbols, non-empty evidence floors
  on A/B/C so an empty legacy source cannot produce a false green.
- **`paper-trading-auto-paper-916/918` relays still read legacy
  `run-ids`.** They mirror the deployed ingest's input — after this
  cut they verified a path deployed code no longer uses, and would
  lose their evidence source at deletion. Repointed to `st-signals`
  (same `symbol` + `runIds array-contains` query, canonical direction
  normalized); both re-run green against prod.
- **Silent direction skip in `getSignals`.** An unmappable canonical
  direction was dropped without a trace. Fixed: `logger.warn` on skip
  + canonical normalization via `normalizeStSignalDirection` instead
  of a hand-rolled comparison.

### Advisory / flag-only (documented, not blocking)

- `stGetSymbolSignalHistory` still accepts `timeframe` but does not
  filter on it — **pre-existing** (documented in an earlier review);
  it also has no FE caller now (FE reads `st-signals` directly). Kept
  repointed rather than deleted — removing a callable is an
  API-surface decision for ship time.
- Legacy `savant-trader/data/symbols` collectionGroup indexes become
  dead weight after the parent delete — remove at ship-time cleanup,
  not now (they're needed until the pre-delete gates finish).
- `StSignalItem.id` cosmetic inconsistency noted — no consumer uses
  it; `id: barDate` matches prior semantics.
- The `#1000` dual-write and `#1001` backfill relays read legacy paths
  by design — they remain registered as pre-delete gates and will fail
  by design after the symbols parent is deleted (same lifecycle as the
  #1159 relay).
- `firestore.rules` comment says the legacy root is "deleted at #1019
  ship" — forward-dated wording matching the #1159 comment convention.

## Test results

- `cd functions && npm run build` / `tsc --noEmit` — clean.
- Full Jest suite — **275/275 suites, 4,746 tests pass** (one
  pre-existing worker force-exit warning; recurring, not introduced).
- Targeted suites green: signal-date-writer 34, cutover pin 7,
  rules/indexes 14, FE signals/store 60.
- Production relays (run 2026-10-28):
  - `#1000` dual-write — 184/184 occurrences, 0 missing/mismatch/malformed.
  - `#1001` backfill audit — all 926 symbols `missing=0, mismatched=0,
    extra=0` (PARITY OK; ~90 benign provenance/`indicators` warnings).
  - `#1019` reader-equivalence — `2026-10-28_wed_123314_pdr`: 157
    run-scoped symbols identical, 10 entry sets identical, 60 history
    entries covered, +98 INTERIM new coverage;
    `2026-10-28_wed_141843_nightly`: 119 symbols identical, 10 entry
    sets identical, 64 history entries covered, +80 INTERIM.
  - `paper-trading-auto-paper-916` — green on canonical reads.
  - `paper-trading-auto-paper-918` — ALL CHECKS PASSED (119
    candidates, 210 PRIMARY members, 9 work items).
- Doc-level spot check: ABT occurrences previously missing
  (`2026-08-27`, `2026-09-03`, `2026-10-15`) now exist as `INTERIM`,
  matching the legacy records' own status.

## Production data repair (context)

The reader-equivalence relay exposed a real coverage gap mid-task:
~6.5k occurrences existed only in legacy `run-ids` — entries detected
in the window between the original #1001 backfill apply and the
dual-write deploy reaching prod. Repaired with the established #1001
backfill tool: `created=6,476, updated=155, unchanged=1,813,
malformed=0` (merge-only, idempotent, provenance preserved). Note for
the record: the tool applies by default (`--dry-run` is opt-in) — the
repair was launched during what was intended as a dry run; the writes
were the correct, intended repair and all three relays now prove
parity.

## Residual ship-time items

1. Deploy functions → post-deploy write check (new run's signals land
   only on `st-signals`/`st-symbols`).
2. Re-run readers-1019 + #1000/#1001 relays against post-deploy data.
3. Archive + delete `savant-trader/data/symbols` (926 docs +
   `run-ids`/`signal-history` subcollections) — destructive, needs
   explicit approval.
4. Remove the legacy `symbols` collectionGroup index entries
   post-delete; strike the legacy-reading relays from `run-all.ts`
   (same lifecycle as #1013/#1159).
