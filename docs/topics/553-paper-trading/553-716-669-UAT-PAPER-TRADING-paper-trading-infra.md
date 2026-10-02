**Topic:** Paper Trading Infra  
**Topic Slug:** paper-trading-infra  
**Thread:** Trade Exits  
**Issue:** #716  
**Task:** #669  
**Topic Parent:** #553  
**Domain:** PAPER-TRADING  
**Type:** UAT  
**Status:** Complete — executed in-session 2026-09-30  
**Created:** 2026-09-30  
**Last Updated:** 2026-09-30  

# UAT — #669 BE trade-exits prod verify script + guide + run-all

## Scope

The deliverable IS the verification tooling: a prod-exercising script for
the #652 trade-exits seam (prod seeding audit, instance-resolution round
trips, seed guards, cancel + close guards), its guide, run-all
registration, and README indexing. Acceptance = the tooling exists,
documents itself correctly, and runs green against prod.

## Prerequisites

- Google Application Default Credentials for project `rel-str`
  (`gcloud auth application-default login`, or existing ADC file).
- `NODE_OPTIONS` IPv4 preload (AGENTS.md) if firebase times out.
- Repo at the #669 working tree. Not part of `npm test` — deliberate
  invocation only.

## Scenarios

| # | Feature | Steps | Expected | Result |
|---|---|---|---|---|
| 1 | Script runs green | `cd functions; npx tsx scripts/verify/paper-trading-trade-exits-669.ts` | 26 checks `OK`, `cleanup: docs removed (verified)`, `26 passed, 0 failed`, exit 0 | |
| 2 | Audit section | observe output section 1 | 6 checks on real prod trades (12 docs at time of writing): parseable/legacy-none keys, ≤1 governing, terminal-or-none governing key, field↔run consistency, no ACTIVE on terminal status, keys mirror | |
| 3 | Resolution round trips | observe section 2 | `trailing-15` honored; `time-30d` + `none` default to `trailing-8`; a `[TradeAdapter] ... defaulting to trailing-8` warn line prints (proves the warn path) | |
| 4 | Guards | observe section 3 | `none`/`time-30d`/`bogus`/`trailing-0`/`trailing-150` rejected, no docs written; `garbage` variantKeys rejected | |
| 5 | Cancel + close guards | observe sections 4–5 | pending→CANCELLED with EXITED runs; close missing → not-found; close CANCELLED → failed-precondition | |
| 6 | Cleanup guarantee | re-run the script | identical result — leftover scratch docs (if any) are cleaned at start; post-cleanup existence check confirms zero survivors | |
| 7 | run-all registration | `cd functions; npx tsx scripts/verify/run-all.ts` | `paper-trading-trade-exits-669.ts` runs last in the chain; summary ≥1 pass | |
| 8 | Root runner registration | `npx tsx scripts/verify/run-all.ts` (from repo root) | `paper-trading trade-exits composed` entry executes after `live-quote close` | |

## Traceability

| Criterion | Scenarios |
|---|---|
| `paper-trading-trade-exits-*.ts` — cancel path, close-path guards, seeding vs prod | 1–6 |
| Guide `.md` + run-all + README row | 7, 8 + `scripts/verify/paper-trading-trade-exits-669.md` exists and documents usage |
| Prod run green | 1, 6 |

## Safety note

The script writes scratch docs to prod (`verify-669-*`, `acct-verify-669`)
and deletes + verifies them. Scratch instances are `STOPPED`/`openTimePT
'99:99'` so a leaked doc can't feed scheduled passes. Do not run two
copies concurrently.

## Execution log

| Scenario | Result | Evidence |
|---|---|---|
| 1 Script runs green | PASS | `26 passed, 0 failed`, `cleanup: docs removed (verified)` |
| 2 Audit | PASS | 12 prod trades audited, 6/6 invariant checks OK |
| 3 Resolution | PASS | `trailing-15` honored; `time-30d`/`none` → `trailing-8`; real `[TradeAdapter]` warn line emitted |
| 4 Guards | PASS | all 5 governing rejections + variantKeys rejection + no-leak checks |
| 5 Cancel/close | PASS | CANCELLED + EXITED runs; not-found + failed-precondition |
| 6 Re-run idempotent | PASS | consecutive runs identical; verifyDeleted confirms zero survivors |
| 7 functions run-all | PASS | 11/11 scripts PASS, 669 last |
| 8 root run-all | PASS | `paper-trading trade-exits composed` executes + 26/26. Sweep summary 16P/2F/2S — the 2 failures are pre-existing and unrelated (`swing-605` + `portfolio-586` can't resolve `firebase-admin` from repo root — legacy entries, not #669); the 2 skips are account-arg scripts. |

**Residual note:** #669 does not own the root runner's legacy entries; their  
root-resolution failure predates this task. Tracked implicitly — a future
hardening pass could either give those scripts a `cwd`/require fix or move
them under `functions/`.

## Refinement pass

Not applicable — no user-facing surface (scripts + docs only).
