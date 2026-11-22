**Topic:** ST Firestore Reorg  
**Topic Slug:** st-firestore-reorg  
**Thread:** Data Plane Consolidation  
**Thread Slug:** data-plane-consolidation  
**Issue:** #1664  
**Thread Parent:** #985  
**Topic Parent:** #984  
**Task:** #1661  
**Domain:** DATA-PIPELINE  
**Type:** UAT  
**Status:** Complete  
**Created:** 2026-11-22  
**Last Updated:** 2026-11-22  

# UAT — #1661 BE-IMPL: cohort drain — cut cohorts to st-position-groups + delete legacy paper-trading root

Backend cutover + a small FE vocabulary surface — acceptance is exercised
by the retirement pin spec, the signal-order group-semantics suite, a
prod dry-run of the purge artifact, the repointed repo-root verifiers,
and one visual check on the paper-trading page's group-by dropdown.

| AC | Scenario |
|---|---|
| AC1 (accept mints `grp-*` groups only) + AC2 (zero prod cohort I/O) | S1, S2 |
| AC5 (COHORT/PaperCohort/itemsPathFor/ST_KINDS retired) + AC6 (grep-pin) | S1 |
| AC3 (trade `cohortId`→`positionGroupId` backfill, 9↔9 map) | S3 |
| AC4 (purge gated on deploy, same shape as #1566) | S3, S8 (deferred) |
| AC7 (`test:paper-trading` + touched specs green; post-deploy probe) | S2, S4, S5, S8 (deferred) |
| Group retry/rebuild + membership boundaries | S2 |
| FE group vocabulary (`Position group` / `Group {key}`) | S6 |
| Repo-root verifiers compile + pass post-cutover | S4 |
| Regression — full touched suites + compile | S7 |

## Results log

- 2026-11-22 — S1–S7 executed; S6 confirmed by the user on the running app
  (`localhost:4200/trading/paper`); S8 deferred to post-ship per the deploy gate.

## Prerequisites

- Repo checkout at `C:\aa\projects\rel-str`, branch `prod`.
- `cd functions` for tsx scripts; ADC with prod Firestore access for the
  dry-run; `NODE_OPTIONS=--require C:\Users\bob\.config\node\ipv4-only.cjs`.
- The dev server is already running at `http://localhost:4200` — only S6
  needs the browser.

## Scenarios

### S1 — Retirement pin: zero legacy cohort surface

- **Confirms:** AC5 + AC6 — `PaperTradingKind.COHORT`, `PaperCohort`,
  `paperTradingItemsPath`, `itemsPathFor`, `resolveCohortId`/`getCohort`/
  `setCohort`, order-tickets `cohortId`, and all three quote forms of the
  `'paper-trading/cohorts'` path literal are absent outside
  migration/purge scripts; `ST_KINDS` is the unconditional
  `stPaperTradingItemsPath` map.
- **Command:** `cd functions && npx tsx --test ../tests/functions/legacy-cohort-retirement-1661.test.ts`
- **Expected:** 14/14 pass.
- **Result:** ✅ PASS — 14/14 (three quote-form needles incl. backtick
  literal added during review remediation).

### S2 — Signal-order accept/retry mints groups only

- **Confirms:** AC1 + AC2 — accepts create `{SYM}-{YYMMDD}-grp-{NN}` via
  `StPositionGroupWriter` (required dep; `create()→null` fail-soft still
  accepts unstamped); retries normalize membership via
  `cohortIdToGroupId` (pre-backfill `cohortId`-only trades resolve the
  same group), always stamp `retryOrigin.positionGroupId`, rebuild
  missing group docs via `ensure()`, and scope membership to same-group
  trades only.
- **Command:** `cd functions && npx tsx --test ../tests/functions/paper-trading/signal-order.test.ts`
- **Expected:** 28/28 pass.
- **Result:** ✅ PASS — 28/28 (incl. `cohortId`-only retry resolving the
  group doc and same-signal/out-of-group exclusion).

### S3 — Prod dry-run of the purge artifact

- **Confirms:** AC3 + AC4 — real prod parity enumeration; dry-run writes
  nothing; apply gate refuses on unmappable ids or missing groups.
- **Command:** `cd functions && NODE_OPTIONS="--require C:\Users\bob\.config\node\ipv4-only.cjs" npx tsx scripts/purge-legacy-cohorts-1661.ts`
- **Expected:** every cohort maps `OK` to an existing group; backfill set
  enumerated; ghost stats scopes detected; `dry-run` exits without
  writes.
- **Result:** ✅ PASS —
  - `9 cohort docs` — **all 9 OK** →
    `ADPT-260927-grp-01`, `SNDK-260927-grp-01`, `TSM-260927-grp-01`,
    `AAMI-260930-grp-01`, `ASML-260930-grp-01`, `LRCX-260930-grp-01`,
    `ROST-260930-grp-01`, `SIF-260930-grp-01`, `ARM-261005-grp-01`
  - `27 trades carry cohortId — 0 lack positionGroupId` (the #1004 soak
    stamped every trade; the backfill is a no-op)
  - `0 backfill trades missing from their group's memberTradeIds`
  - `9 frozen old-format stats-cohort-{YYMMDD}-* docs` detected for
    deletion
  - exits 0, zero writes.

### S4 — Repointed repo-root verifiers green

- **Confirms:** AC6-adjacent — the two live `run-all` verifiers that
  imported deleted symbols now exercise the canonical surface.
- **Commands:**
  `npx tsx scripts/verify/paper-trading-contracts-560-ids.ts` →
  `=== ALL CHECKS PASSED ===`
  `npx tsx scripts/verify/data-pipeline-st-collections-997.ts` →
  `=== ALL CHECKS PASSED ===`
- **Result:** ✅ PASS — both green (560 asserts
  `st-paper-trading/trades/items` + `cohortIdToGroupId` map;
  997 asserts the `'cohort'` kind throws).

### S5 — FE group-by vocabulary specs

- **Confirms:** store groups by `positionGroupId ?? cohortId`; component
  group mode `'group'`; accordion `Group {key}`; toast guards a missing
  group id.
- **Command:** `npx jest src/app/features/savant-trader/{stores/paper-trading.store,stores/order-ticket.store,services/gallery-card-actions.service,pages/paper-trading/paper-trading.component,components/order-ticket/order-ticket.component,pages/signal-order/order.component,services/paper-trading.service}.spec.ts shared/{paper-trading-contracts,paper-trading-ids,st-collections,st-order-tickets,st-position-groups}.spec.ts --coverage=false`
- **Result:** ✅ PASS — 12 suites, 371/371.

### S6 — Paper-trading page group vocabulary (user check)

- **Confirms:** the group-by select and accordion headers no longer say
  "cohort".
- **Getting to the feature:** open `http://localhost:4200/trading/paper`
  (nav: Savant Trader → Paper Trading); set the **Group by** dropdown to
  **"Position group"**; expand one `Group …` section.
- **Expected:** dropdown option reads "Position group"; section headers
  read `Group {SYM}-{YYMMDD}-grp-{NN}`; no "cohort" text anywhere on the
  surface.
- **Result:** ✅ PASS — user confirmed 2026-11-22: dropdown reads "Position group",
  accordion headers read `Group {id}`, no "cohort" text on the surface.

### S7 — Regression: touched suites + compile

- **Confirms:** AC7 — `tests/functions/paper-trading/*` suite green;
  shared + FE specs green; functions + app tsc clean.
- **Evidence (this QA run):** `tests/functions/paper-trading/*` +
  renames + pin = 140/140 across the task suite (the only suite failures
  repo-wide are foreign `analysis-dataset-writer` ×4 and
  `options-engine-1501` fixture — other sessions' in-flight work);
  `functions npx tsc --noEmit` clean; `tsconfig.app.json` clean.
- **Result:** ✅ PASS.

### S8 — DEFERRED (post-ship): deploy gate → `--apply` → root-empty probe

- **Confirms:** AC4 + AC7 — same gate shape as #1566. Steps after
  `firebase deploy --only functions` lands:
  1. Re-run S3's dry-run — expect the same 9↔9 parity.
  2. `npx tsx scripts/purge-legacy-cohorts-1661.ts --apply` — deletes 9
     cohort docs + 9 ghost stats docs + any real anchors, stamps
     `positionGroupId`/`FieldValue.delete()` `cohortId` where needed
     (currently a no-op — the soak covered all 27).
  3. Script's own verification prints `paper-trading root is empty`
     (exit 0); a `collectionGroup('items')` parented under `paper-trading`
     probe returns nothing.
- **Result:** deferred — cannot run pre-deploy; the nightly accept path
  would re-write cohort docs until the new code is live.

## Manual UI/UX refinement pass

- S6 is the only user-facing surface — the group-by label + accordion
  header text. User confirmed on the running app 2026-11-22.

## Findings

- None open. Review-gate majors were remediated in-gate (see the
  CODE-REVIEW doc); QA re-verified the fixes via S1–S5.

## Regression / smoke

- `statsScopeCohort` still emits `cohort-*` scope ids — now keyed by the
  `grp-*` group id (canonical scope family retained by design).
- `AnalysisCohort` classifier + `cohortId` analysis CSV column untouched
  (schema-pinned name; comment added).
- `listTrades` `cohortId` filter removed — no production caller existed;
  FE groups client-side.
- Deprecated `PaperTrade.cohortId` stays in the contract until the purge
  deletes the last doc carrying it; all readers use the
  `positionGroupId ?? cohortId` union.

## Verdict

**PASS** — all executable acceptance items green, S6 user-confirmed;
S8 is a deploy-gated ops step tracked on QA #1664.
