# Verification Guide — ST Collection Path Constants (#997)

Task [#997](https://github.com/rinebob/rel-str/issues/997) — SHARED path
constants: canonical `st-`-prefixed roots and anchored-kind path helpers
(`shared/st-collections.ts`, consumed as `@st/collections` by both BE and FE).

## Scripts

| Script | Stage | Purpose |
|---|---|---|
| `data-pipeline-st-collections-997.ts` | paths | Asserts every flat root string, the `st-runs/{runId}/jobs` helper, the `st-config` doc helper, and all anchored domains (`st-paper-trading`, `st-portfolio`, `st-scanner`) — including odd/even segment parity, the deliberate absence of `instances`/`cohorts` kinds (moved to `st-strategy-instances` / `st-position-groups`), and a probe of every `st-scanner` name through the functions barrel re-export |

### Usage

```bash
npx tsx scripts/verify/data-pipeline-st-collections-997.ts
```

No arguments, no environment variables, no Firestore access — the module is
constants and pure path helpers.

**Pass:** every check prints `OK` and the script ends with
`=== ALL CHECKS PASSED ===` (exit 0).

**Fail:** the offending line prints `FAIL` with the expected value; the
script ends with `=== N CHECK(S) FAILED ===` (exit 1).

## Setup / teardown

None — read-only, no side effects.
