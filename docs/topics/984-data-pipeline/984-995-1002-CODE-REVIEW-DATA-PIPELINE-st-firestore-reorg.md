**Topic:** ST Firestore Reorg  
**Topic Slug:** st-firestore-reorg  
**Thread:** Data Plane Consolidation  
**Thread Slug:** data-plane-consolidation  
**Issue:** #995  
**Thread Parent:** #985  
**Topic Parent:** #984  
**Task:** #1002  
**Domain:** DATA-PIPELINE  
**Type:** CODE-REVIEW  
**Status:** Complete  
**Created:** 2026-10-16  
**Last Updated:** 2026-10-16  

# CODE REVIEW — BE-IMPL: st-order-tickets canonical writer + emission wiring (#1002)

## Change set

- `functions/src/order-tickets/st-order-ticket-writer.ts` — canonical `StOrderTicketWriter`: `emit()` mints deterministic `{liv|pap}_{idSeed}` docs via atomic `ref.create()` (ALREADY_EXISTS → no-op return); txn-guarded lifecycle (`markSubmitted` w/ brokerOrderId+reviewSnapshot, `markCancelPending`, `markCancelled`, `markFilled` w/ fillSummary, `markFailed` w/ lastError, `markExpired`); `filled` accepts `cancelled`/`cancel_pending`/`failed` (broker outcome wins, transient failures heal); all methods fail-soft. `StOrderTicketEmitter` is the single dep seam every call site `Pick`s from.
- `functions/src/paper-trading/passes/auto-paper-ingest-pass.ts` — `signal`/`auto:true`/`paper` ticket staged BEFORE `applyEntryFill` (`emitSignalTicket`/`fillTicket` helpers), `idSeed = tradeId`; filled after ledger success (incl. benign concurrent-create dedupe), failed on real errors.
- `functions/src/paper-trading/engine/passes/open-pass.ts` + `open-pass-timer.ts` — `program`/`auto:true` ticket before `placeBrokerageOrder`; mode read off the instance (`mode?: StMode` on the config signature — `paper` today, `live` honored once #1006 migrates instance docs); `idSeed = positionId`; writer hoisted once per timer tick.
- `functions/src/paper-trading/callables.ts` — `paperSignalOrder` stages the equity ticket (filled/failed with its ledger fill) + one staged ticket per expression template carrying `terms.expressionTemplate`; origin `signal` (with canonical occurrence id) vs `manual` from legacy `signalContext`, emitted only when present. `cancelPaperTrade` → `pap_{tradeId}` cancelled post-ledger, fail-soft, single `deps.now()`. PENDING trades still minted alongside (dual-write window; cutover is #1005).
- `functions/scripts/verify/data-pipeline-st-order-tickets-1002.ts` — read-only shape audit: id↔mode prefix, origin axes/linkage, `validateStTicketTerms`, state↔field coherence, submittedAt rules (see below).
- Tests: `tests/functions/st-order-ticket-writer.test.ts` (19 specs, `test:st-order-tickets`), ticket specs added to auto-paper (35), open-pass (11), signal-order + cancel-paper-trade. `package.json` registers `test:st-order-tickets` + the two previously-unregistered specs.

## Standards

PASS after fixes.

| Finding | Disposition |
|---|---|
| **Major** — `emit()` get-then-set could clobber a racing transition back to `staged` (loses fillSummary) | **Fixed** — `ref.create(doc)` + ALREADY_EXISTS catch: atomic, drops a read, re-emit is provably a no-op |
| Ticket dep surface spelled four ways across the three call sites | **Fixed** — exported `StOrderTicketEmitter` = `Pick<StOrderTicketWriter, emit|markFilled|markFailed|markCancelled>`; each dep `Pick`s its subset |
| `new StOrderTicketWriter()` per instance-loop iteration in the timer | **Fixed** — hoisted above the loop |
| `signalContext` emitted unconditionally for manual tickets (all-undefined object noise) | **Fixed** — emitted only when the legacy ticket carries signalContext |
| `cancelPaperTrade` `markCancelled` unguarded after ledger success + `deps.now()` called twice | **Fixed** — wrapped fail-soft with a warn log; one `nowIso` reused for ledger + ticket |
| `open-pass.ts` interior cast widening `StrategyInstanceConfig` | **Fixed** — extension moved to the `runOpenPass` signature; redundant `satisfies StMode` dropped |
| Duplicated `markFilled` block in auto-paper success + dedupe-catch paths | **Fixed** — `emitSignalTicket`/`fillTicket` helpers; the loop reads linearly |
| Test `as unknown as WriterDb` cast | **Kept** — matches the established `signal-date-writer.test.ts:96` fake-db convention (the alternative requires a structural txn surface that the real `Firestore` can't satisfy without a cast anyway) |
| Tautological idSeed assertion (compared a list to itself) | **Fixed** — now asserts emitted idSeeds == the PENDING tradeIds actually minted |

## Spec

PASS. Issue criteria and IMPL Phase 2 ticket-emission scope all delivered:

- All three BE action paths emit canonical tickets — auto-paper (`signal`/`auto`/`paper`), open-pass (`program`/`auto`, mode from instance), `paperSignalOrder` (staged per expression + equity resolved with its fill); `cancelPaperTrade` cancels the staged ticket.
- `brokerOrderId`/`reviewSnapshot` at submit, `fillSummary`, `lastError`, `cancel_pending` state — all stamped by the mark* methods with txn guards; terminals cannot re-open; fill-beats-cancel preserved.
- Emit-before-execution ordering verified by test at all three sites; deterministic idSeeds make retries idempotent.
- Legacy paths untouched: `order-intents` still written, PENDING trades still minted — cutover/migration is #1003/#1005 per the agreed scope (recorded on the issue).
- Deferred per scope: live-submit + management emission (writer exposes `liv_`/`management`/`positionGroupId` axes for #1003/#1015); expression-fill consuming staged tickets (#1005).
- Test-plan wording "staged tickets (not PENDING trades)" superseded by the dual-write scope decision — PENDING trades remain until the fill pass is rewired.

## Thermo-nuclear (adversarial)

PASS after fixes.

| Finding | Disposition |
|---|---|
| **Major** — audit FAILs every emitted paper ticket: `filled`/`cancelled` required `submittedAt`, but paper goes `staged→terminal` directly | **Fixed** — `submittedAt` now required only for `submitted`/`cancel_pending` (definitionally post-submit) plus ALL post-staging states when `mode === 'live'`; `failed` excluded (a live ticket can fail at submit) |
| **Major** — `filled` unreachable from `failed`: a transient markFailed then successful retry leaves the ticket permanently `failed` | **Fixed** — `failed` added to `filled`'s allowed-from; spec pins the heal path |
| `emit()` TOCTOU regression | **Fixed** (same as Standards Major — atomic create) |
| `refId` shared across all tickets from one `paperSignalOrder` call (spec's 1:1 ref_id mapping) | **Accepted residual** — harmless for paper (refId = idempotency lineage, not an RH key); flagged for #1015 when live wiring lands |
| Expression tickets' `markFailed` category (`paper-fill`) isn't an RH error category | **Accepted** — paper-only path; RH categories land with live submit in #1003/#1015 |
| Pre-#1002 trades / failed-emit retries never get tickets | **Accepted** — fail-soft doctrine; the canonical store self-heals via idempotent re-emit on retry |
| Open-pass live-mode `accountTarget` would be a paper acct id | **Moot** — no instance carries `mode` until #1006; live honoring is wired so the field lands correctly once it exists |

## Verification

- `cd functions && npm run test:st-order-tickets` — 19/19
- `cd functions && npm run test:paper-trading` — 236/236 (auto-paper 35, open-pass 11, signal-order incl. fixed assertion, cancel-paper-trade)
- `cd functions && npm run test:st-signals` — 34/34
- `cd functions && npx tsc --noEmit` — clean; `npm run build` — green (lib/index.js 1.9mb)
- Prod audit — `0 doc(s)`, `0 FAIL / 0 WARN`, AUDIT PASS (collection empty pre-deploy; the corrected rules now match the writer's own emitted shapes)

## Verdict

**PASS** — all three axes converged on the same two majors (audit self-contradiction, unhealable `failed`) plus the emit race; all remediated and re-tested. Minors are either fixed, accepted residuals with a documented owning task, or convention-matching. Ready for QA: `/proj qa 984 1002`.
