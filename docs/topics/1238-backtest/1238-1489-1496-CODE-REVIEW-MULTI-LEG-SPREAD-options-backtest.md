**Topic:** Options Backtest  
**Topic Slug:** options-backtest  
**Thread:** Multi-leg Templates  
**Thread Slug:** multi-leg-templates  
**Issue:** #1489  
**Thread Parent:** #1270  
**Topic Parent:** #1238  
**Task:** #1496  
**Domain:** MULTI-LEG-SPREAD  
**Type:** CODE-REVIEW  
**Status:** Complete  
**Created:** 2026-11-14  
**Last Updated:** 2026-11-14  

# Code Review — BE Task: SA pick-semantics spike (#1496)

Spike deliverable: a written pick-semantics spec (issue comment on #1496) pinned into `IMPL-BE` module 0, confirmed against SA source at `av-proxy-api/functions/src/v2/historical-options-corpus/services/options-delta-picker.service.ts`. No rel-str production or test code changed under this task.

## Standards

No issues found.

- Spec is recorded in two places with a single source of truth: the issue comment (findings) and IMPL-BE module 0 (pinned spec). IMPL doc header follows the plain-markdown field convention.
- External-system claims verified against the real code path, not docs alone: `pick-materialize.service.ts:148` passes the stored chain verbatim (`chain.slice()`), confirming no preprocessing between storage and `pickCellsForDate`.
- Single-writer check performed: only `pick-materialize.service.ts` invokes the picker; only `options-delta-pick-cell.writer.ts` emits day entries — no hidden second algorithm.

## Spec

| Acceptance criterion | Verdict |
|---|---|
| Written pick-semantics spec covering expiry selection, delta metric, tie-breaks, filters | **Met** — two-stage (nearest-DTE expiry, tie → longer actual DTE; then argmin `|observedDelta − signedTarget|`, tie → larger \|delta\| → lowest contractId); signed target `-pct/100` put / `+pct/100` call; identity-only eligibility, no liquidity filter; `no_match`/`no_chain` vocabulary |
| IMPL-BE updated with the confirmed spec | **Met** — module 0 rewritten from "spike pending" to the confirmed algorithm + the documented divergence vs `selectOptionContract` |
| Golden expectations defined for the parity harness | **Met** — `selectContractAtCoordinate(getEodChain(S,T), C).contractId === pickDoc[C].days[T].contractId` over a cell/day fixture matrix; parity premise verified (`getEodChain` wraps `partnerHistoricalOptionsV2`, the same SA-served corpus) |

## Thermo-nuclear

No issues found.

- The recorded semantics are behaviorally confirmed, not comment-trusted: SA's own suite (`options-delta-picker.service.test.ts`, 21 tests, all pass) asserts each documented rule — signed-delta argmin, expiry tie → longer DTE, delta tie → larger |delta|, dte≥0 eligibility, omitted-vs-fabricated quote fields, `no_match` vs `no_chain`.
- Honest residual risk is stated, not hidden: no real stored-chain fixture exists locally for an end-to-end picker-vs-pick-doc check; that comparison is designed into #1497's parity harness as its purpose.

### Advisory (non-blocking)

- (minor) Live-adapter note worth carrying into #1497/1502: SA selects within exactly ONE expiration (nearest to target DTE), so live candidate enumeration only needs instruments at the nearest expiry (+ equidistant tie) — cheaper than today's 4-expiration band scan. Already recorded in the issue comment; restated here for the downstream task.
- (nit) RH candidates build `delta` from `get_option_quotes`; a missing/undefined quote-delta row must be treated as ineligible (unparseable per SA's rule), not defaulted — a contract note for #1502's implementer.

## Test results

Suite not run — this task changed no rel-str code (docs + issue artifacts only), and the working tree carries unrelated in-flight changes from other threads whose failures could not be attributed to this task. The spike's verification is SA's own executed suite (21/21 pass) plus the single-writer and parity-premise checks documented above.

## Verdict

**PASS** — all acceptance criteria met; spec confirmed against executed evidence, not assumed.
