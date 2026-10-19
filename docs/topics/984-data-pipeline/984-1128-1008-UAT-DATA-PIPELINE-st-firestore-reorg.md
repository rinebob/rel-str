**Topic:** ST Firestore Reorg  
**Topic Slug:** st-firestore-reorg  
**Thread:** Data Plane Consolidation  
**Thread Slug:** data-plane-consolidation  
**Issue:** #1128  
**Thread Parent:** #985  
**Topic Parent:** #984  
**Task:** #1008  
**Domain:** DATA-PIPELINE  
**Type:** UAT  
**Status:** Complete  
**Created:** 2026-10-20  
**Last Updated:** 2026-10-20  

# UAT — #1008 st-config + st-symbol-lists consolidation

## Scope

Cut three legacy Firestore roots onto canonical roots with soak mirrors:

- `savant-trader/data/trading-config/{docId}` → `st-config/{docId}`
- `savant-trader/data/status/current` → `st-config/status` (doc-id rename)
- `savant-trader/data/symbol-lists/{docId}` → `st-symbol-lists/{docId}`

Soak topology: FE stays on legacy roots until #1014; BE reads canonical
immediately at deploy. Mirrors: `tradingConfigMirror` + `symbolListsMirror`
(legacy→canonical), `stStatusMirror` (`st-config/status`→legacy shadow,
literal-path trigger). `addSymbolToDefaultList` + `sweep-unlisted-to-new`
dual-write both roots atomically.

## Prerequisites

- Application Default Credentials for prod Firestore
  (`gcloud auth application-default login` or `GOOGLE_APPLICATION_CREDENTIALS`).
- `NODE_OPTIONS=--require C:\Users\bob\.config\node\ipv4-only.cjs` (IPv6 workaround).
- All commands run from `functions/`.
- Prod window: run the migration outside a live ST run (status + symbol-lists
  are written by the scheduled pass; the doc-level risk is a stale shadow that
  step S5 heals).

## Scenarios

### S1 — Migration dry-run (read-only)

- `npx tsx scripts/migrate-config-lists-1008.ts`
- Expected: `would copy` per family ≈ source counts; 0 failed. No writes.

### S2 — Migration apply

- `npx tsx scripts/migrate-config-lists-1008.ts --apply`
- Expected: copied 10 (2 trading-config, 1 status, 7 symbol-lists),
  0 failed. `st-config/status` = legacy `status/current` payload.

### S3 — Selective deploy

- `firebase deploy --only functions:tradingConfigMirror,functions:symbolListsMirror,functions:stStatusMirror,functions:stAutoPaperIngest,functions:stProcessSymbol,functions:stGetStatus,functions:processSymbolAdded`
- Expected: 3 mirror functions created; 4 updated; nothing else touched.

### S4 — Soak-window re-apply

- `npx tsx scripts/migrate-config-lists-1008.ts --apply`
- Expected: identical ≥10, copied 0 (or copies only docs FE wrote
  between S2 and S3).

### S5 — Parity audit

- `npx tsx scripts/verify/data-pipeline-config-lists-1008.ts`
- Expected: 0 FAIL. WARNs allowed only for in-flight soak drift
  (canonical-newer or legacy-newer transient).

### S6 — tradingConfigMirror soak probe (legacy → canonical)

- Write `savant-trader/data/trading-config/qa-1008-probe` `{probe:true}`
  → confirm `st-config/qa-1008-probe` appears identical (~seconds).
- Delete the legacy doc → confirm the canonical copy is deleted.
- Also confirm `st-config/status` is NOT disturbed (guard).

### S7 — symbolListsMirror soak probe (legacy → canonical)

- Write `savant-trader/data/symbol-lists/QA_1008_PROBE`
  `{key:'QA',symbols:['TEST']}` → confirm `st-symbol-lists/QA_1008_PROBE`
  identical → delete legacy → confirm canonical deleted.

### S8 — stStatusMirror soak probe (canonical → legacy)

- Merge-set `st-config/status` `{qaProbe:'1008'}` → confirm
  `savant-trader/data/status/current` carries the field → remove the field
  from canonical → confirm legacy drops it.
- Confirms BE-write→FE-visible path survives the rename.

### S9 — NEW-list dual-write (atomic)

- `tsx` probe calling `addSymbolToDefaultList('QA1008PROBE')` → both
  `savant-trader/data/symbol-lists/NEW` and `st-symbol-lists/NEW` contain
  the symbol in `symbols[]` → cleanup: `arrayRemove` from both docs.
