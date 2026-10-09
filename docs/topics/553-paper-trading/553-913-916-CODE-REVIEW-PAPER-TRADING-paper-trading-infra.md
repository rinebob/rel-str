**Topic:** Paper Trading Infra  
**Topic Slug:** paper-trading-infra  
**Thread:** Signals Auto Paper Trade  
**Blueprint:** #913 (SHARED)  
**Task:** #916  
**Topic Parent:** #553  
**Domain:** PAPER-TRADING  
**Type:** CODE-REVIEW  
**Status:** Complete  
**Created:** 2026-10-09  
**Last Updated:** 2026-10-09  

# Code Review — #916 SHARED: trade stamps + stats scope ids

## Scope

| File | Change |
|---|---|
| `shared/paper-trading-ids.ts` | `signalTradeDesc` (`EQV{n}{L\|S}` descs), `signalDedupeKey`, `scopeSlug` + six `statsScope*` builders (`sigtype-/dir-/sector-/ind-/captier-/sigstatus-`) |
| `shared/paper-trading-contracts.ts` | 10 optional `PaperTrade` stamp fields + `AUTO_PAPER_USER_ID = 'auto-paper'` |
| `functions/src/paper-trading/ledger.ts` | `PaperTradeOverrides` Pick extended to whitelist the 10 stamps |
| `shared/paper-trading-ids.spec.ts` / `paper-trading-contracts.spec.ts` | unit coverage |
| `scripts/verify/paper-trading-auto-paper-916-contracts.ts` (+ guide, `run-all`, README) | no-cred contract verify |
| `functions/scripts/verify/paper-trading-auto-paper-916-inputs.ts` | ADC prod-read verify of ingest inputs |

## Design decisions to probe

- `signalTradeDesc` derives a desc inside the existing `[A-Z0-9]+` contract so `buildTradeId(now,'sig',sym,desc)` is a deterministic doc id — dedupe = doc-existence check, no query.
- `signalDedupeKey` keeps the full `signalType` (deterministic `{SYM}_{TYPE}_{BARDATE}`) and rides the existing `signalId`/`listTradesBySignal` seam.
- Stamp fields flat on `PaperTrade` (top-level query axes), `signalIndicators` verbatim-mirrors `StSignalEntry.indicators` (`number|string|null`).
- Overrides stay a `Pick` whitelist — lifecycle fields (status/fills/legs/marks/order) cannot be overridden.

## Test results (post-review)

- Touched specs: **59/59** (`paper-trading-ids.spec.ts`, `paper-trading-contracts.spec.ts`).
- `functions tsc --noEmit` clean.
- Contracts verify (no creds): ALL CHECKS PASSED, incl. `acct-auto-paper`.
- Inputs verify (ADC, prod read): ALL CHECKS PASSED — run/jobs/run-ids shape confirmed, AAMI sector/industry/capTier, `PRIMARY` = 206 members.
- Full jest suite: 3249 pass / 1 fail — `screenshot-capture-contracts.spec.ts` `PositionType` expectation; pre-existing, unrelated to this diff.

## Findings and fixes

Three axes (standards / spec / thermo-nuclear) — all in-scope findings fixed in review:

