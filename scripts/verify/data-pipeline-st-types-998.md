# Verification Guide — Canonical st- Type Shapes (#998)

Task [#998](https://github.com/rinebob/rel-str/issues/998) — SHARED type
shapes: `StSignal`, `StOrderTicket`, `StPositionGroup`, `StStrategyInstance`,
and `PaperTrade` lineage extensions (`shared/st-*.ts`, consumed as
`@st/signals` / `@st/order-tickets` / `@st/position-groups` /
`@st/strategy-instances` / `@st/types` by both BE and FE).

## Scripts

| Script | Stage | Purpose |
|---|---|---|
| `data-pipeline-st-types-998.ts` | contracts | Asserts the value sets (StMode, signal status/timeframe, ticket state/origin/side/instrument, group status/origin), required-key sets on typed fixtures, JSON round-trips, `normalizeStSignalDirection` legacy-case mapping, `terms.symbol` + option-leg contract identity, `validateStTicketTerms` (mutual exclusivity + positive/finite/integer), and `PAPER_TRADE_WRITABLE_STATUSES` excluding `PENDING` |

### Usage

```bash
npx tsx scripts/verify/data-pipeline-st-types-998.ts
```

No arguments, no environment variables, no Firestore access — the modules are
contracts and pure validation.

**Pass:** every check prints `OK` and the script ends with
`=== ALL CHECKS PASSED ===` (exit 0).

**Fail:** the offending line prints `FAIL` with the expected value; the
script ends with `=== N CHECK(S) FAILED ===` (exit 1).

## Setup / teardown

None — read-only, no side effects.
