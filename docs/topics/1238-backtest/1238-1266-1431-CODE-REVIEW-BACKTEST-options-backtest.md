**Topic:** Options Backtest  
**Topic Slug:** backtest  
**Thread:** Backtest Analytics  
**Thread Slug:** backtest-analytics  
**Issue:** #1266  
**Thread Parent:** #1266  
**Topic Parent:** #1238  
**Task:** #1431  
**Domain:** BACKTEST  
**Type:** CODE-REVIEW  
**Status:** Complete  
**Created:** 2026-11-11  
**Last Updated:** 2026-11-11 (Round 2)  

# Code Review — #1431: Analysis results — UAT follow-ups (open outcome, hit-rate, table enhancements)

## Round 2 — 2026-11-11: PASS, no third pass warranted

Re-review of the post-remediation diff (verify-every-fix + fresh-eyes on
the new lines). R1 majors confirmed genuine, not cosmetic; two bounded
findings landed in-cycle.

| Axis | Result | Actionable |
|---|---|---|
| Standards | APPROVE — 11/12 R1 items verified; the miss was a stale `worker.test.ts` header bullet | stale bullets fixed; store file-size (337→252 via metrics util extraction) **fixed** |
| Spec | APPROVE — every remediation re-verified against items 1–12; W/L deviation adjudicated: partial-ITM-win is a *correction* (economically right, all spec examples hold), not creep — noted in the TEST doc | none |
| Thermo-nuclear | APPROVE post-R2-remediation — R1 majors "substantively fixed"; stated **no R3 warranted** | 2 moderates **fixed**; 3 boundary questions answered in comments |

**Round-2 remediations:**
- **M-1 (real trap):** `emitEntriesToChart` field write claimed markers
  "can't round-trip" — false: `parsePlottedEntries` *unions* repeated
  `date,id` lines into `markerDates`. Now emits one line per marker
  date, so a re-paste of the field round-trips the full plotted set,
  dots included.
- **M-2:** `terminalMarkOf()` helper — `exitPrice`/`intrinsicAtExpiry`
  narrowing existed 3× across `winLossOf` + `priceChange`; now shared.
- Metrics module extracted to
  `backtest/utils/analysis-results-metrics.util.ts` (`winLossOf`,
  `tradeRowMetrics`, `terminalMarkOf`, `TradeRowMetrics`) — store back
  under the 300-line target; `EventRow extends TradeRowMetrics`.
- Stale docs: `worker.test.ts` header bullet still described the
  pre-`open` semantics; `options-analysis-contracts.ts` variant
  enumeration omitted `'open'`; `registryVersion: 2` literal →
  `EXIT_REGISTRY_VERSION` constant.
- Boundary questions answered in comments, code unchanged:
  `expiration > today` boundary owns the `==`-today intraday edge +
  series-tail trust (`records.ts`); expiry-kind `hitRatePct` is
  documented as tautological-100 — `expiredCount` vs `contractCount`
  is the informative split (`aggregate.ts`).

**Noted, not fixed:**
- `better === (side === SHORT)` → simplified to
  `(side === SHORT ? better : worse)` during the extraction (nit).
- Converter Partial-spread passes wrong-typed extra keys unvalidated —
  same exposure as the prior wholesale cast; not new.
- `watchRunDoc` realtime listener for a static field — house convention.
- Cell-index DOM assertions in the component spec — brittle, accepted.

**Re-verified:** 68/68 BE, 93/93 affected FE suites (plus 9/9 incl. the
foreign `option-chart.component.spec.ts` — the user's #1423 component
methods healed it), app tsc + functions build clean.

**Verdict: PASS stands — all axes agree no further round is warranted.**

## Round 1 — 2026-11-11: PASS (all critical/major findings remediated in-cycle)

Three parallel axes over the task-scoped diff (`git diff HEAD` restricted
to #1431 files; foreign-session contamination — #1423 chips-column hunks
in `option-chart.component.ts`/`.component.spec.ts`, #878 rows in
`verify/README.md`/`run-all.ts`, `options-replay.store.spec.ts` openCount
fixture lines excepted — explicitly excluded from scope).

| Axis | Result | Actionable |
|---|---|---|
| Standards | APPROVE post-remediation — one hard violation (dead `subject` computed) fixed; remaining items are judgement calls | 1 hard + 1 inconsistent-guard — **fixed**; 4 judgement calls noted |
| Spec | APPROVE — all 12 issue items traced to implementation; no scope creep; test-plan coverage claims verified against real spec cases | 1 guard gap — **fixed**; 1 spec-silent edge + 1 latent semantic noted |
| Thermo-nuclear | APPROVE post-remediation — BE half judged tight on first pass; FE layer split + W/L mispricing were real | 6 majors — **all fixed**; minors/nits noted |

### Findings remediated in-cycle

