**Topic:** Options Backtest  
**Topic Slug:** options-backtest  
**Thread:** Multi-leg Templates  
**Thread Slug:** multi-leg-templates  
**Issue:** #1489  
**Thread Parent:** #1270  
**Topic Parent:** #1238  
**Task:** #1502  
**Domain:** MULTI-LEG-SPREAD  
**Type:** CODE-REVIEW  
**Status:** Complete  
**Created:** 2026-11-22  
**Last Updated:** 2026-11-22  

# Code Review — BE Task: expression-fill-pass re-target to shared selection (#1502)

## Verdict

**PASS** — r1 FAIL (2 majors) → remediation → r2 PASS. All three axes
re-ran on the final diff: Standards ship-ready, Spec MET on all 3
acceptance criteria, Thermo-nuclear APPROVE with no presumptive blockers.

## Change summary

`functions/src/paper-trading/passes/expression-fill-pass.ts` retargeted
from the DTE-band filter + `selectOptionContract` weighted scorer to the
shared `selectContractAtCoordinate`: expirations fetched nearest-to-
`targetDte` (bounded at `MAX_EXPIRATIONS` = 4, equidistant → longer DTE),
instruments + quotes over that set, signed coordinate
`{type, ±|targetDelta|, dte: targetDte}` (template carries unsigned
magnitude, signed by option type), fill price = the RH quote mark of the
selected contract. A selected-but-unpriceable pick skips with the same
`no_contract` category — never a silent second choice. Same `selectContract`
feeds both fill paths (staged `pap_*` ticket mint, legacy PENDING fill).
`shared/paper-trading-contracts.ts`: `SignalExpressionTemplate.minDte`/
`maxDte` → optional `@deprecated` (no reader remains), dropped from
`SIGNAL_EXPRESSION_TEMPLATES` seeds, band-era doc comment rewritten,
`targetDelta`/`targetDte` conventions documented. Verify script
`options-engine-expression-fill-1502.{ts,md}` — DRY fake-chain through the
real pass + selector (12 checks); `--live` real SPY chain via the prod
KMS session manager with pass≡selector parity (19 checks). Registered in
`run-all.ts` + both verify READMEs.

## Round 1 findings → remediation

| Severity | Finding | Resolution |
|---|---|---|
| major | 0-DTE fills reachable — `dte >= 0` fetch filter + selector `dte ≥ 0` eligibility dropped the retired scorer's `dte<=0` reject; a same-day expiry could win on a thin chain | `e.dte > 0` fetch floor + spec pin ("never fills a same-day expiration" — same-day never reaches the instrument fetch, fill lands on the real expiration) |
| major | `minDte`/`maxDte` required-but-write-only on `SignalExpressionTemplate` — every producer forced to supply dead band values | optional + `@deprecated`; removed from `SIGNAL_EXPRESSION_TEMPLATES` seeds; stale "DTE band" doc rewritten (full field removal deferred — FE backtest form keys them for the separate leap-drop `OptionContractSelectionCriteria` contract) |
| minor | fetch-bound comment overclaimed "the true nearest expiration is always a candidate" | comment scoped to nearest-*listed*; eligibility caveat + floor rationale stated |
| minor | `targetDelta` sign convention undocumented on the contract | field doc added (unsigned magnitude, signed by `optionType`) |
| minor | unused value imports in verify script | removed |
| nit | `} as StOrderTicket` mask; hardcoded `4` oracle; `GOOGLE_CLOUD_PROJECT` assignment; `void main()` vs convention; run-all whitespace churn; header wrap | all remediated — cast removed, `??=` idiom, `main().catch`, churn reverted to byte-exact, oracle annotated, wrap fixed |

## Round 2 findings → remediation

| Severity | Finding | Resolution |
|---|---|---|
| minor | comment attributed the floor to "the retired band's minDte >= 1" — the actual guarantee was `selectOptionContract`'s `dte <= 0` early-return | reworded to "the retired scorer's dte<=0 reject" |
| minor | duplicate `55.` ordinal in verify README numbered list (foreign `#1649` insert) | tail renumbered — `#1649`=55 … `#1502`=60 |
| nit | `kind === 'option' && expiration` assertion vs sibling guard-block convention | rewritten as `if (kind === 'option')` narrowing |
| nit | header comment wrapped mid-phrase | fixed |

## Axis summaries

**Standards** — RH MCP tool calls match `rh-mcp-shapes` helpers and the
`manage-open-pass` call contract; KMS session manager used correctly
(`callTool` prefix stripping, `close()` in `finally`); verify script
follows the sibling convention; deprecation approach sound. No standing
findings.

**Spec** — AC1 shared fn at concrete coordinate: MET
(`selectContractAtCoordinate`, no `selectOptionContract` import remains
in the pass). AC2 fill price = RH quote mark + ticket error paths
unchanged: MET (`sel.mark` on all three write paths; `no_contract`
category preserved; unpriceable pick skips rather than re-ranking —
the spec'd concrete-coordinate semantics). AC3 existing tests updated:
MET (band tests rewritten, 5 coordinate-semantics pins). Scope note:
the `dte>0` floor is a fetch-level bound in the same slot the retired
band occupied — not window scoring; out-of-band expirations still fetch
and fill (spec-pinned).

**Thermo-nuclear** — APPROVE. `dte>0` placement judged correct: the
shared selector's `dte≥0` admission is SA-parity-correct for the
historical engine (`eod-selection-pass`), while the realtime fill
engine needs the floor — a principled asymmetry, both sides documented.
Premise corrections verified: no FE zombie write path exists
(`SignalExpressionTemplate` is emitted server-side only); the FE
`minDte`/`maxDte` fields target the separate leap-drop criteria contract.

## Test results

- `expression-fill-pass.test.ts`: **30/30** (incl. new same-day-floor pin)
- `tests/functions/paper-trading/`: **437/441** — 4 failures are
  `analysis-dataset-writer` specs, pre-existing on HEAD (foreign `#553`
  lineage, commit `8be72113`; documented during `#1501`)
- Jest full suite: **6126 passed** (1 suite-compile blip was a stale
  transform cache on foreign mid-edit `#1117` contracts work — passes
  29/29 clean on re-run)
- Verify script: **12/12 DRY**, **19/19 LIVE** (real SPY chain via KMS
  session; pass minted `SPY261224P00660000` ≡ raw selector pick, Δ−0.290,
  mark 13.85, 33 DTE; no writes — ledger deps captured)
- Functions build clean; tsc clean on touched files

## Residuals / flagged follow-ups

- `eod-selection-pass` admits `dte≥0` rows (shared-selector design —
  backtest-correct for historical chains; realtime floor lives at this
  pass's fetch). No action required.
- Fixtures retain `minDte`/`maxDte` values — deliberate; exercises the
  deprecated-but-readable contract path.
- Foreign hunks in the working tree (`#1649` run-all/README registration,
  `#1117` signal-review contract block, `#1544`/`#1545` README rows) —
  staging hygiene at ship: hunk-level staging required.

## Pass protocol

```text
First pass complete (r1) — 2 major, 3 minor, 6 nit findings; verdict FAIL
Second pass complete (r2) — all r1 findings verified remediated; r2 residuals
  (comment attribution, README ordinal, && narrowing, header wrap) fixed in-cycle
Convergence: PASS — all three axes clean on the final diff
```
