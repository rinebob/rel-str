# strat-manage-exit-scan-1544

Verification for task **#1544 — "BE: Exit-scan pass over position marks (paper=all exits, real=configured)"** (Topic #137, Thread #1510, Blueprint #1536).

Offline verification — exercises the real modules with injected fakes; no credentials, no emulator, no network.

## What it checks

- **Net series** — `buildNetSeries` computes the signed cost-to-close per day (short legs `+mark`, long legs `−mark`) as an inner join across leg series: a date missing from ANY leg drops out
- **Record outcomes** — `positionExitRecord` maps the shared `evaluateExit` scan onto `AnalysisTradeRecord` outcomes: `exit` (rule fired), `expired` (series reached the expiry bar; net intrinsic = signed per-leg intrinsic sum, `assignmentDistancePct` = max per-leg distance), `open` (last bar short of a future expiry), `error` (empty series / missing entry-day bar / truncated past expiry)
- **`scanPosition`** — fetches each leg's SA contract series from `openDate → min(expiry, today)`; a per-leg fetch failure or `ok:false` degrades the whole position to `error` records (never throws); a missing `contractID` or `openDate === today` (no entry-day EOD bar yet) returns `null` so the caller logs + skips; mixed-expiry legs → `error` (v1 unsupported)
- **`runManageExitScan` end-to-end** — one `AnalysisResultDoc` per `(instanceId, exitId)` at `st-options-analysis-results/{instanceId}_{exitId}` with `contractListDocId`/`runId` = instanceId, `templateId` from the embedded variant, `registryVersion` stamped, `status: 'success'`, one trade record per scanned position, and the `manageExitScanResult` observability stamp on `daily-analysis/latest`
- **Skip semantics** — a position that can't produce a net series logs + skips; result docs still write with empty `trades`
- **Registry auto-apply** — docs are emitted for every entry in `EXIT_STRATEGIES` (6 today), so a new registry entry produces a new result doc with no pass changes
- **Manual-rerun guard** — `optionsAnalysisStart` rejects manage contract lists (synthetic `pickDocMeta.gridVersion === 0`): a manual replay run would overwrite the pass's position-grain docs at the same `{instanceId}_{exitId}` ids with per-leg records. Covered by `tests/functions/options-analysis/start.test.ts` (importing `start.ts` here double-instantiates `firebase-admin-init`, so it's asserted in the spec suite instead)

## Usage

```bash
npx tsx scripts/verify/strat-manage-exit-scan-1544.ts
```

Expected output: every line prints `OK`, then `All checks passed.` — exit 0. Any `FAIL` line prints the expected value and exits 1.
