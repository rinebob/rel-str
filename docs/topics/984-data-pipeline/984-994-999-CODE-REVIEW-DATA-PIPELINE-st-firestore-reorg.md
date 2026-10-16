**Topic:** ST Firestore Reorg  
**Topic Slug:** st-firestore-reorg  
**Thread:** Data Plane Consolidation  
**Thread Slug:** data-plane-consolidation  
**Issue:** #994  
**Thread Parent:** #985  
**Topic Parent:** #984  
**Task:** #999  
**Domain:** DATA-PIPELINE  
**Type:** CODE-REVIEW  
**Status:** Complete  
**Created:** 2026-10-15  
**Last Updated:** 2026-10-15  

# CODE REVIEW — SHARED-IMPL: st- ID builders + mapping helpers (#999)

## Change set

- NEW `shared/st-ids.ts` + spec — `stSignalOccurrenceId`, `stTicketId`, `stTradeId`, `stPositionGroupId`, `ORIGIN_TYPE_TO_TRADE_CODE`; `@st/ids` alias in all three configs
- `shared/st-order-tickets.ts` + spec — `mapOrderSourceToOriginType`, `mapLegacyTicketStatus` (#999 section)
- `shared/st-signals.ts` + spec — `stSignalStatusFromBarStatus`
- `functions/src/st-cloud-function/signal-persister.ts` — delegates barStatus→status to the shared helper
- `scripts/verify/data-pipeline-st-ids-999.{ts,md}` + run-all/README registration
- IMPL SHARED §3/§4 updated to as-built

## Standards

PASS. `st*` naming matches #997 helpers; `formatYYMMDD` reused (no dup); `Object.hasOwn` origin guard matches the #997 poison-key fix and is now **pinned** (spec + verify assert `'toString'` throws); `'expired'` arm pinned; mode literal single-sourcing via `ST_MODES` considered — the liv/pap prefix map is the only place that derivation exists, kept inline as the source of truth. Persister JSDoc slimmed to point at the canonical helper.

## Spec

PASS. All three issue criteria and IMPL §3/§4 items delivered: four builders with the specified layouts, both migration mappers, NN rollover + equity-omits-contract tests, verify script. No #1000+ scope pulled in. Watch-item for #1003: legacy `signalDedupeKey` is `{SYM}_{signalType}_{barDate}` — field order differs from `stSignalOccurrenceId`; the migration must rebuild `origin.signalId`, never pass through. TEST doc's example id (`…CSP-030-45-20261120-P155.00-01`) uses an 8-digit exp + `P`-strike — stale draft convention; builder is format-agnostic (segments are opaque, dash-free strings) so either convention emits correctly, but #1003+ must pick one and the P/C flag lives in the expr/`optionType`, not the id.

## Thermo-nuclear

No Critical (no production callers yet — layouts land before writers). Dispositions:

| Finding | Severity | Disposition |
|---|---|---|
| `signalDedupeKey` arg-order swap compiles clean and mints byte-valid wrong-layout ids | Major | **Fixed** — `stSignalOccurrenceId` validates `barDate` as `YYYY-MM-DD`; a signalType in that slot throws |
| ISO `expiration` (`YYYY-MM-DD`) → phantom `-` segments in trade ids | Major | **Fixed** — `exp`/`strike` reject `-`; JSDoc calls out the conversion duty |
| `expr` case-split (`csp-030-45` vs `CSP`) mints duplicate ids | Major | **Fixed** — `expr` uppercased like `symbol` |
| Unconstrained segment/seq garbage (empty symbol, seq 0/-1/1.5/NaN, empty ticket id) | Major | **Fixed** — non-empty + positive-integer guards |
| `{NN}` allocation contract undocumented → silent overwrite risk | Major | **Fixed** — module header now requires transaction/`create()` allocation |
| Migrated `paper` tickets land non-terminal (`submitted`) | Major | **Documented** — mapper JSDoc flags the #1003 settle-or-reconcile duty |
| `stSignalOccurrenceId` vs `signalDedupeKey` layout swap | Major | **Fixed** — cross-ref warning in module header + builder JSDoc |
| No `parseStTradeId` | Minor | Accepted — ids are write-keys; no reader parses segments yet (NN is always last; dashed `expr` is idempotent, not ambiguous). Add a parser when a consumer needs one. |
| Legacy `'submitting'`/`'queued'`/`'resting'` never persisted | Nit | Accepted — forward-cover arms are harmless; migration logs unmapped counts |
| `validateStTicketTerms` integer-only vs fractional closes | Nit | Watch — management close path may need a fractional channel; revisit in #1013-range tasks |

## Test results

- `shared/st-ids.spec.ts` + mapper/barStatus specs — **43/43 pass**
- `scripts/verify/data-pipeline-st-ids-999.ts` — **30/30 checks OK**
- Functions sweep (`tests/functions` + shared) — 237/237 incl. persister consumers
- Shared/core sweep — 885/886; sole failure is the pre-existing unrelated `screenshot-capture-contracts` PositionType expectation
- `cd functions && npm run build` — green

## Round 2 — post-remediation re-review

The user requested a second pass ("that's a lot of findings"). All three axes
re-ran against the post-fix code.

| Axis | Verdict |
|---|---|
| Spec | **PASS** — all criteria delivered; TEST-doc example traced byte-identical through the builder (no `requireNoDash` conflict) |
| Standards | **PASS** — the only partial was stale `#998`-only file headers in the domain spec files; **fixed** (now `#998/#999`) |
| Thermo-nuclear | No Critical or Major remaining; findings below |

| Finding | Severity | Disposition |
|---|---|---|
| `stSignalOccurrenceId` left `symbol`/`signalType` unvalidated — `_` in symbol corrupts the `_`-layout boundary; `/` is Firestore-illegal in doc ids | Major | **Fixed** — non-empty + `/`-rejection on both segments; `_` rejected in symbol |
| `requireNoDash` too narrow — `/` in `exp`/`strike`/`symbol`/`expr`/ticket-id mints illegal doc ids (e.g. US-format `01/16/2026`) | Major | **Fixed** — `/` rejected in every segment of every builder |
| Non-injective expr/contract boundary — `expr='CSP-030-45'` vs `exp='030'`+`strike='45'` spoof the same tail | Minor | **Fixed** — `exp` pinned to 6 or 8 digits; a non-date can't impersonate the boundary (the residual collision — `expr` carrying the full contract string vs separate segments — is semantically the same trade, so identical id is correct idempotence) |
| Invalid `Date` mints NaN-segment ids via `formatYYMMDD` | Minor | **Fixed** — `requireValidDate` in `stTradeId`/`stPositionGroupId` |
| `expr` JSDoc mis-described the case-normalization | Nit | **Fixed** — JSDoc rewritten; template-key vs expression-code convention flagged as a #1003 decision |
| `barDate` regex can't distinguish `barDate` from `marketDate` (both `YYYY-MM-DD`) | Minor | **Accepted** — shape validation can't detect same-shaped wrong values; `2026-99-99` passes shape (calendar validation out of scope). Callers must pass the right field. |
| `mapLegacyTicketStatus('paper')` → non-terminal `submitted` — soft guard only | Minor | **Documented** — JSDoc keeps the #1003 settle-or-reconcile duty; a hard `null` would lose the mode signal |
| Legacy `'submitting'` → `'submitted'` could resurrect never-placed intents | Minor | **Accepted** — #1003 logs unmapped/edge statuses |
| Dash-bearing symbols (`BRK-B`) unguarded in the dashed layout | Minor | **Accepted** — real broker tickers can carry `-`; fail-loud rejection could block legitimate trades. #1003+ design consideration (escape or constrain by symbol list). |
| Persister diff caveat — was the old check `=== 1` or truthy? | Verify | **Closed** — parent confirmed the old inline code was `barStatus === 1`; semantics identical. `-1` entries never reached `CONFIRMED` before or after. |

### Round-2 test results

- `shared/st-ids.spec.ts` + mapper/barStatus specs — **46/46 pass** (3 new: `_`/`/` occurrence segments, invalid-Date + `/` segments, non-digit `exp`)
- `scripts/verify/data-pipeline-st-ids-999.ts` — all checks OK incl. new `/`, `_`, `NaN`-Date, `1e21` pins; the `.md` guide was updated to match
- `cd functions && npm run build` — green

## Verdict

**PASS** — round 2 closed every Major the first pass surfaced plus the `/` hole
thermo round-2 found. The id layouts are self-defending (arg-swap,
phantom-segment, `/`-illegal, case-split, bad-seq, invalid-Date all throw),
the seq-allocation contract is documented, and both migration mappers carry
the #1003 reconciliation notes downstream tasks need.