**Convergent (flagged by ≥2 axes):**
- Dead `subject` computed — template had already switched to `headline`
  (guidelines §3, hard). Deleted; also removed the now-unused
  `AnalysisTradeRecord`/`parseOccContractId` component imports.
- `priceChange` divided by `entryMark` unguarded while sibling helpers
  guarded theirs — `pct` is now `number | null` (`entryMark <= 0` →
  null) and the template gates the % subtext. No more `Infinity%`/NaN.
- `bindResultsDeepLink` was a near-verbatim copy of `bindDeepLink` —
  both now delegate to a private `bindQueryParamLink(param, handler)`;
  the two public methods keep their domain comments.

**Thermo-nuclear majors:**
- Row-metric derivation moved from the component into the store:
  `EventRow` now carries `outcomeText` / `priceChange` / `maePct` /
  `capitalRoc` computed once per record by `tradeRowMetrics(record,
  side)` — one narrowing pass instead of four per-cell branches, the
  OCC parse runs once per record not per CD pass, and the component is
  back to a dumb view per the feature-state convention.
- `capitalRoc` was hardcoding the CSP convention for every template —
  it now requires `side === TradeSide.SHORT` (both registered templates
  are SHORT CSP); a future debit/long template renders `—` until its
  own capital model exists rather than a confidently wrong number.
- `winLossOf` used binary `expiredItm` — a partial-ITM expiry (assigned
  $0.50 against $2.50 collected) counted as a loss. Now `exit` and
  `expired` share one rule: terminal mark (`exitPrice` /
  `intrinsicAtExpiry`) vs `entryMark` under the template's side —
  preserves every spec example (OTM→win, full-ITM→loss) and prices the
  middle correctly. Spec fixtures updated; a partial-ITM case added.
- `emitEntriesToChart` left `occIdInput` disagreeing with the plotted
  set — on successful load it now synthesizes `date,id` lines into the
  field (markers can't round-trip, the contract set can), same
  invariant `onLoad` maintains.
- `chartQuery` hand-concatenated the doc id — now uses the canonical
  `stOptionsAnalysisResultDocId()`.
- `onResultsDocId` ignored `registryVersion` — stale-registry docs are
  now refused with a named error instead of plotting silently (spec
  fixtures moved to `EXIT_REGISTRY_VERSION`; stale-refusal case added).

**Standards/Spec minors:**
- `openCount` backfilled per-aggregate in the Firestore converter —
  v1 docs lacking the field type-check to 0 instead of rendering blank
  (still flagged stale by the version gate).
- `outcomeOptions` now derives from a `Record<AnalysisOutcome, string>`
  satisfies-map — a new outcome variant fails to compile without a chip.
- Stale `worker.test.ts` comment ("dips to 1.0" → fixture emits 0.5)
  rewritten.
- Test-plan doc drift corrected ("4/5 → 80%" → the real
  8-expired+1-open → 100% case).
- New coverage: `eventRows` metrics (expired `priceChange`, `capitalRoc`
  side gate), converter v1 backfill, `?results=` stale refusal.

### Noted, not fixed (judgement calls / out of scope)

- ~40-line `resultDoc`/`makeXRecord` fixture factories duplicated across
  spec files — common in this codebase's specs; a shared fixture helper
  is a reasonable follow-up but not a blocker.
- `watchRunDoc` is a realtime listener for an effectively immutable
  `startDate` — consistent with the store's watch pattern; the
  docId-IS-runId (#1430) coupling is documented in `watchList`.
- `expiration == today` resolves 'error' though the position is live
  that day — borderline, spec-silent; revisitable if it ever surfaces.
- `markerDates[0] ?? null` in the emit util reads as unreachable — it's
  a type-level guard (`Set` → array index yields `string | undefined`),
  not dead logic.
- Spec axis caveat: leg C of the all-OTM probe recomputes from the same
  bars source the worker uses — validates map-keying/math, can't detect
  a systematically wrong source.
- Cell-index DOM assertions (`cells[4]`) in the component spec are
  brittle to column reorder — accepted, table shape is stable.
- Foreign #1423 half-changes: `option-chart.component.spec.ts`
  references `onChipLeave` which doesn't exist in the working tree —
  the other session's spec/component halves are mid-flight; not #1431.

### Test results

- BE `tsx --test` (options-analysis + options-replay): **146/146 PASS**
- Full jest suite: **5460/5460 PASS, 308 suites** (pre-remediation)
- Post-remediation affected-paths rerun: **100/100 PASS, 6 suites**
- `tsc -p tsconfig.app.json`: clean; `typecheck:tests`: no #1431-file
  errors (pre-existing foreign-session failures in paper-trading /
  rh-agent-mcp / position-groups / #1423 `onChipLeave` only)

**Verdict: PASS** — all critical/major findings remediated and
re-verified; residual items are documented judgement calls.
