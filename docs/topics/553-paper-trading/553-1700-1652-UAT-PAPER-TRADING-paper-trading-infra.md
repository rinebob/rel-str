**Topic:** Paper Trading Infra  
**Topic Slug:** paper-trading-infra  
**Thread:** Signal Selection  
**Thread Slug:** signal-selection  
**Issue:** #1700  
**Thread Parent:** #1117  
**Topic Parent:** #553  
**Task:** #1652  
**Domain:** PAPER-TRADING  
**Type:** UAT  
**Status:** Complete  
**Created:** 2026-11-23  
**Last Updated:** 2026-11-23  

# UAT — #1652 BE-IMPL: auto-mint retire (config flip + census verify)

## Scope

Retire automatic paper-trade minting without touching the ingest code:
`st-config/autoPaper.enabled = false` makes `runAutoPaperIngestPass`
return `skipped/'disabled'` before any MCP session, quote, or mint.
The verify pair asserts the flip, the post-wipe census, and the
gate-level zero-mint on a dispatched payload.

## Prerequisites

- Repo checkout on `prod`; `functions/` deps installed.
- LIVE scenarios need Application Default Credentials
  (`gcloud auth application-default login`) and
  `GOOGLE_CLOUD_PROJECT=rel-str`.
- The config flip itself is the user-executed ops step (console or
  `.devin/tmp/` tsx snippet — documented in the verify `.md`).

## Getting to the feature

No route or UI surface — backend/ops task. The "feature" is the
absence of minting: verify via the script and, optionally, the
Firestore console at `st-config/autoPaper`.

## Automated evidence

- `npm run test:paper-trading` — 443/443 (includes the groom spec
  suite exercising the exported `isAcceptFlowMarker`).
- DRY stage — `npx tsx scripts/verify/paper-trading-signal-review-retire-1652.ts` — 4/4.
- LIVE stage — same command + `--live` — 3/3 (7/7 total).

## Scenarios

### S1 — DRY gate discrimination

- **Confirms:** the verify exercises the real
  `runAutoPaperIngestPass` with fixture deps — disabled →
  `skipped/'disabled'`, enabled + nightly + live date → `ready`
  (discriminating, not vacuous), missing config →
  `skipped/'missing-config'`, disabled wins on a historical date
  (config gate precedes the market-date gate).
- **Steps:** `cd functions && npx tsx scripts/verify/paper-trading-signal-review-retire-1652.ts`
- **Expected:** `=== 4 passed, 0 failed ===`
- **Result:** PASS — 4/4, 2026-11-23

### S2 — LIVE config + census + real gate

- **Confirms:** `st-config/autoPaper.enabled === false` (user's
  console flip, read back); zero non-accept-flow `source==SIGNAL`
  trades post-#1651 wipe; a nightly payload through the real gate +
  prod dep wiring returns `skipped/'disabled'` — a dispatched ingest
  mints nothing.
- **Steps:** `npx tsx scripts/verify/paper-trading-signal-review-retire-1652.ts --live`
- **Expected:** `st-config/autoPaper.enabled === false` OK · census
  `27 signal-source trades — 0 legacy residue, 27 accept-flow` · real
  gate `skipped/'disabled'` OK · `=== 7 passed, 0 failed ===`
- **Result:** PASS — 7/7 (4 DRY + 3 LIVE), 2026-11-23

### S3 — Production code untouched

- **Confirms:** `auto-paper-ingest-pass.ts` and all of
  `functions/src/` carry no diff from this task (AC3 — the config
  gate is the retirement mechanism, not a code change).
- **Steps:** `git status --porcelain -- functions/src/` → confirm no
  task-attributed modifications.
- **Result:** PASS — no #1652 files under `functions/src/`

### S4 — Registration

- **Confirms:** the verify script is listed in `run-all.ts`'s script
  array and the verify README (table row + order entry 68).
- **Steps:** `grep -n 1652 functions/scripts/verify/run-all.ts`
  → line in the `scripts` array; `grep -n 1652
  functions/scripts/verify/README.md` → row + order entry.
- **Result:** PASS — `run-all.ts:76`, README row + order entry 68

### S5 — Discrimination evidence (pre/post flip)

- **Confirms:** the LIVE check is not vacuously green — the same
  command run **before** the flip failed on `enabled === false` and
  returned `status: 'ready'` from the real gate; after the flip all
  checks pass. The gate responds to the config.
- **Expected:** pre-flip `5 passed, 2 failed` · post-flip
  `7 passed, 0 failed`.
- **Result:** PASS — both runs on record (pre-flip output in session
  transcript; post-flip output attached to #1652)

## Manual UI/UX refinement pass

Not applicable — no user-facing surface (config doc + verify tooling).

## Findings

- None outstanding. Two in-gate review fixes landed before QA:
  `isAcceptFlowMarker` exported for the shared residue predicate;
  the `.md` ops snippet moved to the gitignored `.devin/tmp/`.
- Operational note: the nightly `stAutoPaperIngest` task still
  dispatches and logs `st_autopaper_task_done` with
  `status:'skipped', reason:'disabled'` — expected inert behavior,
  visible in Cloud Logging on the next run.

## Traceability

| AC | Scenario |
|----|----------|
| `enabled = false` in prod | S2, S5 |
| Verify asserts `enabled == false` | S1, S2 |
| Zero `source==SIGNAL` residue post-wipe | S2 |
| Next run mints zero | S2 (gate-level), S5 |
| Pass untouched | S3 |
| run-all + README registration | S4 |
| LIVE output attached to #1652 | S2 evidence → issue comment |

## Regression / smoke

- [x] `test:paper-trading` — 443/443 green
- [x] Groom verifier unaffected — shares `isAcceptFlowMarker` (export-only change)
- [x] Accept-flow trades preserved — census 27/27 markers intact

## Verdict

**PASS** — config retirement live and verified; auto-mint is dead.

## Results log

| Date | Scenario / check | Result | Evidence |
|------|------------------|--------|----------|
| 2026-11-23 | S1 DRY gate discrimination | PASS | 4/4 |
| 2026-11-23 | S2 LIVE config + census + gate | PASS | 7/7 total; output attached to #1652 |
| 2026-11-23 | S3 src untouched | PASS | clean `git status` on functions/src |
| 2026-11-23 | S4 registration | PASS | run-all + README rows |
| 2026-11-23 | S5 discrimination pre/post | PASS | 5/2 pre-flip → 7/0 post-flip |
| 2026-11-23 | test:paper-trading | PASS | 443/443 |