- Confirms batch atomicity + union-merge on real Firestore.

### S10 — stGetStatus callable / run status UX (user spot-check)

- Open the app → run dashboard shows agent status (last run, totals).
- Confirms the callable reads `st-config/status` correctly.

### S11 — Auto-paper ingest on canonical (deferred observational)

- Next scheduled ST run: `stAutoPaperIngest` reads `st-config/autoPaper`
  + `st-symbol-lists` — confirm ingest completes and produces trades per
  the PRIMARY list. (Or wait for next daily run and check logs.)

## Traceability

| Requirement | Scenario |
|---|---|
| trading-config docs migrate, ids preserved | S1, S2, S5 |
| status/current → st-config/status (remap) | S2, S5, S8, S10 |
| symbol-lists migrate, ids preserved | S1, S2, S5, S7 |
| Readers/writers cut over | S3 (deploy), S10, S11 |
| Legacy→canonical mirrors (config, lists) | S6, S7 |
| Canonical→legacy status shadow | S8 |
| NEW-list dual-write atomic | S9 |
| Migration rerun-safe / divergent-skip | S4 |
| Parity audit direction-aware, 0 FAIL | S5 |

## Results log

Executed 2026-10-20 against prod (`rel-str`). Ordering followed the
required sequence: migrate → deploy → re-migrate → audit → soak probes.

| Scenario | Result | Evidence |
|---|---|---|
| S1 dry-run | PASS | `would copy` 10 (2 cfg / 1 status / 7 lists), 0 failed; no writes |
| S2 apply | PASS | `copied 10, identical 0, skipped-divergent 0, failed 0` |
| S3 selective deploy | PASS | 7 functions: tradingConfigMirror, symbolListsMirror, stStatusMirror **created**; stGetStatus, processSymbolAdded, stAutoPaperIngest, stProcessSymbol **updated**. `Deploy complete!` |
| S4 soak re-apply | PASS | `copied 0, identical 10` — zero drift during deploy window |
| S5 parity audit | PASS | **0 FAIL, 0 WARN** — all three families `src-only 0, dest-only 0, diverged 0`. The `destInclude` partition works: no noise from `autoPaper`/uid docs in shared `st-config` |
| S6 tradingConfigMirror | PASS | `qa-1008-probe` write appeared at `st-config/qa-1008-probe` within ~2s, identical payload; delete propagated; `st-config/status` undisturbed (guard verified) |
| S7 symbolListsMirror | PASS | `QA_1008_PROBE` upsert→canonical identical; delete propagated |
| S8 stStatusMirror | PASS | merge-set `qaProbe` on `st-config/status` → appeared on legacy `status/current`; `FieldValue.delete` → field dropped on legacy. Shadow direction + wholesale-set semantics confirmed live |
| S9 dual-write | PASS | `addSymbolToDefaultList('QA1008PROBE')` wrote both `savant-trader/.../NEW` and `st-symbol-lists/NEW` in one batch; arrayUnion merge; cleaned up via arrayRemove |
| S10 stGetStatus | PASS (data path) | `st-config/status` populated + identical to legacy `status/current` (lastRun `2026-10-19_mon_103108_pdr`, totalRuns 210, totalSignals 27819); callable deployed reading canonical. Recommend user glance at the app status display — belt-and-suspenders, not blocking |
| S11 auto-paper ingest | PASS (input path) | `st-config/autoPaper` present `{enabled:true, lists:[PRIMARY,SECONDARY,MONITOR,NEW]}`; `916-inputs` verify run: **ALL CHECKS PASSED** — canonical `st-symbol-lists` PRIMARY resolves (210 members), full signal→trade-id contract maps onto real data. Next scheduled run observation remains as a routine check |

Notes:

- First S6 attempt hit a transient `oauth2.googleapis.com/token` network
  error (IPv6 flake, empty reason); re-ran with the IPv4 preload — all
  PASS. Not a product defect.
- Probe script retained at `functions/scripts/qa-probe-1008.ts` —
  re-runnable soak verifier, needed again at #1013 legacy removal.
- Firebase CLI deploy required `NODE_OPTIONS=--require ...\ipv4-only.cjs`
  explicitly (this shell's env didn't carry it); noted in AGENTS.md.

## Verdict

**QA PASS** — all applicable scenarios pass on prod. Deferred scope
(unchanged from review): Firestore rules/indexes for `st-*` roots →
#1012/#1014; manual UI refinement N/A (backend/data infrastructure).
