**Topic:** Paper Trading Infra  
**Topic Slug:** `paper-trading`  
**Thread:** Signal Selection  
**Thread Slug:** `signal-selection`  
**Issue:** #1657  
**Thread Parent:** #1117  
**Topic Parent:** #553  
**Task:** #1649  
**Domain:** PAPER-TRADING  
**Type:** UAT  
**Status:** Complete  
**Created:** 2026-11-22  
**Last Updated:** 2026-11-22  

# UAT — #1649 SHARED-IMPL: signal-review contracts

## Scope

The Thread #1117 wire surface in `shared/paper-trading-contracts.ts`
plus the `st-config` doc id in `shared/st-collections.ts` — the
contracts both the BE bundle/queue callables (#1650) and the FE
`/signals/symbol-review` pane (#1653–#1655) compile against.

Task acceptance criteria:

1. Contract section: `SignalReviewStateDoc`, `SignalReviewQueueRow`,
   `GetSignalReviewQueueRequest/Response`, `SignalReviewOccurrence`,
   `GetSignalReviewBundleRequest/Response`,
   `signalPickFromReviewOccurrence` — matching the IMPL doc.
2. `SIGNAL_REVIEW_CONFIG_DOC = 'signalReview'` +
   `functions/src/common/st-collections.ts` re-export.
3. `signalPickFromReviewOccurrence` maps
   `{symbol, signalBarDate, signalType}` exactly — literal spec pin.
4. `npx jest shared/paper-trading-contracts` green;
   `cd functions && npm run build` clean.

## Prerequisites

- Repo checkout on `prod` containing the uncommitted #1649 diff (until
  shipped — then it is on `prod` HEAD).
- Node toolchain from repo root; `functions/` deps installed.
- No credentials, env, or Firestore needed — every check is local.

## Getting to the feature

Contract surface — no route or UI. The feature is verified by command
line against these files:

- `shared/paper-trading-contracts.ts` — section
  `// ── Signal selection review (Thread #1117) ──` (~line 690)
- `shared/st-collections.ts` — `SIGNAL_REVIEW_CONFIG_DOC` (~line 74)
- `functions/src/common/st-collections.ts` — re-export (~line 34)
- `functions/scripts/verify/paper-trading-signal-review-contracts-1649.ts`

## Automated evidence (executed 2026-11-22, this QA run)

| Check | Command | Result |
|---|---|---|
| Focused specs | `npx jest shared/paper-trading-contracts.spec.ts shared/st-collections.spec.ts --coverage=false` | **PASS — 57/57** (2 suites) |
| Contract verify script | `cd functions && npx tsx scripts/verify/paper-trading-signal-review-contracts-1649.ts` | **PASS — 11/11 checks** |
| Functions build | `cd functions && npm run build` | **PASS — clean, `lib\index.js 2.1mb`** |
| Full suite (review-time) | `npx jest --coverage=false` | **6,131 green**; one foreign mid-edit suite (topic-viewer) since healed 35/35 standalone |

## Scenarios

### S1 — Contract section exports exist and match the IMPL doc

- **Confirms:** AC1
- **Steps:**
  1. Open `shared/paper-trading-contracts.ts`; locate the
     `// ── Signal selection review (Thread #1117) ──` section.
  2. Compare each declared export against the IMPL doc's *Contracts*
     block (`553-1117-1642-IMPL-PAPER-TRADING-SHARED-signal-selection.md`):
     `SignalReviewStateDoc { lastOpenedAt: Record<string,string> }`,
     `SignalReviewQueueRow { symbol, lastDailySignalDate?, lastOpenedAt? }`,
     `GetSignalReviewQueueRequest {}`,
     `GetSignalReviewQueueResponse { rows }`,
     `SignalReviewOccurrence` (13 fields incl. `checked`, `tradeId?`,
     `tradeStatus?`),
     `GetSignalReviewBundleRequest { symbol }` /
     `Response { symbol, previousOpenedAt: string|null, openedAt,
     occurrences }`,
     `signalPickFromReviewOccurrence(occ): SignalPick`.
- **Expected:** every name, field type, and optionality identical —
  zero drift.
- **Result:** ☑ PASS — 2026-11-22 — verified field-for-field during
  the review gate (Spec axis) and re-confirmed on disk this run.

### S2 — `SIGNAL_REVIEW_CONFIG_DOC` constant + functions re-export

- **Confirms:** AC2
- **Steps:**
  1. `shared/st-collections.ts` — confirm
     `export const SIGNAL_REVIEW_CONFIG_DOC = 'signalReview';`
  2. `functions/src/common/st-collections.ts` — confirm it appears in
     the `export { … } from '@st/collections'` block alongside the
     sibling `ST_CONFIG_*_DOC` constants.
  3. `npx jest shared/st-collections.spec.ts` — the literal +
     single-segment pin runs in the suite.
- **Expected:** literal `'signalReview'`; re-export present; spec pin
  green.
- **Result:** ☑ PASS — 2026-11-22 — on disk + 57/57 suite (includes
  the doc-id pin at st-collections.spec.ts:93–97).

### S3 — `signalPickFromReviewOccurrence` maps exactly

- **Confirms:** AC3 — the field-order regression pin.
- **Steps:**
  1. `npx jest shared/paper-trading-contracts.spec.ts` — the
     `signal-selection review contracts (Thread #1117)` describe pins:
     a checked `AAPL_2024-03-11_D_ST_TREND_RIDER_V1_LONG` occurrence →
     literal `{symbol:'AAPL', signalBarDate:'2024-03-11',
     signalType:'D_ST_TREND_RIDER_V1_LONG'}`; key-set assertion
     `['signalBarDate','signalType','symbol']` (no join/identity leak);
     an unchecked occurrence → identical-shape pick.
  2. `npx tsx functions/scripts/verify/paper-trading-signal-review-contracts-1649.ts`
     — re-pins the mapper literal AND the
     `signalDedupeKey`(`{SYM}_{type}_{barDate}`) ≠
     `stSignalOccurrenceId`(`{SYM}_{barDate}_{type}`)
     non-interchangeability the server-side join exists to prevent.
- **Expected:** all green; a swapped `barDate`/`signalBarDate` or a
  field leak fails loudly.
- **Result:** ☑ PASS — 2026-11-22 — 57/57 specs + 11/11 verify checks.

### S4 — Compile relay

- **Confirms:** AC4
- **Steps:** `cd functions && npm run build`
- **Expected:** clean — shared types compile into the functions
  bundle; the re-export resolves.
- **Result:** ☑ PASS — 2026-11-22 — `lib\index.js 2.1mb`, Done in ~150ms.

### S5 — Carried findings landed on downstream tasks

- **Confirms:** review-gate handoffs are in scope where they belong
  (QA checklist items on #1657).
- **Steps:**
  1. `gh issue view 1650 --json comments` — the accept-flow
     `signalId` namespace finding is commented (join decision +
     `checked⇒tradeId` pin + `StSignal`→occurrence reshape pin).
  2. `gh issue view 1654 --json comments` — the stamp-then-fail
     divider-anchor edge is commented.
  3. `553-1117-1642-IMPL-PAPER-TRADING-BE-signal-selection.md` — the
     *Review correction* paragraph corrects the `signalId` join claim.
- **Expected:** all three present.
- **Result:** ☑ PASS — 2026-11-22 — comment on #1650 (major + spec
  pins), comment on #1654 (divider anchor), IMPL doc correction at
  line 121.

## Manual UI/UX refinement pass

**Not applicable — no user-facing surface.** Contract types, one pure
mapper, one constant. The consuming pane (#1653–#1655) owns UI QA.

## Findings

- None new. Carried findings from the review gate are tracked on
  #1650 (major — accept-flow `signalId` namespace) and #1654 (minor —
  divider anchor); both confirmed scoped in S5.
- Scope note for ship: `shared/paper-trading-contracts.ts` carries
  foreign uncommitted `SignalExpressionTemplate` hunks (~lines
  315–381) from the shipped #1502 work — hunk-level staging required.

## Traceability

| AC | Scenarios |
|---|---|
| AC1 contract section matches IMPL | S1 |
| AC2 `SIGNAL_REVIEW_CONFIG_DOC` + re-export | S2 |
| AC3 mapper literal pin | S3 |
| AC4 jest green + functions build | S3, S4 + automated evidence |
| QA checklist — carried findings scoped | S5 |

## Regression / smoke

- [x] Existing `SignalPick`/mint/delete contract pins in the same spec
      file still green (57/57 covers them).
- [x] `shared/st-collections.spec.ts` existing doc-id/root pins green.
- [x] `run-all.ts` registration present (line 74); verify README row +
      numbered-list entry present.
- [x] Pure additive — zero behavior change to existing exports;
      foreign `SignalExpressionTemplate` hunks excluded from this task's
      scope and shipped separately under #1502's commit set.

## Verdict

**PASS** — all four ACs verified with fresh evidence; every carried
finding confirmed scoped to its downstream task.

## Results log

| Date | Scenarios | Result | Notes |
|---|---|---|---|
| 2026-11-22 | S1–S5 + automated | PASS | 57/57 specs, 11/11 verify, build clean — re-run this gate |
