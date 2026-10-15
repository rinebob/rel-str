**Topic:** ST Firestore Reorg  
**Topic Slug:** st-firestore-reorg  
**Thread:** Data Plane Consolidation  
**Thread Slug:** data-plane-consolidation  
**Issue:** #994  
**Thread Parent:** #985  
**Topic Parent:** #984  
**Task:** #997  
**Domain:** DATA-PIPELINE  
**Type:** CODE-REVIEW  
**Status:** Complete  
**Created:** 2026-10-15  
**Last Updated:** 2026-10-15  

# CODE REVIEW — SHARED-IMPL: st- collection path constants (#997)

## Change set

- NEW `shared/st-collections.ts` — canonical `st-` roots + anchored-kind path helpers, consumed as `@st/collections` by both tsconfigs
- NEW `shared/st-collections.spec.ts` — 10 specs
- EDIT `tsconfig.json`, `functions/tsconfig.json`, `jest.config.js` — alias wiring
- EDIT `functions/src/common/st-collections.ts` — `export * from '@st/collections'` re-export
- NEW `scripts/verify/data-pipeline-st-collections-997.{ts,md}`; `run-all.ts` + `README.md` registration

## Standards

No hard violations. `st-` domain prefix and `{domain}/{kind-anchor}/items/{id}` anchor pattern conform to AGENTS.md collection conventions; segment parity correct everywhere; `@st/collections` alias matches the `@paper-trading/ids` precedent; `export *` has zero name collisions (`*_ROOT` vs legacy `*_COLLECTION` namespaces are disjoint).

Judgement calls noted: anchor-triad pattern now instantiated 3× (a 4th should trigger a generic helper); `*_ROOT`/`*_COLLECTION` twins coexist during migration (documented in header comment — flagged as an autocomplete footgun for cutover tasks); `stJobsPath` renamed → `stRunJobsPath` (fixed during review).

## Spec

All 11 IMPL §1 path entries present with correct anchors; `instances`/`cohorts` correctly dropped from `StPaperTradingKind` (moved to `st-strategy-instances`/`st-position-groups`); the shared-alias approach satisfies the "FE mirror" AC via the single-source pattern the IMPL doc explicitly preferred. No scope creep; verify script + registration match repo convention.

## Thermo-nuclear

No critical/major. Minors: verify script ~90% mirrors the spec (accepted — its distinct job is proving `@st/collections` resolves under tsx, which it does: executed, all OK); anchored-pair duplication (matches `paper-trading-ids.ts` precedent); no `/`-guard in doc-path helpers (matches precedent); 2-kind enum for portfolio (uniformity kept).

## Test results

- `shared/st-collections.spec.ts`: 10/10 pass.
- `scripts/verify/data-pipeline-st-collections-997.ts`: all checks OK (alias resolves under tsx).
- `functions` esbuild bundle: green.
- Full suite: 2 pre-existing suite failures (43 tests) in `screenshot-capture-contracts.spec.ts` and `order.component.spec.ts` — both in committed code untouched by this task (verified: files clean in `git status`, no import path to the change). Not attributable to #997.

## Re-review (2026-10-15, second pass)

Deeper pass produced one major + several minors; all fixed in-task:

