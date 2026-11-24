**Topic:** Paper Trading Infra  
**Topic Slug:** paper-trading-infra  
**Thread:** Signal Selection  
**Thread Slug:** signal-selection  
**Issue:** #1647  
**Thread Parent:** #1117  
**Topic Parent:** #553  
**Task:** #1652  
**Domain:** PAPER-TRADING  
**Type:** CODE-REVIEW  
**Status:** Complete  
**Created:** 2026-11-23  
**Last Updated:** 2026-11-23  

# CODE-REVIEW — #1652 BE-IMPL: auto-mint retire (config flip + census verify)

## Scope reviewed

| File | Change |
|------|--------|
| `functions/scripts/verify/paper-trading-signal-review-retire-1652.ts` | New — DRY gate discrimination + LIVE doc/census/gate asserts |
| `functions/scripts/verify/paper-trading-signal-review-retire-1652.md` | New — ops flip procedure + commands + pass criteria |
| `functions/scripts/groom-legacy-signal-trades.ts` | Export-only: `isAcceptFlowMarker` (shared refusal predicate) |
| `functions/scripts/verify/run-all.ts` | +1 registration line |
| `functions/scripts/verify/README.md` | +table row, +order entry 68 |

Zero production-code changes — `functions/src/` untouched by this
task, per AC3 (`auto-paper-ingest-pass.ts` untouched; the config gate
is the retirement mechanism).

## Pass protocol

```text
First pass complete — 3 findings: refusal predicate duplicated in the
  verifier (exported `isAcceptFlowMarker` from the groom script —
  non-behavioral), `.md` ops snippet wrote a temp script at functions/
  root (moved to gitignored `.devin/tmp/` with corrected relative
  imports), spec interpretation note recorded below.
Second pass complete — no new findings. Type imports exercised at
  runtime, groom spec suite green, registration hunks clean, error
  path is crash-with-stack (correct for a verifier).
Convergence: PASS — two passes cover the whole diff; nothing outside
  task scope surfaced.
```

## Standards axis

- File size/single purpose: 145-line verify script, one job. ✓
- No duplication: reuses `groomProdDeps().listSignalTrades()` (the
  #1651 scan seam) and now imports `isAcceptFlowMarker` — one refusal
  predicate for groom + verifier + `deleteTradeCascade` parity. ✓
- Real functions, no mirrors: the gate checks call the real
  `runAutoPaperIngestPass` with injected deps rather than
  reimplementing gate logic — a future gate change fails the verify,
  which is the point. ✓
- Safe-by-default: DRY runs with no credentials; `--live` is
  read-only (doc read + scan + a pure gate call — no writes). ✓
- Convention match: `check()` OK/FAIL helper, `--live` gating, and
  `.md` guide shape all mirror the #1649–#1651 verify pairs. ✓

## Spec axis — acceptance criteria

| AC | Status | Evidence |
|----|--------|----------|
| `st-config/autoPaper.enabled = false` | MET | User-executed console flip; verify reads back `enabled === false` |
| Verify asserts `enabled == false` | MET | LIVE check 5 |
| Verify asserts `source==SIGNAL` trade count == 0 post-wipe | MET (semantic) | Asserts zero **non-accept-flow** SIGNAL trades — same semantic reading #1651's AC5 required: 27 accept-flow docs legitimately carry `source==SIGNAL` and are preserved by design; literal-zero would fail on the docs the spec says to keep |
| Next completed run reports zero minted trades | MET (gate-level) | The real gate returns `skipped/'disabled'` on a nightly payload — a dispatched ingest returns before the MCP session, quoting, and fill; zero minted by construction. Stronger than a literal run-log count (log-only output, not Firestore-queryable): it proves *any* dispatched run mints nothing |
| `auto-paper-ingest-pass.ts` untouched | MET | `git status` on `functions/src/` clean for this task |
| run-all + README registration | MET | List entry + table row + order entry 68 |
| LIVE output attached to issue | MET | Comment on #1652, 2026-11-23 |
| DRY verification for the config gate | MET | 4 DRY checks incl. discrimination (enabled→`ready` proves non-vacuous) and precedence (disabled wins over a historical date — the config gate precedes the market-date gate) |

## Thermo-nuclear axis

- Honest surface: the LIVE gate call runs the production dep wiring
  (`defaultAutoPaperIngestDeps`) — the same `loadConfig` the deployed
  task uses — so a reverted config fails loudly. ✓
- Date-immunity verified: post-flip, the `disabled` return precedes
  the market-date gate, so the LIVE check can't false-fail when run
  on a later date. Pre-flip it correctly failed with `ready` —
  discrimination observed on prod, not just fixtures. ✓
- `PAYLOAD.runId = 'verify-1652'` writes one diagnostic log line to
  prod logs — harmless, clearly attributed. ✓
- No edge-case blind spots found: census reports both buckets
  (residue vs preserved accept-flow) instead of asserting a blind
  total. ✓

## Test results

- `test:paper-trading`: **443/443** (includes the 6-spec groom suite
  exercising the exported `isAcceptFlowMarker`).
- Verify script: DRY 4/4 + LIVE 3/3 = **7/7** post-flip.
- No new spec file — per the TEST doc the batch's spec files cover
  handler + wipe tasks; the disabled gate is already pinned in
  `auto-paper-ingest-pass.test.ts` (`skips cleanly when disabled`),
  and this task's executable coverage is the verify's DRY stage.

## Findings

- **Minor (fixed in-gate):** `isAcceptFlowMarker` was module-private
  in the groom script; the verifier initially inlined the same
  3-field predicate. Exported it — one refusal predicate across
  groom, verifier, and the `deleteTradeCascade` mirror.
- **Minor (fixed in-gate):** `.md` ops snippet wrote a temp flip
  script at `functions/` root; moved to the gitignored `.devin/tmp/`
  convention with corrected relative imports.
- **Info:** AC "zero `source==SIGNAL` trades" is read semantically
  (zero non-accept-flow), matching the #1651 resolution — literal
  zero would contradict the preserve-accept-flow requirement.

## Verdict

**PASS** — config retirement verified in prod; the gate-level zero-mint
assertion is the honest and stricter form of the AC.
