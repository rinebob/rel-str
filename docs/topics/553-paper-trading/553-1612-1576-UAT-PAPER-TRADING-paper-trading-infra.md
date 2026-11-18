**Topic:** Paper Trading Infra  
**Topic Slug:** paper-trading-infra  
**Thread:** Historical Signal Replay  
**Thread Slug:** historical-signal-replay  
**Issue:** #1612  
**Thread Parent:** #906  
**Topic Parent:** #553  
**Task:** #1576  
**Domain:** PAPER-TRADING  
**Type:** UAT  
**Status:** Complete  
**Created:** 2026-11-18  
**Last Updated:** 2026-11-18  

# UAT — #1576 BE: Ledger ops — deletePaperTrades cascade + ingest curated dims + PRIMARY/SECONDARY widening

Backend-only task — no UI surface. Acceptance is executable specs,
the no-credentials verify script, a regression batch, and two prod-read
checks (config state + stray-config residue audit).

## Scope

- `deletePaperTrades` callable — bulk `tradeIds` → per-item
  `deleted`/`notFound`/`failed`; auth + cap-50 + blank validation;
  trim/dedupe.
- `deleteTradeCascade` seam — txn deletes a SIGNAL trade doc; refuses
  non-signal (`non-signal`) and accept-flow (`accept-flow` —
  `cohortId`/`positionGroupId`/`ticket` markers); rewinds
  `acct-{userId}.openTradeCount` on lifecycle-open deletes; post-txn
  best-effort removes `rq-*` raw quotes + the `pap_{tradeId}` ticket.
- Live ingest curated dims — `governingVariant: 'trailing-8'` seed,
  `governingPolicy: 'deepest-stop-else-trailing-8'`,
  `variantKeys: CURATED_VARIANT_KEYS` on new captures; `SIGNAL_*`
  retained on non-signal paths.
- `st-config/autoPaper.lists` = `["PRIMARY","SECONDARY"]` (prod doc —
  stray MONITOR+NEW trimmed 2026-11-18).
- Live-date gate unchanged: historical/replay runs never auto-ingest.

## Prerequisites

- Repo at `C:\aa\projects\rel-str`, branch `prod`, worktree carries the
  #1576 diff.
- `GOOGLE_CLOUD_PROJECT=rel-str` + ADC for the two prod-read scenarios
  (S4, S5). All other scenarios need no credentials.

## Getting to the feature

No route — BE surface. The callable registers as `deletePaperTrades`
in `functions/src/index.ts`; the seam is
`functions/src/paper-trading/repository.ts` `deleteTradeCascade`;
the ingest dims live in
`functions/src/paper-trading/passes/auto-paper-ingest-pass.ts`
`runAutoPaperIngestFill`.

## Scenarios

### S1 — Focused spec: delete cascade + callable (20 tests)

- **Confirms:** AC1 (callable + cascade + idempotency), review-major
  pins (accept-flow refuse ×3 markers, openTradeCount rewind,
  missing-acct tolerance), contract bucketing.
- **Run:** `cd functions && npx tsx --test ../tests/functions/paper-trading/delete-paper-trades.test.ts`
- **Expected:** `ℹ pass 20`, `ℹ fail 0`.
- **Result:** ☑ PASS — 2026-11-18 — `ℹ tests 20 / pass 20 / fail 0`
  (fresh run).

### S2 — Verify script (36 checks, no credentials)

- **Confirms:** contract/callable surface, real-seam cascade (artifacts
  gone, foreign rq survives, re-delete → notFound, non-signal +
  accept-flow refuse, openTradeCount rewind), callable auth/cap/buckets,
  real `runAutoPaperIngestFill` curated dims + SECONDARY admit +
  unlisted filter + `captureList` stamp.
- **Run:** `cd functions && npx tsx scripts/verify/paper-trading-ledger-ops-1576.ts`
- **Expected:** `All 36 checks passed.`
- **Result:** ☑ PASS — 2026-11-18 — `All 36 checks passed.` (fresh run).

### S3 — Regression: paper-trading batch + tsc

- **Confirms:** no collateral damage (ingest spec updates, SIGNAL_*
  retention on callables/expression-fill paths, live-date gate spec
  unchanged).
- **Run:** `cd functions && npm run test:paper-trading` → `ℹ pass 398`;
  `npx tsc --noEmit -p tsconfig.json` → clean.
