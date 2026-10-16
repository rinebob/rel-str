**Topic:** ST Firestore Reorg  
**Topic Slug:** st-firestore-reorg  
**Thread:** Data Plane Consolidation  
**Thread Slug:** data-plane-consolidation  
**Issue:** #1047  
**Thread Parent:** #985  
**Topic Parent:** #984  
**Task:** #1001  
**Domain:** DATA-PIPELINE  
**Type:** UAT  
**Status:** Complete  
**Created:** 2026-10-16  
**Last Updated:** 2026-10-16  

# UAT — BE-IMPL: st-signals backfill from signal-history + run-ids (#1001)

## Scope

One-shot migration script + read-only parity audit that fold legacy
`savant-trader/data/symbols/{SYM}/signal-history` and `run-ids` docs into
canonical `st-signals/{SYM}_{barDate}_{signalType}` occurrence docs.
Acceptance: history occurrences → CONFIRMED (entry-gated), run-ids-only →
INTERIM; one doc per occurrence; runIds unioned; provenance from earliest
detection; existing docs get upgrade-only merges; malformed reported not
thrown; `--dry-run`/`--symbol` flags; batches ≤400; chunked `getAll`.

## Prerequisites

- Repo at `C:\aa\projects\rel-str`, branch `prod`.
- Application Default Credentials (gcloud ADC or `GOOGLE_APPLICATION_CREDENTIALS`
  pointing at a service-account key) with Firestore read on prod.
- `NODE_OPTIONS="--require C:\Users\bob\.config\node\ipv4-only.cjs"` (IPv4
  workaround; user-level env var on this machine).
- All commands run from `functions/` unless noted.

## Scenarios

| # | Scenario | Steps | Expected | Result |
|---|----------|-------|----------|--------|
| 1 | Unit suite | `npm run test:st-signals` | 34/34 pass incl. 20 #1001 specs (merge matrix, weekly re-dating, INTERIM-history gate, historyRunIds union, malformed routing, updateForExisting branches, droppedSignalTypes) | **PASS** — 34/34 |
| 2 | Typecheck + build | `npm run typecheck`; `npm run build` | clean; `lib/index.js` ~1.8mb | **PASS** |
| 3 | Single-symbol dry-run | `npx tsx scripts/backfill-st-signals-1001.ts --dry-run --symbol ADPT` | `ADPT: 4 occurrence(s) → would create=4`, TOTAL line, no writes | **PASS** — 4 would-create, malformed=0 |
| 4 | `--symbol=` form | `--dry-run --symbol=ADPT` | identical output to #3 | **PASS** |
| 5 | Fat-fingered flag | `--symbol --dry-run` | exits 1: `--symbol requires a value` — never silently runs all symbols | **PASS** |
| 6 | Single-symbol audit (pre-backfill) | `npx tsx scripts/verify/data-pipeline-st-signals-backfill-1001.ts --symbol ADPT` | `expected=4 missing=4` listing every occurrence id; exit 1 (correct — nothing backfilled yet) | **PASS** |
| 7 | Audit on a symbol with weekly signals | `… --symbol AAPL` | `expected=7 missing=7` incl. `AAPL_2026-08-26_W_ST_TREND_RIDER_V1_LONG` (entry.barDate id-minting) | **PASS** |
| 8 | Full-universe dry-run | `npx tsx scripts/backfill-st-signals-1001.ts --dry-run` (no --symbol) | walks every st-symbols doc; TOTAL tally; MALFORMED/NOTE lines if any | **PASS** — see evidence |
| 9 | FAIL/WARN audit tiers | inspect audit output shape | MISSING/EXTRA/bad-status = FAIL; provenance/payload divergence on live-created docs = WARN only | **PASS** — code + output verified; no WARN lines on clean symbols |

## Traceability

| Acceptance criterion | Scenario |
|---|---|
| signal-history → CONFIRMED / run-ids-only → INTERIM | 1 (specs), 3/8 (dry-run aggregation) |
| verify: per-symbol counts, zero dupes, zero missing | 6, 7 |
| malformed reported not thrown | 1 (specs), 8 |
| `--dry-run` / `--symbol` | 3, 4, 5 |
| batch ≤400, chunked getAll | 1 (specs), code review rounds 2–3 |

## Refinement pass

Not applicable — no user-facing surface.

## Evidence

```
$ npm run test:st-signals     → tests 34, pass 34, fail 0
$ npm run typecheck           → clean
$ npm run build               → lib\index.js 1.8mb
$ ... --dry-run --symbol ADPT → ADPT: 4 occurrence(s) → would create=4
$ ... audit --symbol ADPT     → expected=4 missing=4 mismatched=0 extra=0
$ ... audit --symbol AAPL     → expected=7 missing=7 (incl. W_ occurrence)
$ ... --symbol --dry-run      → exit 1 "requires a value"
$ ... --dry-run (all symbols) → see below
```

Full dry-run output: recorded in QA issue comment (or run log) — every
symbol enumerated, would-create totals, malformed/note lines.

## Not covered here (deliberate)

- The actual production backfill write — an operator-triggered step to run
  OUTSIDE live-run windows post-ship, followed by the audit certifying
  PARITY OK. Neither this UAT nor ship performs it.
