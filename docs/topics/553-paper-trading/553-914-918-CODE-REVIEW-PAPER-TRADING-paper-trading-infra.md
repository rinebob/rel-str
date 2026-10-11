# CODE-REVIEW — #918 BE: auto-paper ingest fill

**Topic:** Paper Trading Infra  
**Topic Slug:** 553-paper-trading  
**Thread:** Signals Auto Paper Trade  
**Thread Slug:** signals-auto-paper-trade  
**Issue:** #918  
**Thread Parent:** #904  
**Topic Parent:** #553  
**Task:** #918  
**Domain:** BE  
**Type:** CODE-REVIEW  
**Status:** Complete  
**Created:** 2026-10-10  
**Last Updated:** 2026-10-10  

Three-axis review (Standards / Spec / Thermo-Nuclear) of the working-tree
diff on top of the shipped #917 base: `auto-paper-ingest-pass.ts` fill
pipeline, `auto-paper-ingest-task.ts` session wiring, specs, prod
dry-run verify script, guide + registrations.

## Verdict

**PASS after fixes.** No criticals. Two majors driven by the review
(screenshot capture removed, `listPaperTrades` leak plugged), one
pre-existing stats-pass interaction deferred to #919 with a specific
recommendation.

## Findings & dispositions

### Majors — fixed

| # | Finding | Disposition |
|---|---|---|
| TN-1 | ~50–200 sequential fills × (txn + `ORDER_FILLED` screenshot capture ≤10s) vs 540s budget | **Fixed:** `ledgerDeps(db)` — no screenshot lifecycle for auto-paper forensics trades. Dedupe check moved **before** the batched quote call (fully-deduped reruns burn zero MCP calls — spec-pinned). `getSignals`/`getSymbolMeta` reads parallelized; meta hoisted to once-per-symbol and failure-tolerant (missing meta still fills — stamps are optional slices). |
| TN-3 | `handleListPaperTrades` has **no userId filter** — auto-paper's ~200/day trades would flood `trading/paper` | **Fixed:** `includeAutoPaper?: boolean` on `ListPaperTradesRequest`; handler post-filters `t.userId !== AUTO_PAPER_USER_ID` unless the flag is passed. #921's surface opts back in via the flag. |

### Minors — fixed

| Finding | Fix |
|---|---|
| Raw-quote doc stored a synthesized summary, not the verbatim quote (IMPL §3.6d "mark-pass habit") | New `findEquityQuoteItem` in `rh-mcp-shapes.ts` returns the raw per-symbol node; `rawResponse` now carries `quote: <verbatim item>` + context keys; `extractEquityPrice` refactored onto it |
| `fill.rawQuoteRef` never set | rq id computed pre-fill; `fill.rawQuoteRef = rqId` — test asserts id equality |
| `underlyingClose` omitted — sibling signal fill seeds `marks[fill.date]` | `underlyingClose: price` added |
| `getSignals` outside try — one corrupt doc fails all 3 attempts → zero fills | Isolated per-symbol try → `errors[]` + `st_autopaper_signals_failed`; parallelized |
| `signalTimeframe: signalType[0]` cast ignored `entry.timeframe` | Uses `w.entry.timeframe` (the typed field) |
| `new Date('2026-02-30')` rolls silently — invalid barDate → wrong-but-deterministic tradeId | `isValidMarketDate` guard → `st_autopaper_bar_date_invalid` + filtered |
| Non-trend-rider types in `config.signalTypes` → per-item throw in `errors[]` | `descByType` precomputed once; unsupported types warn once (`st_autopaper_signal_type_unsupported`) and count filtered |
| `'already exists'` substring match brittle | Case-insensitive `/already exists/i` |
| `gate.scope!` non-null assertion | `AutoPaperIngestResult` → discriminated union; `reason`/`scope` typed `never` on the opposite variant |
| Early `st_autopaper_ingest_complete` logs had `errors: undefined` vs count | Single `complete()` helper — identical shape every exit |
| `manager.close()` throw masks the real error | try/catch → `st_autopaper_session_close_failed` warn |
| `getSymbolMeta` called once per signal (2× for V1+V2 same symbol) | Once per unique symbol, parallel; failure → warn + `{}` |
| Stale `@topic` headers, guide spec-count | Updated |