- **MAJOR (fixed)** — legacy/new namespace twins unmarked (`ST_RUNS_COLLECTION` beside `ST_RUNS_ROOT` etc.). Added `@deprecated` JSDoc with successor pointers + removal task (#1013) on all eleven legacy constants in `functions/src/common/st-collections.ts` — IDE strike-through at every call site during the dual-write window.
- **Minor (fixed)** — `export *` silent-shadow risk: replaced with an explicit re-export list (matches the file's `ST_SCREENSHOTS_COLLECTION` precedent; fails loudly on collision).
- **Minor (fixed)** — enum boundary: `stPaperTrading*` helpers now accept `PaperTradingKind` as well as `StPaperTradingKind` (cast-free dual-write seam); instance/cohort throw explicitly instead of producing `undefined` paths.
- **Minor (fixed)** — added `stRunJobDocPath` for symmetry with the anchored helpers.
- **Nit (fixed)** — `not.toContain('instance')` replaced with exact sorted kind-list assertion; added cross-module parity pins (`st-paper-trading` mirrors legacy anchors; `st-portfolio` vs `PORTFOLIO_BUCKETS_COLLECTION`).
- **Nit (fixed)** — header scope note: file covers reorg roots only; `st-screenshots`/`st-swing-*` stay in their own contract modules. `was order-intents` / symbols-meta merge documented on constants.
- **Accepted as-is** — verify script/spec overlap (distinct job: tsx alias resolution); 2-kind portfolio enum (uniformity); no `/`-guard in doc-path helpers (matches `paperTradingDocPath` precedent).

## Test results (re-review)

- `shared/st-collections.spec.ts`: 14/14 pass (4 new: doc path, legacy-kind acceptance, throw guard, drift pin).
- Verify script: all checks OK. `functions` esbuild: green.
- Full suite: same 43 pre-existing failures in the same 2 suites — confirmed unchanged and unrelated.

## Re-review pass 3 (2026-10-15, deeper checks)

Third pass on the updated change set; findings and resolutions:

- **Medium (fixed)** — `StPaperTradingPathKind` union admitted guaranteed-throw values. Explored `Exclude<PaperTradingKind, INSTANCE|COHORT>` for compile-time rejection — rejected: it makes legitimate filtered-iteration code need banned casts and blocks testing the runtime guard. Kept plain union + loud runtime throw (documented in the type's JSDoc).
- **Minor (fixed)** — `'jobs'` literal duplicated across layers: `stRunJobsPath` hardcoded it while `ST_JOBS_SUBCOLLECTION` held it. Single source now `ST_JOBS_SUBCOLLECTION_NAME` in shared; the legacy constant delegates to it.
- **Minor (fixed)** — `StPaperTradingPathKind` missing from the functions barrel re-export (added as `export type`, plus `ST_CONFIG_STATUS_DOC`/`ST_JOBS_SUBCOLLECTION_NAME`).
- **Minor (fixed)** — deprecation gaps: FE `Collection` enum members now carry `@deprecated` markers (was BE-only); `AGENT_STATUS_DOC` successor got a real constant (`ST_CONFIG_STATUS_DOC`); `PAPER_TRADING_INSTANCES` marked too.
- **Nits (fixed)** — `as unknown as` casts removed (cast-free kind filtering); mid-file `import type` hoisted; `stRunJobDocPath` uppercases symbol + documents no-`/` precondition; attribution anchor pinned alongside bucket; COHORT added to throw checks.
- **Accepted as-is** — `cleanup-st-occurrence-decisions.ts` hardcoded legacy path (delete-only sweeper, dies with the collection); 82 internal deprecated-constant uses inside functions (intended — dual-write window; IDE strike-through is the signal).

## Test results (pass 3)

- `shared/st-collections.spec.ts`: 14/14 pass; `src/app/core` suites: 306/306 pass (FE enum deprecation comments compile clean).
- Verify script all-OK; `functions` esbuild green.

## Re-review pass 4 (2026-10-15)

All three axes converged on one real gap; fixed:

- **Minor (fixed)** — `ST_CONFIG_STATUS_DOC='status'` was unpinned everywhere (a renamed doc id, `current`→`status`, where a typo is silent). Now pinned literally in both spec and verify script, plus `ST_JOBS_SUBCOLLECTION_NAME` and the `ST_JOBS_SUBCOLLECTION` barrel delegation.
- **Nit (fixed)** — stale `AUTO_PAPER_CONFIG_DOC` JSDoc (said "under trading-config" — moves to `st-config/autoPaper`); stale barrel header didn't mention the re-export surface.
- **Nit (attempted, reverted)** — `kind in ANCHORS` cast-free narrowing: TS does not narrow enum-membered Records through `in`; kept the lookup-then-check form.
- **Noted for cutover tasks (not this task's scope)** — FE raw literals the enum markers can't reach: `run.service.ts` hardcodes `'savant-trader/data/status/current'`, `signal.service.ts` hardcodes `'run-ids'`/`'signal-history'` subcollection names.

All axes otherwise clean: delegation import verified value-import + esbuild-resolvable; no import cycles; FE `@deprecated` coverage confirmed exactly right (8 members + `PAPER_TRADING_INSTANCES`; `ST_SCREENSHOTS` correctly unmarked); drift pins independently sourced (not mirror-of-self).

## Test results (pass 4)

- `shared/st-collections.spec.ts`: 15/15; shared/ + `src/app/core` sweep: 949/950 — sole failure the same pre-existing `screenshot-capture-contracts` PositionType spec (other workstream's committed drift, untouched by this task).
- Verify script: 65/65 checks OK including new pins + barrel delegation; `functions` esbuild green.

## Re-review pass 5 (2026-10-15)

- **Minor (fixed)** — anchor guard bypassable via `Object.prototype` members: `stPaperTradingItemsPath('toString' as kind)` built `st-paper-trading/function toString()…/items` because the falsy lookup sees inherited props. Both anchored helpers now use `Object.hasOwn`; spec + verify pin `'toString'` throws.
- **Minor (fixed)** — `stPortfolioItemsPath` had no guard at all: plural anchor `'buckets'` (vs kind `'bucket'`) produced `st-portfolio/undefined/items`. Added symmetric `Object.hasOwn` guard + throw; spec + verify pin `'buckets'` throws. Throw messages now name the public surface (`st-paper-trading:`/`st-portfolio:`), not the private helper.
- **Minor (fixed)** — `ST_JOBS_SUBCOLLECTION` lacked `@deprecated` while every sibling legacy twin had one; added with pointer to `ST_JOBS_SUBCOLLECTION_NAME`/`stRunJobsPath`.
- **Nits (fixed)** — `as string[]` casts → `new Set<string>(…).has(k)` in spec + verify; `stRunJobDocPath` lowercase-input pin added (both); stale `StSymbol` JSDoc (said `symbol-meta`, actually `symbols` today); stale `run-all.ts` header; `ST_CONFIG_STATUS_DOC` moved under its own `st-config doc ids` section marker.
- **Verified, not a defect** — `src/app/features/savant-trader/common/constants.ts` was never modified (review-brief error); all FE deprecation markers are in `src/app/core/common/constants.ts` (+9 lines), coverage confirmed complete by both axes.
- **Recorded for #998** — `signalDedupeKey` emits `{SYM}_{signalType}_{barDate}` but the spec'd st-signals doc id is `{SYM}_{barDate}_{signalType}` — field order swapped; do not reuse as doc id.
- **Recorded for cutover tasks** — `firestore.rules` default-deny covers st- roots; client-SDK consumers need rules before cutover (admin SDK unaffected).
- **Issue AC verified directly** — #997 AC satisfied: all st- paths exposed; FE served via `@st/collections` shared alias (IMPL's preferred option over literal FE mirrors); segment parity validated (collections odd, docs even — AC's "even-segment" wording is imprecise, implementation is correct).

## Test results (pass 5)

- `shared/st-collections.spec.ts`: 18/18 pass (new: uppercase pin, prototype-name throws, plural-anchor throw).
- Verify script: all checks OK (68 checks incl. new pins); `functions` esbuild green.
- shared/ + `src/app/core` sweep: 950/951 — sole failure the same pre-existing `screenshot-capture-contracts` spec.

## Verdict

**PASS** — zero critical/major findings after re-review fixes; task ACs met; pre-existing suite failures unrelated.
