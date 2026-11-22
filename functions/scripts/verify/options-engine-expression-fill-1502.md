# Verify — #1502 expression-fill-pass re-target to shared selection

| | |
|---|---|
| **Script** | `functions/scripts/verify/options-engine-expression-fill-1502.ts` |
| **Run** | `cd functions && npx tsx scripts/verify/options-engine-expression-fill-1502.ts [--live]` |
| **Scope** | `runExpressionFillPass` — the noon-PT fill of staged `pap_*` tickets and legacy PENDING trades (#1502): selection moved off the DTE-band filter + `selectOptionContract` weighted scorer onto the shared `selectContractAtCoordinate` at the template's concrete coordinate `{type, signed targetDelta, targetDte}` |
| **Stages** | DRY (default): fake `callTool` through the real pass + shared selector, no credentials — run-all safe. LIVE (`--live`): real SPY chain via the prod KMS session manager — needs ADC + `RH_CREDENTIAL_KEY_NAME` (auto-loaded from `functions/.env`) + IPv4 preload |

## What it verifies

### DRY — 12 checks (fake chain, real pass + shared selector)

- **Coordinate pick** — `targetDte: 45` selects the 42d expiration (nearest listed), not the band's in-window candidates; signed argmin picks −0.31 over −0.45/−0.18 for |target| = 0.3.
- **No band** — instruments are fetched for all nearest-4 expirations including out-of-band ones (15d, 86d with a 30–60d template); an all-out-of-band chain still fills at the nearer expiration.
- **Fill price = RH quote mark** — the minted fill and the ticket's `fillSummary.averagePrice` carry the selected contract's mark.
- **Signed delta** — a put row carrying a stray positive delta closer in absolute terms loses to the correctly-signed −0.31 (the pass signs the template magnitude by option type).
- **Unpriceable pick skips** — a selection with no mark records `no_contract` on the ticket and mints nothing — the pick is identity-fixed, never a silent second choice.
- **Empty chain skips** — no expirations → skip with zero instrument fetches.

### LIVE — 7 checks (real SPY chain via the prod KMS session)

- Real `get_option_chains` for SPY through `createRobinhoodMcpSessionManagerFromKms` — the same credential/refresh path every deployed pass now uses (#1639).
- The script independently rebuilds the pass's candidate set (nearest-4 expirations → instruments → quotes) and runs `selectContractAtCoordinate` directly.
- The REAL `runExpressionFillPass` over a staged `pap_*` ticket mints the same contract the raw selector picks — pass-vs-selector parity on live data.
- Fill price equals the picked quote's mark.
- All ledger deps (`applyEntryFill`, `applyPendingFill`, ticket marks, group joins) are stubbed captures — **nothing writes to Firestore or the ledger**; safe to run repeatedly.

## Result history

| Date | Stage | Result |
|---|---|---|
| 2026-11-20 | DRY | 12/12 pass |
| 2026-11-20 | DRY+LIVE | 19/19 pass — real SPY chain, pass pick `SPY261218P00665000` (Δ −0.307, mark 13.99, 28d) ≡ selector pick |
