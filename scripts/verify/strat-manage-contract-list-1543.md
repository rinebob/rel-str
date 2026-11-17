# strat-manage-contract-list-1543

Verification for task **#1543 — "BE: Contract-list writer ({instanceId} docs on position open)"** (Topic #137, Thread #1510, Blueprint #1536).

Offline verification — exercises the real modules with injected fakes; no credentials, no emulator, no network.

## What it checks

- **Doc creation on first open** — `st-options-contract-lists/{instanceId}` fields: `runId` = instanceId, `symbol`, `templateId` = variant's templateId, `status: 'success'` (the `optionsAnalysisStart` gate), no `schemaVersion` (v1 by absence)
- **Pick rows** — one `ContractListPickRowV1` per resolved leg: `contractId`, `entryDate`, `side` from the leg spec, computed `dte`, `mark`, `delta`, `iv`, `bid`/`ask`/`volume`/`openInterest` from the RH quote, `underlyingClose` = live equity price at entry
- **Append on second open** — same-index `repeatsPrevious` semantics (leg i vs previous open's leg i, not the literally-preceding flat row), `pickDocMeta` bookkeeping (`firstDate`/`lastDate`/`pickCount`)
- **Synthetic meta** — leg-0 `coordinate` + `gridVersion: 0` (no SA pick-doc grid behind a live open)
- **Missing numerics → `NaN`** — absent delta/iv/underlying price write `NaN`, never a fabricated `0`
- **Pass seam** — `runManageOpenPass` invokes `appendContractListRows` with resolved `{leg, contract}` pairs on success; an append failure warns but the open still succeeds

## Usage

```bash
npx tsx scripts/verify/strat-manage-contract-list-1543.ts
```

Expected output: every line prints `OK`, then `All checks passed.` — exit 0. Any `FAIL` line prints the expected value and exits 1.
