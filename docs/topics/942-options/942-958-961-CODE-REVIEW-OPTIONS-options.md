**Topic:** Options Trading Support  
**Topic Slug:** options-trading-support  
**Thread:** Single-leg option orders  
**Thread Slug:** single-leg-option-orders  
**Issue:** #958  
**Thread Parent:** #943  
**Topic Parent:** #942  
**Task:** #961  
**Domain:** OPTIONS  
**Type:** CODE-REVIEW  
**Status:** Complete  
**Created:** 2026-10-12  
**Last Updated:** 2026-10-12  

# CODE-REVIEW — #961 Option contract + staging utils

## Verdict: PASS (after in-review remediation)

Two new pure-helper files under
`src/app/features/savant-trader/utils/` —
`option-contract.util.ts` (paste parse, chain/select → instrument args,
premium math) and `option-ticket-staging.util.ts`
(`buildOptionSignalTicket`) — plus their specs. No existing files
modified; no consumers exist yet (first consumer is #963).

## Axis summaries

- **Standards:** all external contracts verified correct
  (`parseOccContractId`, `OptionOrderTicket`/`OptionLeg`,
  `OptionInstrumentFilters`, `buildStOccurrenceDecisionId`,
  `DEFAULT_OPTION_MAX_PREMIUM_CASH_PERCENT` = documented config default
  25). Minor: `as StSignalItem` cast masked a non-enum `status` literal —
  **fixed in-review** (`SignalStatus.CONFIRMED`, casts dropped).
- **Spec:** all 4 task ACs MET; all 6 IMPL-specified functions present
  with correct shapes. Caller-side REJECT filtering judged correct — it
  is the equity convention (`stageCardTicket`), not a deviation, and the
  header documents the contract.
- **Thermo-nuclear:** one MAJOR (fixed, below); minors on fail-open
  fatfinger, paste edge cases, and caller-contract hazards for #963.

## Findings fixed in-review

1. **MAJOR — ticket-id collision across contracts.** `buildTicketId`
   resolves to the PT minute; two *different* contracts staged within one
   minute produced identical ids (`AAPL-OPT-261012-MON-1430PT`), and
   `OrderTicketService.createTicket` `.set()`s — no uniqueness
   enforcement — so the second ticket would destroy the first doc
   wholesale, including a live `refId` linkage. Equity can't collide
   (symbol+side dedup); the option flow explicitly allows multiple
   contracts per card. **Fix:** the OCC contract id is now the id
   discriminator — `AAPL-OPT-AAPL251016C00150000-261012-MON-1430PT`.
   Same-contract re-stage remains idempotent (same id = the reopen
   path). New spec pins cross-contract uniqueness + same-contract
   idempotence.
2. **MINOR — `fatfingerBlock` failed open on non-finite premium** (NaN
   from an unparseable qty/price would silently disable the guardrail).
   Now fails closed: `!Number.isFinite(premium) → block`. Spec added.
3. **MINOR — spec cast masked type contract.** `status: 'CONFIRMED'`
   string + `as StSignalItem` → `SignalStatus.CONFIRMED`, casts removed.
4. **Nits fixed:** `chainSymbol` uppercased in `selectsToInstrumentArgs`;
   `premiumNotional` cent-rounds (`3 × 33.33 × 100` → 9999);
   `ParsedOptionPaste` doc corrected (selects don't produce it).

## Findings deferred — caller contract for #963

- **Reject-filter replication** — the option seed path must copy
  `stageCardTicket`'s `decisionType !== REJECT` filter; nothing enforces
  it (same convention as equity).
- **Paste underlying mismatch** — `parseOptionPaste` returns the pasted
  symbol verbatim; #963 must compare `parsed.symbol` to the card symbol
  or a pasted MSFT contract would group under an AAPL card.
- **updateTicket merge path** — re-resolution must update `legs[0]` on
  the existing ticket, not stage a second one (IMPL).
- `parseOccContractId` passes impossible dates through (`251340` →
  `2025-13-40`) → inline "contract not found", acceptable; `[A-Z]+`
  symbol class can't parse `BRK.B` — pre-existing shared limitation.
- SPXW root-vs-display quirk — selects may resolve `SPX` chains while a
  pasted `SPXW` OCC resolves `SPXW`; verify live during #963.
- Zero-width space (`\u200B`, not in JS `\s`) survives the paste strip →
  null → inline error; acceptable.

## Round 2 — convergence pass (2026-10-12)

All three axes re-ran on the post-remediation code. Standards and Spec
verified every round-1 fix and found no regressions; Thermo-nuclear
produced one more MAJOR plus caller-contract residuals — dispositioned
below.

### Fixed in round 2

1. **MAJOR — direction wasn't in the id.** A LONG and a SHORT card can
   legally coexist on the same underlying, and the option ticket is
   always `side:'buy'` — so two opposite-direction cards staging the
   same contract in one PT minute still collided. Fix: the direction is
   now an id segment — `AAPL-OPT-LONG-AAPL251016C00150000-261012-MON-
   1430PT`. The same-direction cross-card and re-stage-while-live
   residuals are genuinely caller-side (a pure builder can't see the
   ticket store) — pinned as a #963 staging-guard requirement below.
2. **MINOR — `fatfingerBlock` asymmetric fail-open.** The finite guard
   now covers `availableCash` and `percent` too — NaN cash (failed
   account parse) or NaN percent (Firestore can persist NaN; the default
   param only covers an *absent* arg) would have compared false and
   silently disabled the check.
3. **MINOR — unvalidated `occSymbol` in the doc id.** The builder now
   uppercases + enforces `/^[A-Z0-9]+$/` (the `buildOccContractId`
   output charset) and returns null otherwise — a `'/'` (e.g. `BRK/B…`)
   would corrupt the Firestore doc path. `OptionContractRef.occSymbol`
   doc updated: load-bearing, not "display only".
4. **Nits:** idempotence comment scoped to same-minute; `chainSymbol`
   uppercasing and all new behavior spec-pinned (21 specs, was 18).

### New deferred items (pinned into IMPL-948, not #961 scope)

- **#963 staging guard** — before `stageTicketAndWait`, find existing
  OPTION tickets for the card via `findCardTickets` /
  `signalContext.decisionIds` overlap; reopen STAGED, block live
  (SUBMITTING/SUBMITTED/PAPER). `createTicket` `.set()`s unconditionally,
  so without the guard a same-minute re-stage destroys a live order doc
  — and `findCardTickets` currently drops OPTION tickets, so the
  existing `tradeCard` guard is blind to them until #964.
- **#964 un-reject ordering** — once `findCardTickets` accepts OPTION,
  `rejectCard`→`removeStagedTickets` removes the option ticket and its
  `decisionIds` clearing must not flip freshly-marked REJECTs back to
  pending (the #755 hazard on the option path). Until #964 lands, an
  orphaned option ticket exposes the same hazard via order-queue
  removal.

## Round 3 — convergence (2026-10-12)

All three axes re-ran on the post-round-2 code. Every round-2 fix
verified correct (`SignalDirection` is a string enum, `buildTicketId`
treats the side segment as opaque, the `.set()`-overwrite claim
re-verified against `createTicket`). Spec axis: all 4 ACs still MET —
the longer id still fits `{SYMBOL}-OPT-…` and blocking-on-garbage is
within guard intent. No new MAJOR/MINOR on any axis.

Closed two residual one-liners:

- `contract.occSymbol` normalize now `String(… ?? '')` — a nullish
  caller value returns null instead of throwing (matches
  `parseOptionPaste`'s defensive idiom).
- Header documents the single-card assumption (`signals` same symbol /
  same direction) — `first.direction` lands in the id.

**Converged** — a further round would only re-litigate items already
pinned to #963/#964 in IMPL-948.

## Tests

- New: 21 specs across the two util files — all pass.
- Focused run: `npx jest option-contract option-ticket-staging` → 21/21.
- Full suite: 3554 pass / 43 fail — identical to the task #960 baseline;
  all failures trace to unrelated uncommitted screenshot work
  (`screenshot-capture-contracts.spec.ts` `PositionType` enum,
  `order.component.spec.ts` `Functions` provider). None in this diff.
- `tsc` clean for the touched files (two pre-existing errors in
  unrelated in-flight work: `scripts/bulk-swing-sweep.ts`,
  `indicator-config-dialog.component.ts`).
