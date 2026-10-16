# Verification Guide — Canonical st- ID Builders + Migration Mappers (#999)

Task [#999](https://github.com/rinebob/rel-str/issues/999) — SHARED doc-id
builders (`shared/st-ids.ts`, consumed as `@st/ids`) and the order-intents
migration mappers (`mapOrderSourceToOriginType`, `mapLegacyTicketStatus` in
`@st/order-tickets`; `stSignalStatusFromBarStatus` in `@st/signals`).

## Scripts

| Script | Stage | Purpose |
|---|---|---|
| `data-pipeline-st-ids-999.ts` | contracts | Asserts every id layout (`{SYM}_{barDate}_{signalType}`, `{liv\|pap}_{id}`, `{SYM}-{YYMMDD}-{origin}-{expr}[-{exp}-{strike}]-{NN}`, `{SYM}-{YYMMDD}-grp-{NN}`), origin-code mapping, NN padding + >99 rollover + non-safe-integer rejection, equity contract omission, asymmetric + dash-bearing exp/strike rejection, barDate arg-swap validation, empty-segment guards, `'toString'` poison-key origin, legacy source/status → origin/mode+state mapping (incl. `expired` pass-through), and barStatus → INTERIM/CONFIRMED |

### Usage

```bash
npx tsx scripts/verify/data-pipeline-st-ids-999.ts
```

No arguments, no environment variables, no Firestore access — pure
builders and mappers.

**Pass:** every check prints `OK` and the script ends with
`=== ALL CHECKS PASSED ===` (exit 0).

**Fail:** the offending line prints `FAIL` with the expected value; the
script ends with `=== N CHECK(S) FAILED ===` (exit 1).

## Setup / teardown

None — read-only, no side effects.
