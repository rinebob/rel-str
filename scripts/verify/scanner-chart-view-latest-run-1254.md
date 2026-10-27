# Verification Guide — Scan Latest Run contract + paths + rules (#1254)

Task [#1254](https://github.com/rinebob/rel-str/issues/1254) — SHARED
contract: `ScanLatestRun` + `serializeScanLatestRun`/`parseScanLatestRun`
(`shared/scanner-contracts.ts`, consumed as `@st/scanner`), the
`latest-runs` anchor + path helpers (`shared/st-collections.ts`, consumed
as `@st/collections`), and the `firestore.rules` write-allowlist extension.

## Scripts

| Script | Stage | Purpose |
|---|---|---|
| `scanner-chart-view-latest-run-1254.ts` | contract + paths + rules | Asserts the latest-runs path helpers (segment parity for `collection()`/`doc()`), serialize→parse round-trip fidelity (populated + zero-match runs), malformed-doc rejections, and the `st-scanner` rules allowlist covering `latest-runs` — all through the real tsconfig aliases |

### Usage

```bash
npx tsx scripts/verify/scanner-chart-view-latest-run-1254.ts
```

No arguments, no environment variables, no Firestore access — contract
functions, path constants, and a static rules-file assertion.

**Pass:** every check prints `OK` and the script ends with
`=== ALL CHECKS PASSED ===` (exit 0).

**Fail:** the offending check prints `FAIL` with the expected value; the
script ends with `=== N CHECK(S) FAILED ===` (exit 1).

## Setup / teardown

None — read-only, no side effects.