| # | Severity | Finding | Fix |
|---|---|---|---|
| T1 | MAJOR | `signalTradeDesc` regex `/_V(\d+)_(LONG\|SHORT)$/` mapped `W_…V1_LONG` → `EQV1L`, identical to its daily twin — same-day D/W signals would silently collide on tradeId while `signalDedupeKey` disagreed | Regex anchored to `^D_.+_V…` — non-daily signal types **throw loudly**; spec asserts `W_`/`M_` throw; doc comment records the constraint |
| T2 | MAJOR (discovery) | `StRunIdDoc.signals` / `StSignalHistoryDoc.signals` declare a nested map, but `signal-date-writer` spreads `'signals.X'` keys through `set(merge)` → prod stores literal flattened keys. `stSignalHistory` callable (`dashboard-callables.ts:174`) reads `d.signals` only — likely returning empty. FE `signal.service.ts` already reads both shapes | **Reported, not fixed here** — pre-existing writer/interface/prod mismatch, needs a thread-level decision (fix writer, interfaces, or reader). BE IMPL updated: ingest enumerates flattened keys + tolerates nested map. Filed as accepted gap below |
| S1 | MINOR | Verify script hardcoded `'savant-trader/data/symbol-lists'` and `'paper-trading/trades/items'` literals while `ST_SYMBOL_LISTS_COLLECTION` / `paperTradingItemsPath(TRADE)` exist | Constants used |
| S2 | MINOR | `signalStatus`/`signalTimeframe` widened to `string` | Literal unions `'INTERIM'\|'CONFIRMED'` / `'D'\|'W'\|'M'` declared in the shared contract |
| S3 | MINOR | Redundant `entry as StSignalEntry` cast; `signalTradeDesc(entries[0])` could throw a generic error instead of a labeled FAIL | Cast removed; desc derivation wrapped in a labeled check |
| S4 | NIT | Stale doc comments — ids.ts header + `ParsedTradeId.desc` didn't mention `EQVn{L\|S}` | Comments updated |
| P1 | MINOR | TEST plan required a Jest assertion that `buildAccountId(AUTO_PAPER_USER_ID)` → `acct-auto-paper` (was verify-script-only) | Assertion added |
| P2 | MINOR | TEST plan required a cap-tier slug case like `statsScopeCapTier('LARGE_CAP')` | `LARGE_CAP → captier-large-cap` test added |
| P3 | MINOR | TEST plan required documenting that inputs differing only in separators (`'A-B'` vs `'A B'`) slugify identically — accepted collision | Documented on `scopeSlug` + spec asserts equality |
| P4 | NIT | IMPL said `signalIndicators: Record<string, number>` — implementation correctly widened to match `StSignalEntry.indicators` | IMPL doc corrected to `number \| string \| null` |
| P5 | NIT | IMPL named only `signalTradeDesc`/scope builders — `signalDedupeKey` added as an extra export; `signalTradeDesc` accepts any `V{n}` not just V1/V2 | Accepted — `signalDedupeKey` formalizes the IMPL's `signalId` construction; version-general regex is a harmless generalization |

## Accepted gaps / follow-ups

- **`signals.*` writer/interface/prod mismatch** — decision needed (fix `signal-date-writer` to emit a real nested map, or fix interfaces + `stSignalHistory` to enumerate flattened keys). Affects the new ingest read path (covered in BE IMPL) and is a probable live bug in the `stSignalHistory` callable. Filed as **BUG #931** under Thread #904.
- `signalTradeDesc` is daily-only by design — weekly signals joining auto-paper later need a timeframe char in the desc (comment flags it).
- `PaperTrade` carries 10 optional stamp fields — documented data-clump, justified as rollup dims.

## Round 2 — convergence pass

One agent re-verified all round-1 fixes (regex anchoring, union types, Pick whitelist, script constants, both-shapes read, spec assertions — all confirmed correct) and surfaced:

| # | Severity | Finding | Disposition |
|---|---|---|---|
| R1 | MINOR | `signalTradeDesc` still collapsed the *strategy* segment — a future `D_X_V1_LONG` would map to `EQV1L`, the same silent-collision class T1 fixed on the timeframe axis | Regex constrained to `^D_ST_TREND_RIDER_V(\d+)_(LONG\|SHORT)$` — non-trend-rider strategies throw loudly; comment + spec updated (`D_MEAN_REVERT_V1_LONG` throws) |
| R2 | NIT | `scopeSlug('')`/punct-only input → bare `sector-`/`ind-` scope ids | `scopeSlug` throws on empty slug |
| R3 | NIT | Inputs script dereferenced `jobs.docs[0]` / `entries[0]` after failed checks — TypeError instead of labeled FAIL exit | `process.exit(1)` after both checks |
| R4 | NIT (rejected) | Agent questioned whether prod run-ids really store flattened `signals.*` keys (claimed `set(merge)` splits dots) | **Rejected with evidence** — prod read showed `data.signals` undefined and literal `signals.D_ST_...` keys present; Admin SDK `set()` does not split dotted keys (only `update()` does). Comment accurate |

**Convergence: PASS** — every round-1 fix verified; round-2 produced one MINOR + two NITs, all fixed; no new MAJOR/CRITICAL.

## Verdict

**REVIEW PASS — converged in 2 rounds.** Round-1 major (`signalTradeDesc` D/W collision) fixed and re-verified; round-2 hardened the same fail-loud guarantee on the strategy axis. Second round-1 major is a pre-existing `signals.*` writer/interface/prod mismatch — reported for a separate decision (see Accepted gaps). #916 → `7_QA`; QA issue opened.