### Flagged — not fixed (out of #918 scope)

| # | Finding | Where it lands |
|---|---|---|
| TN-2 | **Stats pollution:** `paper-stats-pass` `listTrades` has no userId filter → auto trades roll into `stats-all` (mixing forensics into user P&L) and `stats-var-trailing-8`. `stats-sig-{SYM}_{type}_{barDate}` docs are the intended feature output — unbounded but by design. | **#919 decision:** recommend filtering `userId === AUTO_PAPER_USER_ID` out of the `all`/`var-*`/`sym-*` scopes and keeping the `sig-*` + auto-paper-specific scopes (`sigtype-`, `dir-`, `sector-`, `ind-`, `captier-`, `sigstatus-`, `capturelist-` via #916 builders). |
| rq orphan | `writeRawQuote` after fill: a throw leaves the trade committed; retry dedupes → audit doc never heals. Rare; trade still correct. | Accept; note for ops |
| `listMembers` legacy docs | Bare-id `symbol-lists/NEW` docs lacking a `key` field are invisible to the `where('key'==)` fallback | Caveat — PRIMARY is prod-verified (`key` present, 206 members); `ownerUid` is now wired through scope so the common case never hits the fallback |
| Timeout partial-run | A hard 540s timeout mid-loop logs no `st_autopaper_ingest_complete` | Dedupe makes the retry resumable; acceptable |
| `callTool` → `undefined` envelope | Unparseable MCP envelope resolves `undefined` → per-symbol `quoteFailed` | Covered by per-symbol logs |

### Scope decision recorded

`lists: ['PRIMARY']` is the operating scope (user decision mid-impl);
`'*'` remains a config-only escape hatch. `ownerUid` is now wired
`config → scope → listMembers` (it was a dead field before — the
`{uid}_PRIMARY` doc is now read deterministically, not via
first-match fallback).

## Round 2 — convergence pass (verdict: converged)

Re-verification of the restructured fill pipeline; all round-1 fixes
confirmed correctly applied. New findings — all addressed:

| Finding | Disposition |
|---|---|
| Dangling `fill.rawQuoteRef` if `writeRawQuote` throws post-fill (retry dedupes, never backfills) | **Fixed by reordering** — audit doc is written *before* `applyEntryFill`. A failed rq write blocks nothing durable and retries self-heal (same rq id overwrite); an orphan rq doc beats a trade pointing at a missing audit doc |
| `rqId` date segment used dispatch instant, not quote market date (repo convention, repository.ts:260) | `buildRawQuoteId(tradeId, new Date(fillDate+'T12:00Z'))` |
| Parallel `push`es → nondeterministic fill/error ordering | `pending.sort` by (symbol, signalType) |
| First early-exit log had `errors: undefined` (dropped by JSON.stringify) | `complete()` hoisted above the candidates check — uniform shape on every exit |
| Test gaps: `includeAutoPaper` exclusion, rq-write failure path | Both spec'd — read-callables +1, ingest +1 |
| Verify script lacked the `isValidMarketDate` guard | Added — malformed prod barDate prints INVALID, not a NaN-id |

Downstream passes confirmed safe by the agent: settlement skips
share-only trades; mark pass handles share legs; FE never passes
`includeAutoPaper` (backward compat).

**Stopped at 2 rounds** — round 2 yielded one MINOR + nits, all fixed;
no new majors.

## Post-fix verification

- `auto-paper-ingest-pass.test.ts`: **28/28** (incl. pins:
  dedupe-before-quote zero-call, getSignals isolation, meta once-per-symbol,
  verbatim quote + `rawQuoteRef`, `underlyingClose`, barDate-keyed id,
  ownerUid pass-through, rq-write-failure blocks fill)
- `read-callables.test.ts`: `includeAutoPaper` exclusion covered
- `test:paper-trading` suite: **197/197** · `test:st-run-completion`: **7/7**
- `tsc --noEmit`: clean on all touched files
- Prod dry-run (`paper-trading-auto-paper-918-ingest.ts`): ALL CHECKS PASSED —
  run `2026-10-09_fri_123229_pdr`: 156 candidates → 46 PRIMARY members →
  barDate-keyed tradeIds/signalIds resolve correctly, 0 existing.
