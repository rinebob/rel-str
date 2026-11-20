# Verify — #1501 Engine config + eod-selection-pass re-target

| | |
|---|---|
| **Script** | `functions/scripts/verify/options-engine-eod-selection-1501.ts` |
| **Run** | `cd functions && npx tsx scripts/verify/options-engine-eod-selection-1501.ts [--live]` |
| **Scope** | `runEodSelectionPass` — the nightly EOD chain pick for strategy instances (#1501), now on the shared `selectContractAtCoordinate` semantics: concrete `dte` + signed `targetDelta` |
| **Stages** | DRY (default): fake `getEodChain` provider through the real pass + shared selector, no credentials — run-all safe. LIVE (`--live`): real partner chain fetch + real Firestore instance-doc validate/normalize — needs ADC + `GOOGLE_CLOUD_PROJECT=rel-str` + IPv4 preload |

## What it verifies

### DRY — 16 checks (fake chain, real pass + shared selector + id builders)

- **Signed put argmin** — `targetDelta: -0.3` picks −0.28 over −0.10 within the nearest-DTE expiration (signed comparison, not absolute-delta midpoint scoring).
- **Nearest-DTE expiration wins** — `dte: 30` picks the 32d expiration over a better-delta contract at 60d; range/midpoint semantics are gone.
- **No contract → null** — wrong-type-only chains and empty chains return `null` per the existing skip surface.
- **deltaTolerance post-check** — distance 0.20: `deltaTolerance: 0.25` → result, `0.05` → `null` (signed distance vs the configured target).
- **Malformed candidates ignored** — unparseable delta/strike, missing expiration, blank contractID, and expired rows are skipped; the one good row wins.
- **Quote mapping** — `contractID`, `side`, finite `mark`, and `dte` flow through `mapAvContractToOptionQuote`.
- **Missing coordinate → null** — `targetDelta` or `dte` absent → `null`.
- **Signed call argmin** — covered-call config `targetDelta: +0.3` picks +0.32 over +0.60.
- **Concrete-dte id segments** — `buildPositionId` and `generateInstanceId` carry `…-030-30-…` (|delta| + concrete dte) in the deterministic id.

### LIVE — 10 checks (real partner chain + real instance doc)

- Real `AvEodOptionQuoteProvider.getEodChain('SPY', '2026-01-30')` — 12,306 contracts from `partnerHistoricalOptionsV2`.
- `runEodSelectionPass` over the real provider returns the same `contractId` + `dte` as `selectContractAtCoordinate` applied to the same chain — the pass is a thin coordinate→quote seam over the shared algorithm.
- A real `st-strategy-instances/verify-1501-*` doc carrying `{ dte: 30, targetDelta: -0.3, phases[0].dte: 30, enabled: false }` validates + normalizes through `getInstance` (concrete `dte` on flat config and `phases[0]` round-trips).
- The verify doc is **deleted** after the check — unlike inert evidence docs, an instance doc is live-actionable (a console `enabled` flip would fire real engine runs). Deletion is asserted by a post-delete `exists` re-read, and the write lives in try/finally so a mid-stage failure can't leak the doc.
- A second doc carrying `targetDelta: +0.3` against `optionType: PUT` (unsigned — the sign/type mismatch `isValidInstance` must now reject) is asserted `getInstance → null`, then deleted.

## Result history

| Date | Stage | Result |
|---|---|---|
| 2026-11-19 | DRY | 16/16 pass |
| 2026-11-19 | LIVE | 24/24 pass (16 DRY + 8 LIVE) — real SPY chain 12,306 contracts, verify doc validated + deleted |
| 2026-11-20 | DRY+LIVE | 26/26 pass (16 DRY + 10 LIVE) — adds real-path rejection of an unsigned put target + delete asserts (#1501 r1 validator tightening) |
