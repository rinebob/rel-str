**Topic:** Paper Trading Infra  
**Topic Slug:** paper-trading-infra  
**Thread:** Signal Selection  
**Thread Slug:** signal-selection  
**Issue:** #1647  
**Thread Parent:** #1117  
**Topic Parent:** #553  
**Task:** #1650  
**Domain:** PAPER-TRADING  
**Type:** CODE-REVIEW  
**Status:** Complete  
**Created:** 2026-11-22  
**Last Updated:** 2026-11-22  

# Code Review — #1650 BE-IMPL: signal-review callables (queue + bundle)

Three axes run in parallel (Standards, Spec, Thermo-nuclear) over the
task diff, then a serial second pass. **Verdict: PASS** — 1 critical +
6 minors found and fixed in-gate, all re-verified green.

## Diff under review

- `functions/src/paper-trading/signal-review-callables.ts` (new — handlers,
  `SignalReviewDeps`, `signalReviewProdDeps`, two `onCall` wrappers)
- `functions/src/index.ts` (+5-line export block)
- `functions/package.json` (`test:paper-trading` += spec path)
- `tests/functions/paper-trading/signal-review-callables.test.ts` (new, 19 specs)
- `functions/scripts/verify/paper-trading-signal-review-callables-1650.{ts,md}` (new)
- `functions/scripts/verify/run-all.ts` + `README.md` (registrations)
- `docs/…/553-1117-1642-IMPL-PAPER-TRADING-BE-signal-selection.md` (2 doc-drift corrections)

## Axes summary

### Standards — 1 critical, 2 minor, 4 nit

Callable structure, auth checks, `HttpsError` mapping, cors allowlist,
error-code mapping, id arg orders, Firestore query/index semantics, dep
injection, test conventions, and verify-runbook format all verified
faithful to the `signal-trade-callables.ts` sibling.

### Spec — all ACs MET

Every acceptance criterion evidenced (AC1–AC6; AC7 verified by parent
runs). The scoped-join decision verified correct against prod code:
accept-flow trades stamp `canonicalOccurrenceDecisionId` (no barDate)
and join `checked:false`; curation-mint trades join via
`signalDedupeKey`. Tests pin both directions. Two doc-drift minors
(IMPL enumerated 7 deps — `getOwnerUid` added as 8th; "filtered in the
query" → filtered in the handler to ride the existing index) — both
docs corrected in-gate.

### Thermo-nuclear — PASS-able, 6 minor, 5 nit

Data-model sound: per-key merge-set can't clobber other symbols'
stamps; `signalId→tradeId` is a deterministic function so
last-write-wins is structurally safe; narrowed `Pick` dep is honest
contract narrowing, not a smell; `IN_QUERY_CHUNK=30` correct.

## Findings — all fixed in-gate

| Sev | Finding | Fix |
|-----|---------|-----|
| critical | Spec file failed `tsc -p tests/tsconfig.json` — `bundleReq(unknown)` produced `data.symbol: unknown` (12×TS2345; wired into `npm run validate`) | `data` cast to `GetSignalReviewBundleRequest` marking the negative-input seam; typecheck now clean |
| minor | Non-UTF-8 byte (cp1252 `0x97`) at signal-review-callables.ts:62 | Replaced with UTF-8 em-dash; file re-validated UTF-8 |
| minor | Stamp fired before row construction — a corrupt-doc throw consumed the divider (`lastOpenedAt` advanced past signals never rendered) | Rows built first, `stampOpened` moved last; `previousOpenedAt` still pre-stamp |
| minor | `direction` emitted verbatim — legacy corpus docs persist `'LONG'/'SHORT'` | `normalizeStSignalDirection` applied (sibling convention); unnormalizable rows dropped |
| minor | Symbol validated only as non-empty — arbitrary keys writable into shared `st-config/signalReview` | `^[A-Z0-9.\-]{1,12}$` ticker-shape guard → `invalid-argument` |
| minor | `getSymbolSignalDates` ran ~10 serial `in` chunks | `Promise.all` over chunks |
| minor | Dep comment claimed prod filters `timeframe=='D'` | Comment corrected — handler filters (index rationale documented) |
| nit | Members not uppercased (a lowercase list member would miss merges) | `.trim().toUpperCase()` before dedupe |
| nit | Double map lookups in queue-row conditional spreads | Hoisted to `const`s |
| nit | `dates.set(d.id, v)` keyed by doc id rather than the matched field | Keyed by `data.symbol` |
| nit | IMPL doc: 7-dep enumeration missing `getOwnerUid`; "filtered in the query" | Both corrected |

**Accepted without change (documented):** `SignalReviewDeps` stays one
interface per the task AC (thermo M5 — splitting to BundleDeps/QueueDeps
noted as an option); `lastOpenedAt` global-per-symbol (not per-viewer)
consistent with the single-user surface + sibling auth pattern (thermo
M4 note); `listOccurrences` unbounded — practically ~1k docs/yr/symbol
(thermo N1); `listSignalTrades` fetches full docs — `Pick` is contract
honesty (thermo N3); stamp-then-fail divider edge already triaged to
**#1654** by the #1649 review — the in-gate reorder removes this task's
contribution to it anyway.

## Test results

- `tests/functions/paper-trading/signal-review-callables.test.ts` — **19/19**
- `npm run test:paper-trading` — **437/437**
- `tsc -p functions/tsconfig.json` — clean (1 pre-existing foreign error
  in `options-engine-eod-selection-1501.ts`, unrelated)
- `tsc -p tests/tsconfig.json` — clean
- `npm run build` (functions esbuild) — clean
- Verify `paper-trading-signal-review-callables-1650.ts` — **14/14 DRY**,
  **20/20 `--live`** against real Firestore (ownerUid resolved, real
  list members returned, AAMI bundle daily+newest-first, stamp landed
  on `st-config/signalReview`)
- Full jest — **6190/6190 tests pass**; 1 suite fails to compile
  (`options-variant-builder-dialog.component.spec.ts`) — foreign **#1504
  — Variant builder dialog** mid-implementation stream, zero overlap
  with this diff

## Pass sequence

```text
First pass complete — 1 critical (spec typecheck break under
  tsc -p tests/tsconfig.json), ~6 minors (encoding byte, stamp-before-rows
  ordering, unnormalized direction, permissive symbol validation, serial
  chunks, dep comment/doc drift), nits — all fixed in-gate and re-verified.
Second pass complete — fixes re-verified green (19/19 spec incl. new
  legacy-direction pin, 437/437 suite, 14/14+20/20 verify, tsc×2 clean);
  union of axes covers the whole diff; no unexamined error path.
Convergence: PASS — no remaining critical/major findings; every fix
  re-verified.
```

## Verdict

**PASS** — task advances to `7_QA`.
