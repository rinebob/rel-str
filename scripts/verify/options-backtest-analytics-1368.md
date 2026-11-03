# Verification Guide — Backtest Analytics Results Collection (#1368)

Task [#1368](https://github.com/rinebob/rel-str/issues/1368) — the
`st-options-analysis-results` collection contract: root constant +
`{contractListDocId}_{exitId}` doc-id builder in
`shared/st-collections.ts` (consumed as `@st/collections`), Firestore rules
(authed read / deny client writes), and the two composite indexes.

## Scripts

| Script | Stage | Purpose |
|---|---|---|
| `options-backtest-analytics-1368-results-collection.ts` | collection contract | Asserts `@st/collections` alias resolution under tsx (root + builder + contract-lists neighbor still resolving), symbol uppercasing through `stOptionsContractListDocId`, and `{list}_{exitId}` doc keys composing valid 2-segment Firestore doc paths for every registry seed |

### Usage

```bash
npx tsx scripts/verify/options-backtest-analytics-1368-results-collection.ts
```

No arguments, no environment variables, no Firestore access — constants +
builder smoke only.

**Pass:** every check prints `OK` and the script ends with
`All checks passed.` (exit 0).

**Fail:** the offending line prints `FAIL` with the expected value; the
script ends with `N check(s) FAILED` (exit 1).

## Rules + indexes coverage

Content-level assertions on `firestore.rules` and
`firestore.indexes.json` live in
`tests/functions/firestore-rules-indexes-1012.test.ts` — run with:

```bash
cd functions && npm run test:st-rules-indexes
```

Covers: match block present + authed-read/deny-write pattern for
`st-options-analysis-results`, and both composite indexes
(`contractListDocId+exitId`, `runId+exitId`) declared.

## Setup / teardown

None — read-only, no side effects. **Note:** rules and indexes only take
effect after `firebase deploy --only firestore:rules,firestore:indexes` —
verification here proves the declarations, not live enforcement.
