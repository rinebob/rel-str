**Topic:** Paper Trading Infra  
**Topic Slug:** paper-trading-infra  
**Thread:** Signal Selection  
**Thread Slug:** signal-selection  
**Issue:** #1647  
**Thread Parent:** #1117  
**Topic Parent:** #553  
**Task:** #1651  
**Domain:** PAPER-TRADING  
**Type:** CODE-REVIEW  
**Status:** Complete  
**Created:** 2026-11-22  
**Last Updated:** 2026-11-22  

# Code Review — #1651 BE-IMPL: legacy signal-trade wipe script

Three axes run in parallel (Standards, Spec, Thermo-nuclear) over the
task diff, then a serial second pass. **Verdict: PASS** — 1 major +
7 minors + nits found and fixed in-gate, all re-verified green. Given
the diff is a destructive ops script, the review weighed the destructive
surface hardest.

## Diff under review

- `functions/scripts/groom-legacy-signal-trades.ts` (new — deps-injected
  `runGroomSignalTrades` core + `groomProdDeps` + census printer +
  `invokedAsScript` main guard)
- `tests/functions/paper-trading/groom-legacy-signal-trades.test.ts`
  (new, 6 specs)
- `functions/scripts/verify/paper-trading-groom-legacy-trades-1651.{ts,md}` (new)
- `functions/scripts/verify/run-all.ts` + `README.md` (registrations)
- `functions/package.json` (`test:paper-trading` += spec path)
- `functions/tsconfig.json` (`include` += the script — sibling one-shots
  are named there)

## Axes summary

### Standards — 1 major, 4 minor, 5 nit

Sibling conventions (header/`@topic`, `--apply` gate, `invokedAsScript`
guard verbatim, deps-injection, node:test spec, DRY/LIVE verify,
run-all/README registration) verified faithful. The major: parallel
`Promise.all` cascade batches contended on the shared `acct-{userId}`
doc — the sibling callable `handleDeletePaperTrades` is deliberately
serial.

### Spec — all ACs MET (3 wording reconciliations documented)

AC1's "paged scan" resolves to a single `.get()` — complete at 340 docs
(pagination is a memory concern orders of magnitude away). AC5's
literal "`source==SIGNAL` count == 0" is unreachable under AC2's
never-delete-accept-flow mandate (27 such docs exist in prod) — the
implemented `eligible == 0` + all-survivors-are-marker-carriers is the
only self-consistent reading and is what the verify asserts.

### Thermo-nuclear — no criticals/majors, 4 minor, ~8 nit

