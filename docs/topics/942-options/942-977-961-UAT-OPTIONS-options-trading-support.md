**Topic:** Options Trading Support  
**Topic Slug:** options  
**Thread:** Single-leg option orders  
**Thread Slug:** single-leg-option-orders  
**Issue:** #977  
**Thread Parent:** #943  
**Topic Parent:** #942  
**Task:** #961  
**Domain:** OPTIONS  
**Type:** UAT  
**Status:** Complete  
**Created:** 2026-10-12  
**Last Updated:** 2026-10-12  

# UAT — #961 Option contract + staging utils

## Scope

Pure-helper layer for the single-leg option ticket:
`option-contract.util.ts` (`parseOptionPaste`, `chainsToExpirations`,
`selectsToInstrumentArgs`, `premiumNotional`, `fatfingerBlock`,
`DEFAULT_OPTION_MAX_PREMIUM_CASH_PERCENT`) and
`option-ticket-staging.util.ts` (`buildOptionSignalTicket`), including
the round-1/2 review remediation (direction+contract ticket-id
discriminator, symmetric NaN guards, occSymbol charset validation).
Pure-function task — no UI surface; all scenarios are executable from
the command line. Manual UI/UX refinement pass: **not applicable**.

## Prerequisites

- Repo root: `C:\aa\projects\rel-str`
- No credentials or live session required — all behavior is pinned by
  unit specs.

## Scenarios

### 1. `parseOptionPaste` — valid, padded, lowercase, garbage

```powershell
npx jest src/app/features/savant-trader/utils/option-contract.util.spec.ts --coverage=false -t "parseOptionPaste"
```
**Expected:** 4 specs pass — compact OCC id parses; padded OCC layout +
trailing whitespace parses; lowercase input parses; garbage/empty/
bad-type-char → `null`.  
**Result:** PASS

### 2. `chainsToExpirations` + `selectsToInstrumentArgs`

```powershell
npx jest src/app/features/savant-trader/utils/option-contract.util.spec.ts --coverage=false -t "chainsToExpirations"
npx jest src/app/features/savant-trader/utils/option-contract.util.spec.ts --coverage=false -t "selectsToInstrumentArgs"
```
**Expected:** 4 specs pass — union+sorted expirations across chains,
`[]` for no chains; select triplet → `OptionInstrumentFilters`, chain
symbol uppercased on lowercase input.  
**Result:** PASS

### 3. `premiumNotional` + `fatfingerBlock` — math and fail-closed guards

```powershell
npx jest src/app/features/savant-trader/utils/option-contract.util.spec.ts --coverage=false -t "premiumNotional"
npx jest src/app/features/savant-trader/utils/option-contract.util.spec.ts --coverage=false -t "fatfingerBlock"
```
**Expected:** 5 specs pass — qty × price × 100 cent-rounded
(`3 × 33.33` → 9999); premium > cash × pct blocks, boundary does not;
absent config → 25 (`DEFAULT_OPTION_MAX_PREMIUM_CASH_PERCENT = 25`);
**any** non-finite input (premium, availableCash, percent) fails closed.  
**Result:** PASS

### 4. `buildOptionSignalTicket` — ticket shape, decision ids, doc-id discriminators

```powershell
npx jest src/app/features/savant-trader/utils/option-ticket-staging.util.spec.ts --coverage=false
```
**Expected:** 8 specs pass — STAGED `OptionOrderTicket` with
buy/limit/gfd/regular_hours, single `{buy, occSymbol, optionId, open}`
leg, `quantity:''`; every passed occurrence's canonical decisionId on
`decisionIds` incl. SHORT-card occurrences (no side filter — a long put
is still buy-to-open), first → `decisionId`/`sourceRef`; `signalPrice`
present only when the signal carries `closePrice`; id format
`{SYMBOL}-OPT-{LONG|SHORT}-{occId}-{ts}` — human-readable, never an
equity `BUY|SELL` id; different contracts at the same minute → different
ids; opposite-direction cards same contract/minute → different ids;
same-contract re-stage same-minute → same id; malformed `occSymbol`
(non-`[A-Z0-9]`) → `null`, lowercase normalized; empty `signals` →
`null`.  
**Result:** PASS

### 5. Focused suite + typecheck + full-suite regression

```powershell
npx jest src/app/features/savant-trader/utils/option-contract.util.spec.ts src/app/features/savant-trader/utils/option-ticket-staging.util.spec.ts --coverage=false
npx tsc --noEmit
```
**Expected:** 21/21 specs green; typecheck clean on the touched files.  
**Result:** PASS — 21/21; `tsc` reports only two pre-existing errors in
unrelated in-flight files (`scripts/bulk-swing-sweep.ts`,
`indicator-config-dialog.component.ts`) — none in this diff. Full suite:
3565 pass / 43 fail — identical to the pre-task failure baseline; all
failures trace to unrelated uncommitted work
(`screenshot-capture-contracts.spec.ts` `PositionType` enum,
`order.component.spec.ts` `Functions` provider).

## Traceability

| Task AC | Scenario |
|---|---|
| `parseOptionPaste` valid OCC + formatting tolerance + null on garbage | 1 |
| Chain expiration union/sort | 2 |
| Select values → `OptionInstrumentFilters` | 2 |
| `fatfingerBlock` premium-vs-cash pct + default 25 | 3 |
| Fail-closed guards (round-1/2 findings) | 3 |
| decisionIds equity semantics / first → decisionId / caller filters REJECT | 4 |
| Human-readable ticket id distinct from equity | 4 |
| Cross-contract + cross-direction id uniqueness (round-1/2 majors) | 4 |
| Single long-leg/open `OptionOrderTicket` shape | 4 |

## Regression / smoke

- [x] New files only — `signal-order-staging.util.ts` (`buildTicketId`)
      consumed unchanged; equity callers unaffected
- [x] No production consumer exists yet (first is #963) — nothing else
      to regress; `submitTicket` still refuses OPTION tickets
- [x] IMPL-948 carries the pinned caller contracts (staging guard,
      un-reject ordering, reject filter, paste symbol check) for
      #963/#964 — verified in doc

## Findings

None outstanding. Review-deferred items are caller-contract requirements
pinned into IMPL-948 for #963/#964, not defects (staging guard before
`stageTicketAndWait`; reject-filter replication; paste underlying-symbol
check; `updateTicket` merge; un-reject ordering on card reject; SPXW
root-symbol verification).
