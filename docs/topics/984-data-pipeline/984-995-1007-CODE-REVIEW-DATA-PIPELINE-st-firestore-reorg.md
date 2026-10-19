**Topic:** ST Firestore Reorg  
**Topic Slug:** st-firestore-reorg  
**Thread:** Data Plane Consolidation  
**Thread Slug:** data-plane-consolidation  
**Issue:** #995  
**Thread Parent:** #985  
**Topic Parent:** #984  
**Task:** #1007  
**Domain:** DATA-PIPELINE  
**Type:** CODE-REVIEW  
**Status:** Complete  
**Created:** 2026-10-18  
**Last Updated:** 2026-10-18  

# CODE-REVIEW — #1007 collection renames (st-paper-trading, st-portfolio, st-backtest)

## Verdict: PASS (round 2)

Round 1 FAILED on three convergent majors (migrator regresses live data,
audit false-FAILs post-cutover, backtest mirror erases FE-owned fields).
All fixed; round-2 axes verified each remediation and caught one residual
defect introduced by the M2 fix (one-sided `feOwned` strip — `updatedAt`
is dual-owned, so a legacy-only strip guaranteed a WARN on every
backtest-runs doc → dead divergence channel). Strip is now symmetric.

### Round-2 fix verification

| Finding | Status |
|---|---|
| M1 migrator overwrite | FIXED — prefetch dest Map, deepEqual-skip identical, `skippedDivergent` + warn unless `--force`, commit outside per-doc try (bulk-counted on failure, no double-count), `--family` requires value, shared constants throughout, runbook header (deploy → migrate → audit; run outside live windows) |
| M2 audit false-FAILs | FIXED — `updatedAt` comparison for cutover families (canonical newer → WARN expected post-cutover write; not-newer → FAIL stale canonical); symmetric `feOwned` strip on `backtest-runs` (`archived`/`qualityDesignation`/`updatedAt` per rules carve-out) |
| M3 backtest mirror field erasure | FIXED — `set(after, {merge:true})` preserves FE-owned legacy fields; asymmetry documented (canonical field deletions don't propagate — accepted, nothing deletes them today) |
| Round-1 minors (12) | ALL FIXED — test wired (`test:collection-renames`), constants not literals, `--family` validation, `itemsPathFor` single router + `paperTradingDocPathFor` seam, inverted `ST_PORTFOLIO_ANCHORS` map + `Object.hasOwn`, trigger-path pins, never-throws tests w/ recording logger, `paperItemsRef` coverage, unordered-delivery risk documented, audit message corrected, stale comments updated, migrator added to tsconfig include |
| Round-2 residual | FIXED — symmetric `stripOwned`; batch-failure double-count; hoisted `destCol` ref; TOCTOU runbook note |

Remaining nits (accepted): `--family ''` edge case, per-doc `--force`
marker, duplicate-anchor collapse has no init assertion (upstream model
prevents it), fake-db shallow merge.

## Round 1

## Scope

Working-tree diff covering only the #1007 files (the tree also holds unrelated
in-flight work for #1076/#1077/#1078, #1024, #657 — excluded):

- `functions/src/paper-trading/collections.ts` — seam routes
  account/trade/stats/raw-quote → `st-paper-trading/{anchor}/items`;
  instances/cohorts/analysis-* deliberately stay on legacy `paper-trading`
- `functions/src/paper-trading/screenshot-lifecycle.ts` — carrier path →
  canonical trade doc
- `functions/src/st-cloud-function/backtest/backtest-collections.ts` —
  `BACKTEST_*_COLLECTION` constants → `st-backtest-*`
- `functions/src/portfolio/portfolio-mirror.ts` (NEW) — legacy→canonical
  soak trigger (FE writes `portfolio/{anchor}/items` directly)
- `functions/src/st-cloud-function/backtest/backtest-mirror.ts` (NEW) —
  canonical→legacy soak triggers (FE reads `backtest-*` directly)
- `functions/src/index.ts` — mirror exports
- `functions/scripts/migrate-collection-renames-1007.ts` (NEW) — 8-family
  copy migration, dry-run default
- `functions/scripts/verify/data-pipeline-collection-renames-1007.ts` (NEW)
  — parity audit, direction-aware severity + `run-all.ts`/`README.md`
  registration
- `tests/functions/collection-renames-1007.test.ts` (NEW) + legacy-path
  fixture updates in `repository.test.ts`, `screenshot-lifecycle.test.ts`,
  `paper-stats-pass.test.ts`
- Docstring touch-ups in `position-repository.ts`, `stats-repository.ts`,
  `trade-adapter.ts`

## Round-1 verdict: FAIL

Three convergent majors across all three axes — the migration tooling
regresses live data on rerun, the audit can never go green post-cutover,
and the backtest mirror can erase FE-owned fields. Task returns to
`5_IMPLEMENT`; fix and re-run `/proj review 984 1007`.

## Majors

### M1 — Migrator `set(merge)` overwrites diverging destination docs (all axes)

`functions/scripts/migrate-collection-renames-1007.ts:73-83` — when dest
exists and differs, stale source data is merged over it. Post-cutover,
canonical is live and legacy is frozen, so any rerun regresses fresh
canonical fields (marks, fills, stats). For backtest it also echoes the
regression back to legacy via the mirror. The header's "safe to rerun"
claim is only true while nothing advances canon-side.

**Fix:** never overwrite an existing, differing destination — skip +
warn (`skippedDivergent`), opt-in `--force` if stomping is ever wanted.

### M2 — Parity audit emits permanent false FAILs post-cutover (Standards, Thermo)

`functions/scripts/verify/data-pipeline-collection-renames-1007.ts:73-78`
— for `dir === 'cutover'` any source↔dest divergence is FAIL, but
post-cutover writes land canonical-only, so every updated migrated doc
diverges forever → exit 1 becomes noise and real copy-misses drown.

**Fix:** timestamp-aware comparison — `dest.updatedAt > src.updatedAt`
⇒ expected post-cutover write (WARN/silent); otherwise FAIL. #1006's
audit established the same drift classification.

### M3 — Backtest mirror wholesale `set` erases FE-owned legacy fields (Thermo)

`functions/src/st-cloud-function/backtest/backtest-mirror.ts:15,59` —
docstring claims the mirror solely owns the legacy side, but
`firestore.rules:244-249` grants authenticated clients `update` on
`backtest-runs/{runId}` limited to `['archived','qualityDesignation','updatedAt']`,
and `archived` is a live UI filter (`backtest-ui.store.ts:63`). A
wholesale `set(after)` deletes those fields on the next canonical write
and the two sides can never reconverge on them.

**Fix:** `ref.set(after, { merge: true })` for the canon→legacy direction
(the shadow only needs to be additive — nothing deletes fields on
canonical run docs), plus an `archived`/`qualityDesignation`/`updatedAt`
allowlist in the audit's backtest comparison. Portfolio direction keeps
wholesale `set` — verified mirror-only ownership, and merge would
reintroduce the #1003 field-deletion limitation.

## Minors (fix while open)

1. **New test file unwired** — `collection-renames-1007.test.ts` appears
   in no `functions/package.json` `test:*` script; every peer file is
   enumerated. Add to `test:paper-trading` or a new script.
2. **Scripts re-literalize legacy roots** — both new scripts inline
   `'paper-trading/accounts/items'`/`'portfolio/buckets/items'`/`'backtest-*'`
   instead of `paperTradingItemsPath(...)` and the mirrors' exported
   `LEGACY_*_ROOT` constants; `backtest-collections.ts:10` itself claims
   literals live in the mirror.
3. **`--family` with no value runs all families** — both scripts; with
   `--apply` that's an unintended full run. Validate and exit 2.
4. **Mid-loop `batch.commit()` inside per-doc try** — migrator: a commit
   throw counts as one failed doc while up to 400 pending writes die and
   subsequent `batch.set` calls cascade-fail. Move commit outside the try.
5. **`ANCHOR_KINDS` truthy lookup + duplicated anchor map** —
   `portfolio-mirror.ts:33,57` re-encodes `ST_PORTFOLIO_ANCHORS`; use
   `Object.hasOwn` (fails closed today via the try/catch, but logs error
   not warn) or invert the shared map.
6. **`screenshot-lifecycle.ts:83` bypasses the routing seam** — hardcodes
   `stPaperTradingDocPath(TRADE,…)`; the `ST_KINDS` decision now lives in
   two files. Export a path-level router from `collections.ts`.
7. **Duplicated `ST_KINDS` ternary** — `collections.ts:33-50`; collapse
   to a private `itemsPathFor(kind)`.
8. **No trigger-path literal pins** — `MIRROR_*_PATH` exports asserted
   nowhere; #1003 precedent has a dedicated describe block
   (`order-intents-migration.test.ts:514`). A typoed/odd-segment path
   deploys and silently never fires.
9. **Mirror out-of-order delivery risk undocumented** — triggers are
   at-least-once/unordered; a stale event can regress the shadow until
   the next source write. Self-healing + audit backstop makes it an
   accepted risk — say so in the docstrings like
   `order-intents-mirror.ts:17-21` does.
10. **Test gaps** — never-throws contract untested (no rejecting fake,
    null logger can't observe `logger.error`); `paperItemsRef` routing
    untested; attribution/permutation asserts are presence-only
    (`store.has`) vs sibling `deepEqual`.
11. **Audit message inverted for canon-to-legacy** —
    `data-pipeline-collection-renames-1007.ts:75` prints "no legacy
    counterpart" where the missing side is canonical.
12. Stale layout comments — `repository.ts:4`,
    `engine/collections.ts:5`, `screenshot-capture/tracking.ts:62`
    still describe `paper-trading/{anchor}/items` as the home.

## Nits

- `collection-renames-1007.test.ts:16` — unused `paperItemsRef` import;
  `(… as any).set()` casts away `DocumentReference`'s own `.set`.
- `backtest-mirror.ts:46` — type `legacyCollection` param as the union
  of the two constants.
- Trigger handlers: `{db: defaultDb, logger: defaultLogger}` passed
  explicitly though both fields default identically; three copies of the
  event-guard pattern — a small factory/`extractAfter` helper would
  dedupe.
- `Record<string, StPortfolioKind>` → `Partial<Record<…>>` for honest
  typing; `MIRROR_*_PATH` exports have no external consumer (keep for
  test pins — see minor 8).
- Migrator does sequential `destRef.get()` per doc — `db.getAll` chunking
  would cut wall time; perf-only, one-shot script.

## Verified clean

- Routing seam is the single choke point: every `functions/src` consumer
  flows through `paperItemsRef`/`paperDocRef`; zero legacy-path literals
  bypass it (cohorts/instances/analysis-* correctly stay legacy).
- Mirror topology is correct: even-segment trigger paths, right direction
  per family, deletes propagate, no trigger loops possible (no mirror's
  destination is another trigger's source).
- FE claims verified: `allocation-bucket.service.ts` writes legacy
  portfolio directly (mirror covers); `backtest-run.service.ts` reads
  legacy only; `PAPER_TRADING_INSTANCES` is the FE's sole direct
  paper-trading path — correctly out of scope until #1014.
- Wholesale `set` is the right call for the portfolio direction.
- Scripts match precedent conventions: `deepEqual` reuse, batch 400,
  dry-run default, per-doc failure accounting, exit codes.
- Spec accounting: all 8 in-scope families covered; `cohorts` deferral
  documented and user-approved (canonical home is `st-position-groups`,
  #1004); Phase-6 items 3-4 correctly belong to #1008/#1009.

## Test results

- `npm run test:collection-renames` — 23/23 pass (round 2; wired into
  `functions/package.json`)
- `npm run test:paper-trading` — 272/272 pass
- `npx jest shared/{paper-trading-ids,st-collections,analysis-dataset-contracts}.spec.ts` — 77/77 pass
- `tsx --test order-intents-migration.test.ts cohort-mapper.test.ts` —
  70/70 pass
- `functions` `tsc --noEmit` clean; `npm run build` clean
- `tests/tsconfig` carries pre-existing drift in `open-pass.test.ts` +
  `gh-lifecycle/callables.test.ts` (unmodified files — unrelated)
