**Topic:** ST Firestore Reorg  
**Topic Slug:** st-firestore-reorg  
**Thread:** Data Plane Consolidation  
**Thread Slug:** data-plane-consolidation  
**Issue:** #1237  
**Thread Parent:** #985  
**Topic Parent:** #984  
**Task:** #1013  
**Domain:** DATA-PIPELINE  
**Type:** UAT  
**Status:** Complete  
**Created:** 2026-10-24  
**Last Updated:** 2026-10-24  

# UAT — #1013 legacy roots archive/diff/delete (final)

## Scope

Retire the legacy Firestore roots replaced by the `st-*` cutover (#997–#1012):
remove deployed soak mirrors + sweeper, strip legacy fallbacks/dead
constants, retire rules ACLs + dead indexes, archive every retiring
collection (with subcollections), then delete the roots — while provably
preserving blocked live roots (`savant-trader/data/{runs,symbols}`+subcols,
`paper-trading/{cohorts,analysis-*}`, `rh-agent-credentials`).

## Prerequisites

- Application Default Credentials with prod Firestore access
- `NODE_OPTIONS=--require C:\Users\bob\.config\node\ipv4-only.cjs` for
  Firebase CLI + tsx scripts (IPv6 workaround)
- Working directory `functions/` for all commands below

## Scenarios

| # | Scenario | Steps | Expected | Result |
|---|---|---|---|---|
| S1 | Parity relay all-green | `npx tsx scripts/verify/data-pipeline-legacy-roots-1013.ts` | Every check `legacy=0`, zero FAIL, blocked-root list printed | **PASS** — 22 checks (26 collections), all `legacy=0`, "All parity checks pass" |
| S2 | Pin spec — no retired refs in deployed code | `npm run test:legacy-roots-1013` | 48/48 pass | **PASS** — 48 pass, 0 fail |
| S3 | Retired functions undeployed | `npx firebase functions:list` | No `orderIntentsMirror`, `portfolioItemsMirror`, `stBacktest*Mirror`, `tradingConfigMirror`, `symbolListsMirror`, `stStatusMirror`, `cleanupStOccurrenceDecisions` | **PASS** — only `cleanupStRunJobs` matches the pattern (legit #1010 sweeper) |
| S4 | Archive completeness | `ls scripts/output/legacy-archive-1013/` | 26 JSON files incl. subcollection docs | **PASS** — 26 files, ~160MB, 317,028 docs archived |
| S5 | Blocked roots untouched | probe counts on `savant-trader/data/{runs,symbols}`, `paper-trading/{cohorts,analysis-*}`, `rh-agent-credentials` | All populated | **PASS** — runs=233, symbols=926, cohorts=9, analysis-datasets=4, analysis-slices=3, credentials=1 |
| S6 | Live write path post-delete | latest `updatedAt` on canonical roots | Writes timestamped after the deletion | **PASS** — `st-paper-trading/stats/items` docs written 2026-10-24T16:37:51Z (post-delete); canonical roots healthy (`st-signals`=1520, `st-order-tickets`=191) |
| S7 | Verify tooling consistent | `functions/scripts/verify/run-all.ts` lists only on-disk relays; `-564` compiles against routed paths | No references to deleted files | **PASS** — run-all cleaned + `legacy-roots-1013` wired; `-564` uses `paperTradingDocPathFor`; `tsc` + esbuild clean |
| S8 | Rules + indexes valid | `npx tsx --test ../tests/functions/firestore-rules-indexes-1012.test.ts` | 13/13 pass; retired roots deny-by-default | **PASS** — 13/13; `portfolio/{anchor}` block removed; `st-portfolio` block intact |

## Traceability

| Acceptance criterion (task checklist / PRD US-6) | Scenario |
|---|---|
| Mirrors + sweeper removed from code AND undeployed | S2, S3 |
| Legacy fallbacks / dual-writes / dead constants removed | S2, S7 |
| Retired ACL blocks + dead index entries removed | S8 |
| Archive-before-delete with nested subcollections, resumable | S4 |
| `savant-trader/data/*` replaced roots deleted | S1, S4 |
| `rh-agent-*` archived/diffed then deleted | S1, S4 |
| No reads/writes reference removed paths after cutover | S2, S7 |
| Blocked roots preserved (runs/symbols/cohorts/analysis/credentials) | S5 |
| Live app unaffected post-delete | S6 (+ watch item) |

## Watch items (not executable today)

- **First post-delete nightly run** — cron is Mon–Fri; next run is the
  upcoming weeknight. `savant-trader/data/runs` (live, blocked) must gain
  a new run doc and `st-signals` must grow. Auto-paper ingest reads the
  same live roots — expect healthy.
- **`firebase deploy --only firestore`** — the rules/indexes diff ships
  at ship time; retired roots are already deny-by-default via wildcard.

## Regression / smoke checklist

- [x] `paper-trading` suite 272/272, all `st-*` suites green, `tsc` + esbuild clean (review doc)
- [x] FE untouched — zero `src/app` files in the diff
- [x] `functions/scripts/verify/run-all.ts` no longer references deleted relays
- [x] `firebase-admin-init.ts` reverted to HEAD (unclaimed `getStorage` export removed from this changeset)

## Results log

Executed 2026-10-24 against prod (`rel-str`). All eight scenarios PASS
with evidence above. No FAIL/BLOCKED items. Deletion ops were executed
under `--apply` in two runs (24 roots + 2 empty roots); every deleted
collection re-counted at 0 remaining.
