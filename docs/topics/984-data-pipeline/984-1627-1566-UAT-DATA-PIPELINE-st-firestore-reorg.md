**Topic:** ST Firestore Reorg  
**Topic Slug:** st-firestore-reorg  
**Thread:** Pass Family Consolidation  
**Thread Slug:** pass-family-consolidation  
**Issue:** #1627  
**Thread Parent:** #987  
**Topic Parent:** #984  
**Task:** #1566  
**Domain:** DATA-PIPELINE  
**Type:** UAT  
**Status:** Complete  
**Created:** 2026-11-18  
**Last Updated:** 2026-11-20  

# UAT — #1566 BE-CHORE: stale legacy stats doc cleanup + verification

Backend/ops task — acceptance is exercised by pin specs, a prod dry-run
of the purge script, the repointed `read-apis-565` verify, and a live
`listStats` enumeration probe. No UI surface changed; **no route or
entry point applies** (the dashboard ghost scopes this removes are the
`listStats` enumeration behind `/options-strategy-dashboard` →
Population selector — observing them is optional; the enumeration probe
below is the authoritative check).

| AC | Scenario |
|---|---|
| AC5 (grep-pin: 5 symbols incl. `stats-ALL`) | S1 |
| AC1 (canonical-scope classifier correctness) | S2 |
| AC1 + AC2 (script enumerates + classifies; dry-run default, `--apply`) | S3 |
| AC6 (`read-apis-565` repoint → green) | S4 |
| AC7 (README registration) + AC3 (deploy gate documented) | S5 |
| AC4 (post-run `getPaperStats` no-scope → canonical only) | S6 |
| Regression — suites + compile | S7 |

## Results log

- 2026-11-18 — all scenarios executed; see per-scenario results below.
- 2026-11-20 — **post-ship:** `firebase deploy --only functions` landed
  (incl. `getStrategyEquityCurve` delete — the last deployed `stats-ALL`
  reader); `--apply` executed against prod — see Deferred section.

## Scenarios

### S1 — Retirement pin covers `stats-ALL`

- **Confirms:** AC5 — zero prod references to `runStatsPass`,
  `incrementStatsOnOpen`, `defaultReadStatsDoc`, `getStrategyEquityCurve`,
  `stats-ALL` (scan radius: `functions/src` + `shared/` non-spec).
- **Command:** `cd functions && npx tsx --test ../tests/functions/legacy-stats-retirement-1565.test.ts`
- **Expected:** 14/14 pass.
- **Result:** ✅ PASS — 14/14 (the `stats-ALL` pin is green; its one
  live literal — a `paper-stats-pass.ts` doc comment — was reworded to
  "legacy-combined" so the pin holds literally).

### S2 — Canonical-scope classifier pins

- **Confirms:** AC1 — `isCanonicalStatsScope` accepts exactly the 12
  scope families + `all`; rejects `ALL`, unprefixed instance ids, empty.
- **Command:** `npx jest shared/paper-trading-ids.spec.ts --coverage=false`
- **Expected:** all tests pass incl. the two `isCanonicalStatsScope`
  cases (13 builder-emitted scopes true; 3 reject cases false).
- **Result:** ✅ PASS — 48/48.

### S3 — Purge script dry-run enumerates only stale docs

- **Confirms:** AC1 (enumeration + classification on real prod data) and
  AC2 (dry-run default — listing only, zero writes).
- **Command:** `cd functions && npx tsx scripts/purge-legacy-stats-docs-1566.ts`
  (ADC; IPv4 preload as usual)
- **Expected:** census counts every doc; every listed candidate is a
  `stats-ALL` or `stats-{unprefixed-instanceId}` form; no canonical
  `stats-{all|inst-*|var-*|cohort-*|sig-*|sym-*|src-*|sigtype-*|dir-*|sector-*|ind-*|captier-*|sigstatus-*}`
  doc appears in the candidate list.
