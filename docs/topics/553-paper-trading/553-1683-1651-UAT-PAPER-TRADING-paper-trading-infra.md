**Topic:** Paper Trading Infra  
**Topic Slug:** paper-trading-infra  
**Thread:** Signal Selection  
**Thread Slug:** signal-selection  
**Issue:** #1683  
**Thread Parent:** #1117  
**Topic Parent:** #553  
**Task:** #1651  
**Domain:** PAPER-TRADING  
**Type:** UAT  
**Status:** Complete  
**Created:** 2026-11-22  
**Last Updated:** 2026-11-22  

# UAT — #1651 BE-IMPL: legacy signal-trade wipe script

## Scope

`functions/scripts/groom-legacy-signal-trades.ts` — the one-shot ops
script that hard-deletes the `source=SIGNAL` paper trades left by the
retired auto-ingest, ahead of the signal-selection pane (#1653). Each
scanned doc is pre-classified against the same refusal set
`deleteTradeCascade` enforces in its transaction — trades carrying
`cohortId` / `positionGroupId` / `ticket` (accept-flow lineage) are
skipped + reported, never deleted. Eligible ids drive the real cascade
serially inside `DELETE_PAPER_TRADES_MAX_ITEMS` batches; the cascade
remains the authoritative second gate.

Covered task ACs:

- Scan `source==SIGNAL` trades; drive `deleteTradeCascade` in
  `DELETE_PAPER_TRADES_MAX_ITEMS` batches.
- Eligibility parity — cohort/group/ticket carriers skipped + reported,
  never force-deleted.
- Census-only default; `--apply` deletes; re-run is a no-op report.
- Spec coverage: eligibility parity, dry/apply, batching, idempotent
  re-run.
- Verify script registered in run-all + README.
- Ops ordering: the wipe runs BEFORE the pane ships.

## Prerequisites

- Git Bash on the dev machine, repo at `C:\aa\projects\rel-str`, branch
  `prod` (or the uncommitted task worktree).
- Application Default Credentials with prod Firestore access
  (`gcloud auth application-default login` once) — needed for the LIVE
  scenarios only.
- `NODE_OPTIONS=--require C:\Users\bob\.config\node\ipv4-only.cjs` for
  any command that touches the network (firebase/gh).
- No emulator — `FUNCTIONS_EMULATOR` must NOT be set for live runs.
- Live census at QA time: **340 `source=SIGNAL` trades — 313 eligible
  (`OPEN:89, CLOSED:224`), 27 skipped (accept-flow markers)**.

## Getting to the feature

There is no browser surface — the feature is a CLI ops script. The
"route" is the functions workspace:

```bash
cd C:/aa/projects/rel-str/functions
```

The script entry point is
`functions/scripts/groom-legacy-signal-trades.ts`; its verification pair
is `functions/scripts/verify/paper-trading-groom-legacy-trades-1651.{ts,md}`.

## Automated evidence

```bash
cd C:/aa/projects/rel-str/functions
npx tsx --test ../tests/functions/paper-trading/groom-legacy-signal-trades.test.ts
npm run test:paper-trading
npm run build
npx tsc --noEmit
```

Expected: 6/6 spec tests pass; `test:paper-trading` 443/443; esbuild
bundle succeeds; `tsc --noEmit` reports zero errors on the task files
(one pre-existing foreign error in
`options-engine-eod-selection-1501.ts` is unrelated — #1501 stream).

## Scenarios

### S1 — DRY verify: fixture census + apply + idempotent re-run

Confirms the groom core end-to-end without credentials: classification
split, census-only no-delete, per-id cascade calls, outcome bucketing,
re-run no-op.

```bash
cd C:/aa/projects/rel-str/functions
npx tsx scripts/verify/paper-trading-groom-legacy-trades-1651.ts
```

Expected: `OK` on all 8 checks — `=== 8 passed, 0 failed ===`.

Result: **PASS** — user-executed 2026-11-22, `=== 8 passed, 0 failed ===`

### S2 — LIVE read-only census vs raw query

Confirms the prod wiring scans exactly the `source==SIGNAL` set — the
groom's count must equal a raw `.select()` query on the same filter.

```bash
cd C:/aa/projects/rel-str/functions
export NODE_OPTIONS="--require C:\\Users\\bob\\.config\\node\\ipv4-only.cjs"
npx tsx scripts/verify/paper-trading-groom-legacy-trades-1651.ts --live
```

Expected: all DRY checks pass, then `OK   scan count matches a raw
source==SIGNAL query`, a `census:` line, `read-only — pass --live
--apply to run the real wipe`, `=== 9 passed, 0 failed ===`. Deletes
nothing.

Result: **PASS** — user-executed 2026-11-22. `OK   scan count matches a
raw source==SIGNAL query`; `census: 340 scanned — 313 eligible,
27 skipped`; `=== 9 passed, 0 failed ===`

### S3 — Script dry census (the operator view)

Confirms the runnable entry point defaults to census-only and prints
the full picture: eligible/skipped split, status histogram, outcome
line, and the `--apply` hint.

```bash
cd C:/aa/projects/rel-str/functions
export NODE_OPTIONS="--require C:\\Users\\bob\\.config\\node\\ipv4-only.cjs"
npx tsx scripts/groom-legacy-signal-trades.ts
```

Expected (QA-time corpus):

```text
scanned 340 signal-source trades — 313 eligible, 27 skipped (accept-flow markers)
  eligible by status — OPEN:89, CLOSED:224
deleted 0, notFound 0, cascade-refused (accept-flow 0, non-signal 0), failed 0
dry-run — pass --apply to delete the eligible set
```

Checkpoints: zero deletes (`deleted 0`, process exit 0); the status
histogram shows **no PENDING** (a PENDING eligible would mean a phantom
`openTradeCount` decrement inside the cascade — population is expected
zero); skipped count stays 27.

Result: **PASS** — user-executed 2026-11-22. Exact expected output
including `eligible by status — OPEN:89, CLOSED:224` (zero PENDING) and
the dry banner.

### S4 — Destructive apply — OPERATOR DECISION REQUIRED

Runs the real wipe against prod. **Destructive — explicit authorization
required.** Per AC6 the wipe must land before the pane (#1653) ships;
it may run now (pane has no UI yet) or be deferred as a hard
pre-condition of #1653.

```bash
cd C:/aa/projects/rel-str/functions
export NODE_OPTIONS="--require C:\\Users\\bob\\.config\\node\\ipv4-only.cjs"
npx tsx scripts/groom-legacy-signal-trades.ts --apply
```

Expected (QA-time corpus): ~313 `deleted ids` printed (capped at 50
with `…+N`), `deleted 313, notFound 0, cascade-refused (accept-flow 0,
non-signal 0), failed 0`, exit 0. A nonzero `failed` count exits 1 and
is re-run fuel — already-deleted ids vanish from the next census.

Operator notes (from the verify guide): hold pane mints during the run
(`generatePaperSignalTrades` is deployed); a process killed mid-run
can leave audit-only `rq-*`/`pap_*` orphans that cannot affect the
pane join.

Result: **PASS** — executed 2026-11-22 under explicit user
authorization. `deleted 313, notFound 0, cascade-refused (accept-flow
0, non-signal 0), failed 0`, exit 0; the 313 deleted ids printed
(capped `…+263`).

### S5 — Post-apply verification + idempotent re-run

Only meaningful after S4 applied. The verify's `--live --apply` path
runs the same wipe through its own deps and then asserts the
post-condition: `eligible == 0` and every surviving `source==SIGNAL`
doc carries an accept-flow marker. A bare re-run of the script should
then report `eligible 0` and delete nothing.

```bash
cd C:/aa/projects/rel-str/functions
export NODE_OPTIONS="--require C:\\Users\\bob\\.config\\node\\ipv4-only.cjs"
npx tsx scripts/verify/paper-trading-groom-legacy-trades-1651.ts --live --apply
npx tsx scripts/groom-legacy-signal-trades.ts --apply
```

Expected: verify prints `OK   every eligible delete succeeded`, `OK
post-wipe census: zero eligible remain`, `OK   post-wipe: only skipped
(accept-flow) docs survive`; script re-run reports `scanned 27 …
eligible 0 … deleted 0` — the 27 accept-flow docs are untouched.

Result: **PASS** — executed 2026-11-22. Verify `=== 12 passed, 0 failed
===` (`0 eligible` pre-scan, `post-wipe: 0 deleted, 27 skipped docs
remain`); script re-run: `scanned 27 … 0 eligible … eligible by status
— none … deleted 0`, exit 0.

## Manual UI/UX refinement pass

Not applicable — no user-facing surface. The script is an ADC-gated CLI
run by the operator; console output shape is exercised in S3/S4.

## Findings

- None recorded yet.

## Traceability

| Acceptance criterion | Scenario |
|----------------------|----------|
| Scan `source==SIGNAL`, cascade in `DELETE_PAPER_TRADES_MAX_ITEMS` batches | S1 (batching checks), S3 (real scan count), S4 |
| Eligibility parity — cohort/group/ticket skipped + reported | S1 (classification checks), S3 (27 skipped preserved) |
| Census-only default; `--apply` deletes; re-run no-op | S1, S3, S4, S5 |
| Spec coverage (parity, dry/apply, batching, re-run) | Automated evidence — spec file 6/6 |
| Verify registered in run-all + README | Automated evidence — `run-all.ts`, README row + order entry |
| Ops ordering — wipe before pane ships | S4/S5 decision record |

## Regression / smoke

- [x] `npm run test:paper-trading` — 443/443 (whole ledger suite)
- [x] `npm run build` — functions esbuild clean
- [x] `npx tsc --noEmit` — task files clean (one foreign #1501 error pre-exists)
- [x] Verify `run-all` registration unchanged for sibling scripts — only the `#1651` line added

## Verdict

**PASS** — all scenarios green; the wipe executed and verified
idempotent. The pane (#1653) ships into a ledger free of auto-minted
legacy residue — the 27 surviving accept-flow trades are preserved by
design.

## Results log

(Newest first.)

### 2026-11-22 — QA execution

- **Automated evidence** — spec 6/6; `test:paper-trading` 443/443;
  `npm run build` clean; `npx tsc --noEmit` clean on task files
  (1 pre-existing foreign `options-engine-eod-selection-1501.ts` error).
- **S1 — PASS** — user-executed: `=== 8 passed, 0 failed ===`.
- **S2 — PASS** — user-executed: `OK scan count matches a raw
  source==SIGNAL query`; `census: 340 scanned — 313 eligible, 27
  skipped`; `=== 9 passed, 0 failed ===`.
- **S3 — PASS** — user-executed: full census line + `eligible by status
  — OPEN:89, CLOSED:224` (zero PENDING) + outcome zeros + dry banner.
- **S4 — PASS** — wipe executed under explicit authorization:
  `deleted 313, notFound 0, cascade-refused 0/0, failed 0`, exit 0.
- **S5 — PASS** — verify `--live --apply`: `=== 12 passed, 0 failed ===`
  (`0 eligible` pre-scan → post-wipe `eligible == 0`, only the 27
  accept-flow docs survive); script re-run: `scanned 27 … 0 eligible …
  deleted 0`, exit 0 — idempotent.
- **Refinement pass** — N/A, no user-facing surface.
