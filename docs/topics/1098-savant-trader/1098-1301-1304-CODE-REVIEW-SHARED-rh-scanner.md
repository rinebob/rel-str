**Topic:** RH Scanner  
**Topic Slug:** rh-scanner  
**Thread:** Scanner Row Actions  
**Thread Slug:** scanner-row-actions  
**Issue:** #1301  
**Thread Parent:** #1295  
**Topic Parent:** #1098  
**Task:** #1304  
**Domain:** SAVANT-TRADER  
**Area:** SHARED  
**Type:** CODE-REVIEW  
**Status:** Complete  
**Created:** 2026-10-27  
**Last Updated:** 2026-10-28  

# Code Review — #1304: get_equity_historicals wire contract

Three-axis gate review (Standards / Spec / Thermo-nuclear, parallel
sub-agents) over the uncommitted change set:

- `shared/robinhood-mcp-contracts.ts` — new `get_equity_historicals`
  contract block (`EquityHistoricalsRequest`, `EquityHistoricalInterval`,
  `EquityHistoricalBar`, `EquityHistoricalsSymbolResult`,
  `EquityHistoricalsResult`)
- `scripts/verify/savant-trader-scanner-row-actions-1304-contracts.ts`
  (offline capture parity, registered in `run-all.ts`)
- `scripts/verify/savant-trader-scanner-row-actions-1304-live.ts`
  (live executor call, deliberately unregistered)
- `scripts/verify/savant-trader-scanner-row-actions-1304.md` guide,
  `run-all.ts` + `README.md` index entries
- IMPL-SHARED + TEST-SHARED doc corrections

## Verdict: **PASS** (after remediation — first pass was FAIL)

First pass produced 2 major + ~10 minor findings. All were remediated and
the final state re-verified before this verdict (thermo-nuclear
whole-change protocol re-applied to the complete final diff, not the
patch history).

## Plan-deviation note (confirmed correct by Spec axis)

The issue body's sketch guessed the classic RH API shape
(`symbol`/`span`/`historicals[]`). The real wire — verified against all
11 `ro-eq-hist-*` captures + the tool's live `inputSchema` — is
`symbols[]` + `start_time`/`end_time` request and
`data.results[] → {symbol, interval, bounds, bars[]}` response. IMPL §1
explicitly designated the captures as source of truth; the deviation is
documented in the contract comments and corrected IMPL doc.

## Findings — first pass

### Standards axis
- minor — `guide` top-level field undeclared on `EquityHistoricalsResult`
  (present in all 11 captures; sibling `PreviewScanResponse` declares it)
- minor — stage-1 parity blind to top-level response keys
- minor — verify script redeclared the executor envelope instead of
  reusing `ToolExecutionResult` ("canonical types exist once")
- nit — bare `main()` (unhandled rejection vs FAIL line); `as string`
  cast after the typeof filter; run-all executor dependency ungated
- nit — all-optional fields vs `preview_scan`'s honest required fields
- nit — IMPL↔code comment drift (`T00:00:00Z` vs `THH:mm:ssZ`)

### Spec axis
- All requirements MET (deviation authorized and faithful to captures)
- minor — `session` comment said only `'reg'`; captures show
  `'pre'`/`'post'`/`'overnight'`
- minor — `guide` missing (same finding as Standards)
- nit — 5000-bar cap cited `err-hist-bad-interval` (wrong capture; the
  evidence is `ro-eq-hist-02`'s note)

### Thermo-nuclear axis
- **major** — unregistered-executor dependency registered unconditionally
  in `run-all.ts`: live stage hard-fails any machine without :3456.
  Precedent: #682/#683 register only the offline script; #887's
  executor script is README-only
- **major** — blanket optionality papers over a proven invariant: every
  capture carries `symbol`/`interval`/`bounds`/`bars` + all bar fields;
  only `interpolated` is conditional. All-`?` forced `??`/casts onto
  consumers
- minor — `interval` should be the fixed-value union like `bounds`/
  `adjustment_type` (echo field stays `string`)
- minor — parity one-directional; `keyof` lists not exhaustive
- nit — no fetch timeout; `main()` error handling; `*Result` naming vs
  `*Response` sibling convention (accepted — bar-level result type,
  consistent enough)

## Remediation applied

| Finding | Fix |
|---|---|
| run-all live registration | Split: `-contracts.ts` = offline parity (registered), `-live.ts` = executor call (unregistered, documented) — matches #682 convention |
| Blanket optionality | Required fields everywhere the captures prove invariant; `?` only on `interpolated` + `guide` |
| `guide` + top-level blind spot | `guide?: string` declared; parity now diffs `response` top-level keys too |
| One-directional parity | `Record<keyof T, true>` exhaustive maps (compile-enforced) + declared∖seen warns |
| `interval: string` | `EquityHistoricalInterval` fixed union (18 values) on the request; echo stays `string` |
| Envelope duplication | Script reuses `ToolExecutionResult`; single commented boundary cast on `parsed` |
| `session` comment | Lists observed values `reg`/`pre`/`post`/`overnight` |
| Cap citation | Points to `ro-eq-hist-02` (the actual evidence) |
| TEST doc `historicals` | Corrected to `data.results`/`bars` |
| `as string`, timeout, `main()` | `typeof` guard local; `AbortSignal.timeout(30s)`; `.then/.catch` |
| IMPL/TEST docs | Code block synced to final contract; `historicals` renamed |

## Test results

- `npx jest --coverage=false` — **270 suites / 4,682 tests, all green**
- Offline parity script — 20/20 OK (`guide` now caught at top level)
- Live script — 7/7 OK (AAPL `interval:'day'` → 254 real bars, prices as
  strings, ISO `begins_at`)
- Strict `tsc --noEmit` on both scripts + contract — clean

## Verdict rationale

No unresolved critical/major findings after remediation. The contract is
capture-verified, required/optional fielding is honest, the parity check
is bidirectional and compile-exhaustive, and the run-all registration
follows the established offline-only precedent.