- **Result:** ✅ PASS — **723 stats docs → exactly 7 stale**, all
  legacy-form:
  - `stats-ALL` (open=64 closed=0)
  - `stats-260819-QQQM-CSP-020-30-D` (open=16)
  - `stats-260819-QQQM-CSP-030-30-D` (open=16)
  - `stats-260819-SCHB-CSP-020-30-D` (open=16)
  - `stats-260819-SCHB-CSP-030-45-D` (open=16)
  - `stats-261105-NVDA-CSP-020-30-D-1200` (open=0)
  - `stats-SPY-WHEEL-INT` (open=48)
  No canonical doc was flagged. Zero writes issued.

### S4 — `read-apis-565` runs green on canonical paths

- **Confirms:** AC6 — the verify script's stale-root bug is fixed (its
  `tradeRef`/`statsRef`/`acctRef` all hardcoded the dead `paper-trading/`
  root post-#1007); seeds write where the real pass + handlers read.
- **Command:** `cd functions && npx tsx scripts/verify/paper-trading-read-apis-565.ts`
- **Expected:** all checks OK; cleanup removes `verify-565-*` seeds +
  namespaced stats docs and self-heals shared scopes.
- **Result:** ✅ PASS — **20/20** on prod (run during review remediation;
  cleanup completed: seeds deleted, shared scopes recomputed, namespaced
  + orphan scopes removed).

### S5 — Registration + deploy gate

- **Confirms:** AC7 (README note exists for the ops script) and AC3
  (`--apply` documented as post-#1565-deploy only).
- **Checks:** `functions/scripts/verify/README.md` contains the
  `<!-- #1566 …` ops-script note; `purge-legacy-stats-docs-1566.ts`
  header carries the ⚠ deploy-gate block; script is NOT in
  `run-all.ts` (destructive ops script — convention).
- **Result:** ✅ PASS — note present at README lines ~151–158; gate in
  script header lines 14–16; absent from `run-all.ts` by design.
  `functions/tsconfig.json` include covers the script (review minor).

### S6 — `listStats` enumeration surfaces exactly the stale set

- **Confirms:** AC4 — today `getPaperStats` (no scope) surfaces the
  ghost scopes (pre-purge state); post-`--apply` the script's own
  re-enumerate+assert proves only canonical docs remain.
- **Command:** prod probe enumerating `st-paper-trading/stats/items`
  and classifying each doc id via `isCanonicalStatsScope` (same
  predicate `listStats`-backed `getPaperStats` surfaces).
- **Expected:** probe's stale set ≡ S3's candidate list; every canonical
  family present (`all`, `inst-*`, `src-*`, `var-*`, `sym-*`, …).
- **Result:** ✅ PASS — probe classified all 723 docs: 716 canonical
  across 12 families (incl. `stats-all`, `stats-src-STRATEGY`,
  `stats-src-SIGNAL`, `stats-inst-*`, `stats-sym-*`, `stats-var-*`) and
  exactly the same 7 stale docs S3 listed. **Post-`--apply` assertion is
  built into the script** (re-enumerates + exits 1 on stragglers) —
  executed 2026-11-20 post-deploy: 7/7 deleted, all 728 remaining docs
  canonical, exit 0.

### S7 — Regression suites

- **Confirms:** no collateral — shared ids module, pin spec, engine
  batch, compile.
- **Results:** ✅ `test:paper-trading` 398/398 · `npx jest` 6102/6102 ·
  `npm run build` + `tsc -p` clean (script now inside tsconfig).

## Deferred (by design, not findings)

- **`--apply` execution** — **executed 2026-11-20 post-deploy** (AC3
  gate satisfied by the same `firebase deploy` push that deleted
  `getStrategyEquityCurve`). Post-deploy dry-run reconfirmed the same
  7 stale docs (735 total — the deployed `paperStatsPass` had added
  ~12 canonical scopes since the 11-18 count). `--apply` then deleted
  7/7 and its post-delete re-enumerate reported **all 728 remaining
  docs canonical, exit 0** — AC4 proven against prod: `getPaperStats`
  (no scope) now surfaces only canonical docs; the dashboard's
  Population-selector ghosts (`ALL`, `SPY-WHEEL-INT`, `260819-*`) are
  gone.
- **Canonical-prefixed ghosts** (`stats-inst-verify-*` from crashed
  verify runs) — kept by design; documented in the script header.

## Findings

None unresolved.