- **Result:** ☑ PASS — 2026-11-18 — `ℹ pass 398 / fail 0`
  (paper-trading batch), tsc clean. Live-date gate pinned by the
  unchanged `historical-run` spec inside the batch.

### S4 — Prod config state (ADC)

- **Confirms:** `autoPaper.lists` = exactly `["PRIMARY","SECONDARY"]`
  (post-trim state recorded in IMPL §6 as-built).
- **Run:** `cd functions && GOOGLE_CLOUD_PROJECT=rel-str npx tsx -e "import {db} from './src/firebase-admin-init'; db.collection('st-config').doc('autoPaper').get().then((d:{data:()=>unknown})=>{console.log(JSON.stringify(d.data()));process.exit(0)});"`
- **Expected:** `"lists":["PRIMARY","SECONDARY"]` in the output.
- **Result:** ☑ PASS — 2026-11-18 —
  `{"enabled":true,"ownerUid":"wAFg...","lists":["PRIMARY","SECONDARY"]}`.
  List doc census: PRIMARY 210, SECONDARY 78, MONITOR 19, NEW 471
  members (NEUTRAL 90, AVOID 65, HIDE 12 also exist, out of scope).

### S5 — Stray-config residue audit (ADC)

- **Confirms:** whether any signal trades were minted off MONITOR/NEW
  members while `lists` carried the stray widening — the groom tool's
  first real cleanup candidates.
- **Run:** `cd functions && GOOGLE_CLOUD_PROJECT=rel-str npx tsx ../.devin/tmp/qa-1576-residue-audit.ts`
- **Expected:** report of trades with `captureList` ∈ {MONITOR, NEW}
  (count + ids). Any found are candidates for `deletePaperTrades`
  post-deploy — PASS records the census, not zero.
- **Result:** ☑ PASS — 2026-11-18 — MONITOR **0** trades; NEW **60**
  trades (`{"OPEN":19,"CLOSED":41}`), all minted in one batch
  `bar=2026-10-19, created=2026-10-19` while NEW sat in `lists`.
  These are the groom tool's first real cleanup candidates — all are
  `source=SIGNAL` and carry no accept-flow markers (auto-ingest never
  stamps `cohortId`/`positionGroupId`/`ticket`), so `deletePaperTrades`
  can remove them in two ≤50-id batches post-deploy.

## Manual UI/UX refinement pass

Not applicable — no user-facing surface (callable + ingest pass +
config doc).

## Traceability

| Acceptance criterion | Scenario |
|---|---|
| `deletePaperTrades` bulk → deleted + notFound; cascade removes trade + rq-* + pap_*; idempotent | S1, S2 |
| Non-signal → failed never deleted; accept-flow → failed never deleted | S1, S2 |
| openTradeCount rewind on lifecycle-open delete | S1, S2 |
| Live ingest dims: CURATED_VARIANT_KEYS + governingPolicy; SIGNAL_* retained | S1–S3 |
| `autoPaper.lists` includes SECONDARY (prod-verified) | S2, S4 |
| SECONDARY member admitted / non-listed skipped | S2 |
| Live-date gate unchanged | S3 (existing spec pins) |
| Stray MONITOR/NEW residue census | S5 |

## Regression / smoke

- [x] `test:st-order-tickets` 26/26 (pap_* doc surface)
- [x] `test:st-signals` 34/34 (signal-surface neighbors)

## Findings

- 60 stray-capture trades in prod (`captureList=NEW`, 19 OPEN /
  41 CLOSED, one batch bar=2026-10-19) — residue of the pre-fix
  `lists` widening, not a code defect. Cleanup is a **post-deploy
  user action**: call `deletePaperTrades` with these trade ids
  (two ≤50 batches) after `firebase deploy --only functions` ships
  the callable. Deleting them restores `openTradeCount` correctly
  via the in-txn rewind; cash/equity/realizedPnl drift on the
  41 CLOSED docs is the documented hard-delete drift (review doc).

## Verdict

**PASS** — all five scenarios green; the S5 census finding is prod
data residue with a defined post-deploy cleanup path, not a defect in
the delivered code.

## Results log

- 2026-11-18 — S1 20/20 focused specs; S2 36/36 verify checks;
  S3 398/398 paper-trading batch + tsc clean; S4 prod config
  `["PRIMARY","SECONDARY"]` confirmed post-trim; S5 census:
  MONITOR 0 / NEW 60 (19 OPEN, 41 CLOSED, single 2026-10-19 batch);
  regression smoke 26/26 tickets + 34/34 signals.