Layered safety confirmed: in-txn refusal authority, per-item failure
capture, exit-1 on `failed`, post-wipe census tripwire. 11 suspected
issues actively disproved (missing-acct guard, marker TOCTOU inside the
txn, `.select()` idiom, path correctness, ticket field names,
post-#1661 marker continuity, double `--apply` gates).

## Findings — all fixed in-gate

| Sev | Finding | Fix |
|-----|---------|-----|
| major | 50-way `Promise.all` cascades contended on the shared `acct-auto-paper.openTradeCount` rewind (all three axes flagged; sibling `handleDeletePaperTrades` is serial) — txn retries could exhaust → failed bucket → exit 1 | Serial iteration inside each batch; live census later showed `OPEN:89` eligible — the contention was real, not theoretical |
| minor | `failed` ids/errors collected but never printed — exit-1 gave no diagnostics | `printCensus` prints per-item `FAILED id: error`, plus capped deleted/refused id lists (the only record of what was destroyed is now console-visible) |
| minor | Verify log labeled `paper-trading/trades/items` — actual path is `st-paper-trading/trades/items` (legacy root drained at #1661) | Label corrected — console honesty matters most on a destructive run |
| minor | Verify re-implemented the script's prod deps (incl. a pointless dynamic import) — silent divergence if the scan filter ever changed | `groomProdDeps` exported and consumed by the verify |
| minor | PENDING-status eligible trade would be a phantom `openTradeCount` −1 inside the cascade (PENDING never incremented it); population believed ~0 but unverifiable | `status` added to the scan row; census prints an eligible-by-status histogram — live shows `OPEN:89, CLOSED:224`, zero PENDING |
| minor | `batchSize ≤ 0` (or NaN) → infinite loop on the `i +=` step | `Math.max(1, …)` clamp + spec pinning |
| minor | AC3 literal: `notFound` absent from the dry census output | Outcome line now prints in both modes (honest zeros in dry) |
| nit | Verify's `eligible + skipped == scanned` check was a tautology by construction | Removed; `scanned === raw` is the meaningful check |
| nit | Spec header + test name referenced a `--dry` flag that doesn't exist (dry is the default, no flag) | Reworded to "census-only run (no --apply)" |
| nit | Docstring claimed prod "pages the collection" | Corrected — single `.get()`, fine at ~340 docs |
| nit | `GroomSignalTradeRow` re-declared PaperTrade field types | `Pick<PaperTrade, 'id'\|'cohortId'\|'positionGroupId'\|'ticket'\|'status'>` — single-sourced |
| nit | Unknown cascade outcome silently dropped from census | Defensive else → `failed` with 'unrecognized outcome' |
| nit | Header census ~300+60 predated the actual count | Updated to the observed 340 (313 eligible / 27 skipped) |
| nit | Script absent from `tsconfig.json include` (siblings named) | Added |

**Accepted without change (documented):** `cascadeRefused` exits 0 —
refusals are expected survivors, not anomalies (TN judged defensible
either way). rq-*/pap_* orphan window (killed mid-run leaves audit-only
cleanup residue; `notFound` never re-attempts cleanup) — audit-only,
can't affect the pane join; documented as an operator note in the
verify .md rather than adding a second cleanup pass to a one-shot
script. Mid-wipe mint race (`generatePaperSignalTrades` is deployed;
a concurrent curated mint is marker-indistinguishable from legacy
residue) — bounded, tripwired by the post-wipe `eligible == 0` assert,
documented as "hold mints during the wipe" operator guidance.
Spec fixtures carry no `signalId` (not literally "curated-origin") —
`signalId` plays no role in eligibility; semantics unaffected.

## Test results

- `tests/functions/paper-trading/groom-legacy-signal-trades.test.ts` — **6/6**
- `npm run test:paper-trading` — **443/443**
- `npx tsc --noEmit` (functions) — clean on the diff files (1 pre-existing
  foreign error in `options-engine-eod-selection-1501.ts`, unrelated)
- `npm run build` (functions esbuild) — clean
- Verify `paper-trading-groom-legacy-trades-1651.ts` — **8/8 DRY**,
  **`--live` read-only green**; `groom-legacy-signal-trades.ts` live dry
  census: **340 scanned — 313 eligible (`OPEN:89, CLOSED:224`),
  27 skipped**
- No destructive `--apply` run — the wipe itself is gated on the pane's
  ship ordering and is a separate operator decision

## Pass sequence

```text
First pass complete — 3 parallel axes; 1 major (parallel-cascade
  account-doc contention), ~7 minors (failed-ids not printed, wrong
  collection label, verify dep-mirror, PENDING phantom decrement
  unverifiable, batchSize≤0 loop, AC3 notFound print, orphan window),
  nits — all fixed in-gate.
Second pass complete — fixes re-verified green: spec 6/6 (incl. new
  clamp pin), suite 443/443, verify 8/8 DRY + live read-only green,
  live script census confirms 313 eligible / 27 skipped / zero PENDING,
  tsc clean on diff files, build clean.
Convergence: PASS — no remaining critical/major findings; every fix
  re-verified.
```

## Verdict

**PASS** — task advances to `7_QA`. The live destructive `--apply`
remains unrun by design; executing the wipe is the QA/ship decision,
not a review-gate item.
